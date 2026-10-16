// SPDX-License-Identifier: Apache-2.0
//
// Creates the screenshots of the tavrn web client (landing page showcase and user guide) against a local development
// node with fictitious demo accounts. How to run it: README.md (run.sh does everything). It is a Playwright "test"
// only to reuse the runner; it asserts just enough to know the screens are ready before they are captured.
//
// Every scene runs in its own step: a failing scene is logged and skipped, the others still run, and the test fails
// at the end with the list of failed steps. Each capture is recorded in manifest.json with its alt text and caption.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

const NODE = `http://127.0.0.1:${process.env.SHOTS_NODE_PORT ?? "8700"}`;
const OUT = resolve(process.env.SHOTS_OUT ?? "screenshots");
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/** The illustrated pictures (avatars, room icons, arena map, camera, shared screen, whiteboard): assets/README.md. */
const ASSETS = resolve(process.env.SHOTS_ASSETS ?? "shots/assets");
const asset = (name: string) => readFileSync(join(ASSETS, `${name}.png`));

// ---- TOTP (RFC 6238), so the demo accounts can finish the mandatory second-factor enrollment ----------------

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

// ---- Captures, the manifest and the steps -------------------------------------------------------------------

interface Entry {
  scene: string;
  file: string;
  viewport: "desktop" | "phone";
  width: number;
  height: number;
  alt: string;
  caption: string;
  use: string[];
}
const manifest: Entry[] = [];
const ONLY = process.env.SHOTS_ONLY?.split(",").filter(Boolean);
const failures: string[] = [];
const allPages: Page[] = [];

/** Hides scrollbars, carets and running transitions so a capture shows the settled UI only. */
const CLEAN_CSS = `
  *::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: transparent !important; }
  * { scrollbar-width: none !important; caret-color: transparent !important; }
  *, *::before, *::after { transition-duration: 0s !important; }
`;

/**
 * Captures `<scene>-<viewport>.png` (viewport from the page width) and records it in the manifest with its alt text
 * and caption. Waits for fonts and images first and moves the mouse out of the way unless `keepMouse` is set (open
 * menus). `SHOTS_ONLY=chat,voice` limits the captures; the setup still runs fully.
 */
async function shot(page: Page, scene: string, meta: { alt: string; caption: string; use?: string[] }, opts: { settle?: number; keepMouse?: boolean } = {}) {
  const vp = page.viewportSize()!;
  const viewport = vp.width < 700 ? "phone" : "desktop";
  if (ONLY && !ONLY.includes(scene)) return;
  if (!opts.keepMouse) await page.mouse.move(vp.width - 2, vp.height / 2);
  // Typing indicators of the other demo accounts fade after a few seconds.
  await expect(page.getByText(/is typing|are typing/)).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((i) => !i.complete)
        .map((i) => new Promise((r) => { i.onload = i.onerror = r; })),
    );
  });
  await page.waitForTimeout(opts.settle ?? 900); // animations and lazy images settle
  const style = await page.addStyleTag({ content: CLEAN_CSS });
  const name = `${scene}-${viewport}`;
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, caret: "hide" });
  await style.evaluate((el) => (el as unknown as Element).remove());
  // Optional size optimization when the tools are installed (run.sh also optimizes afterwards).
  for (const [tool, args] of [["pngquant", ["--force", "--skip-if-larger", "--quality=80-95", "--output", file, file]], ["oxipng", ["-o", "3", "--strip", "safe", file]]] as const) {
    try {
      execFileSync(tool, args as unknown as string[], { stdio: "ignore" });
    } catch {
      /* not installed or nothing gained */
    }
  }
  const png = readFileSync(file);
  const entry: Entry = { scene, file: `${name}.png`, viewport, width: png.readUInt32BE(16), height: png.readUInt32BE(20), alt: meta.alt, caption: meta.caption, use: meta.use ?? ["docs"] };
  const at = manifest.findIndex((e) => e.file === entry.file);
  if (at >= 0) manifest[at] = entry;
  else manifest.push(entry);
  writeFileSync(process.env.SHOTS_MANIFEST ?? join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

/** Runs one scene; a failure is logged (with debug captures under SHOTS_DEBUG=1) and the next scene still runs. */
async function step(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
    console.log(`step ${name}: ok (${Math.round((Date.now() - started) / 1000)} s)`);
  } catch (e) {
    const lines = String(e).split("\n");
    failures.push(`${name}: ${lines.slice(0, 6).join(" | ")}`);
    console.log(`step ${name}: FAILED ${lines.slice(0, 10).join("\n")}`);
    if (process.env.SHOTS_DEBUG) {
      mkdirSync(join(OUT, "debug"), { recursive: true });
      for (const [i, p] of allPages.entries()) await p.screenshot({ path: join(OUT, "debug", `${name}-${i}.png`) }).catch(() => undefined);
    }
    for (const p of allPages) await p.keyboard.press("Escape").catch(() => undefined);
  }
}

// ---- Demo accounts ------------------------------------------------------------------------------------------

interface Demo {
  page: Page;
  username: string;
  password: string;
  token: string;
  secret: string;
}

/**
 * Registers through the wizard (English UI): account, TOTP, recovery codes, recovery key. With `capture` the steps of
 * the wizard are captured on the way (the onboarding scenes).
 */
async function register(browser: Browser, username: string, displayName: string, capture = false): Promise<Demo> {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2, locale: "en-US", colorScheme: "dark", permissions: ["microphone", "camera"] });
  await context.addInitScript(fakeScreen, `data:image/png;base64,${asset("screen-share").toString("base64")}`);
  await context.addInitScript(deviceNames);
  await context.addInitScript(() => localStorage.setItem("tavrn.voice.settings", JSON.stringify({ cuesOff: true })));
  const page = await context.newPage();
  allPages.push(page);
  const password = `demo-${username}-correct-horse-battery`;
  await page.goto("/login");
  await page.getByRole("tab", { name: "Register" }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat password", { exact: true }).fill(password);
  await page.getByLabel("Date of birth", { exact: true }).fill("1994-05-12");
  await page.getByLabel("Display name (optional)", { exact: true }).fill(displayName);
  if (capture) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shot(page, "register", { alt: "The registration form of the tavrn web client, step 1 of 4, with username, password, date of birth and display name filled in.", caption: "Creating an account: step 1 of 4 asks for a username, a password and the date of birth." });
  }
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Set up a second factor" })).toBeVisible({ timeout: 30_000 });
  if (capture) await shot(page, "onboarding", { alt: "Step 2 of 4 of the registration: the choice between an authenticator app and a passkey as the mandatory second factor.", caption: "Every account sets up a second factor before it can be used: an authenticator app or a passkey." });
  await page.getByTestId("choose-totp").click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("6-digit code", { exact: true }).fill(totp(secret));
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your recovery codes" })).toBeVisible();
  await page.getByLabel("I have saved these codes in a safe place", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("recovery-key-words")).toBeVisible();
  if (capture) await shot(page, "onboarding-recovery-key", { alt: "Step 4 of 4 of the registration: the recovery key as 24 numbered words and a compact form, with buttons to copy or download it.", caption: "The recovery key unlocks the encrypted messages on new devices; only the account owner has it." });
  await page.getByLabel("I have saved my recovery key", { exact: true }).check();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("tavrn.auth") ?? "{}").token as string);
  // The illustrated avatar (the node stores it as a 256 × 256 WebP); the next navigation shows it everywhere.
  const avatar = await page.request.put(`${NODE}/api/v1/users/me/avatar`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" }, data: asset(`avatar-${username}`) });
  if (!avatar.ok()) throw new Error(`avatar of ${username}: ${avatar.status()} ${await avatar.text()}`);
  return { page, username, password, token, secret };
}

/**
 * Headless Chromium has no screen to share: getDisplayMedia returns a canvas showing the illustrated boss fight
 * (assets/screen-share.png, handed in as a data URL) instead. It runs in the page (init script), so it must be
 * self-contained. The canvas is redrawn a few times a second so the stream keeps sending frames.
 */
function fakeScreen(picture: string) {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const g = canvas.getContext("2d")!;
    const img = new Image();
    img.src = picture;
    await img.decode().catch(() => undefined);
    const draw = () => {
      if (img.complete && img.naturalWidth) g.drawImage(img, 0, 0, canvas.width, canvas.height);
      else {
        g.fillStyle = "#0c1420";
        g.fillRect(0, 0, canvas.width, canvas.height);
      }
    };
    draw();
    setInterval(draw, 100);
    return canvas.captureStream(10);
  };
}

/**
 * Chromium's fake capture devices are called "Fake Audio Input 1" and the like; the voice quick menus list them by
 * name. In the page (init script), enumerateDevices returns the same devices under the names of ordinary hardware.
 */
function deviceNames() {
  const names: Record<string, string> = {
    "Fake Default Audio Input": "Studio microphone (USB)",
    "Fake Audio Input 1": "Headset microphone",
    "Fake Audio Input 2": "Webcam microphone",
    "Fake Default Audio Output": "Speakers",
    "Fake Audio Output 1": "Headset",
    "Fake Audio Output 2": "Monitor speakers",
    fake_device_0: "HD webcam",
  };
  const devices = navigator.mediaDevices;
  if (!devices?.enumerateDevices) return;
  const original = devices.enumerateDevices.bind(devices);
  devices.enumerateDevices = async () =>
    (await original()).map((d) => {
      const label = Object.entries(names).reduce((l, [from, to]) => l.replace(from, to), d.label);
      const plain = { deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label };
      return { ...plain, toJSON: () => plain } as MediaDeviceInfo;
    });
}

async function api(page: Page, method: "GET" | "POST" | "PATCH" | "PUT", path: string, token: string, data?: unknown) {
  const resp = await page.request.fetch(`${NODE}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  if (!resp.ok()) throw new Error(`${method} ${path}: ${resp.status()} ${await resp.text()}`);
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

/** Sends through the composer of `scope` (the page, or a thread panel). */
async function send(page: Page, text: string, scope: Page | Locator = page) {
  const box = scope.getByLabel("Message", { exact: true });
  await expect(box).toBeEnabled({ timeout: 30_000 });
  await box.fill(text);
  await box.press("Enter");
  await expect(box).toHaveValue("", { timeout: 20_000 });
}

const message = (page: Page | Locator, text: string) => page.getByTestId("message").filter({ hasText: text }).last();

async function react(page: Page, text: string, emoji: string) {
  const m = message(page, text);
  await m.hover();
  await m.getByRole("button", { name: "React" }).click();
  await page.getByRole("menuitem", { name: emoji }).first().click();
  await expect(m.getByRole("button", { name: new RegExp(`^${emoji} \\d`) })).toBeVisible();
}

/** Right-click on a message or row (near its left edge, away from links and images). */
async function contextMenu(target: Locator) {
  await target.click({ button: "right", position: { x: 12, y: 12 } });
}

async function reply(page: Page, text: string, answer: string) {
  await contextMenu(message(page, text));
  await page.getByRole("menuitem", { name: "Reply", exact: true }).click();
  await send(page, answer);
}

// ---- The fake camera ------------------------------------------------------------------------------------------

/**
 * Mira's camera: Chromium plays a Y4M file as the fake capture device, made once from assets/cam-mira.png with
 * ffmpeg. The flag applies to the whole browser, so only one account turns its camera on. Without ffmpeg Chromium
 * shows its test pattern.
 */
function cameraVideo(): string | null {
  const dir = mkdtempSync(join(tmpdir(), "tavrn-shots-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "cam-mira.y4m");
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-framerate", "5", "-t", "2", "-i", join(ASSETS, "cam-mira.png"), "-pix_fmt", "yuv420p", "-s", "1280x720", file]);
    return file;
  } catch {
    return null;
  }
}

const camera = cameraVideo();

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...(camera ? [`--use-file-for-fake-video-capture=${camera}`] : [])],
  },
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// ---- The Raid Planner bot (raid-planner-bot.ts, for the components scenes) ------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
let bot: ChildProcess | null = null;
process.on("exit", () => {
  if (bot && bot.exitCode === null) bot.kill("SIGTERM");
});

/**
 * Starts raid-planner-bot.ts with the application's token on the @tavrn/bot of the tavrn-web checkout (vite-node of
 * its e2e package, the working directory of the run) and waits for its `ready` line.
 */
async function startBot(token: string): Promise<ChildProcess> {
  const dir = mkdtempSync(join(tmpdir(), "tavrn-shots-bot-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const child = spawn(join(process.cwd(), "node_modules", ".bin", "vite-node"), [join(HERE, "raid-planner-bot.ts")], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, TAVRN_BOT_NODE: NODE, TAVRN_BOT_TOKEN: token, TAVRN_BOT_KEY_FILE: join(dir, "key.txt"), TAVRN_BOT_STATE_DIR: join(dir, "state") },
  });
  let log = "";
  child.stderr?.on("data", (d: Buffer) => (log = (log + d.toString()).slice(-4000)));
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error(`Raid Planner bot not ready:\n${log}`)), 60_000);
    child.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("ready ")) {
        clearTimeout(timer);
        ready();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`Raid Planner bot exited (${code}):\n${log}`));
    });
  });
  return child;
}

/** Uploads one of the illustrated emblems as a room's icon. */
async function roomIcon(owner: Demo, roomId: string, name: string) {
  const resp = await owner.page.request.put(`${NODE}/api/v1/rooms/${roomId}/icon`, { headers: { ...auth(owner.token), "Content-Type": "image/png" }, data: asset(name) });
  if (!resp.ok()) throw new Error(`room icon ${name}: ${resp.status()} ${await resp.text()}`);
}
const bit = (n: number) => 1n << BigInt(n);

/** The sign-in card in a fresh context (no session), on desktop and phone, plus the remote sign-in form. */
async function loginScenes(browser: Browser) {
  for (const [vp, extra] of [[DESKTOP, {}], [PHONE, { isMobile: true, hasTouch: true }]] as const) {
    const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, locale: "en-US", colorScheme: "dark", ...extra });
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shot(page, "login", { alt: "The tavrn sign-in card with the tabs Sign in and Register, username and password fields, and the options to sign in with a passkey or with an account of another node.", caption: "Signing in to a tavrn node: password plus second factor, a passkey, or an account of another node.", use: ["landing", "docs"] });
    if (vp === DESKTOP) {
      await page.getByTestId("remote-login-open").click();
      await expect(page.getByTestId("remote-login")).toBeVisible();
      await page.getByLabel("Your address", { exact: true }).fill("mira@nightowls.example");
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await shot(page, "login-remote", { alt: "The form Account of another node on the sign-in page, with the address mira@nightowls.example typed in and the buttons Continue and Back.", caption: "Using an account of another node: you type your full address, and your home node confirms the sign-in." });
    }
    await context.close();
  }
}

test("screenshots", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });

  await step("login", () => loginScenes(browser));

  // The first account is the node admin (TAVRN_ADMIN_USERS=mira). Theo's registration is captured (onboarding).
  const mira = await register(browser, "mira", "Mira Okafor");
  const jonas = await register(browser, "jonas", "Jonas Berg");
  const lena = await register(browser, "lena", "Lena Park");
  const theo = await register(browser, "theo", "Theo Laurent", true);
  const kai = await register(browser, "kai", "Kai Brennan");

  // ---- Room, channels, roles ---------------------------------------------------------------------------------
  const room = await api(mira.page, "POST", "/rooms", mira.token, { name: "Night Owls Gaming", description: "Late-night co-op, raids and the occasional speedrun.", join_mode: "invite" });
  await roomIcon(mira, room.id, "room-night-owls");
  const text = room.channels.find((c: { kind: string }) => c.kind === "text");
  const voice = room.channels.find((c: { kind: string }) => c.kind === "voice");
  await api(mira.page, "PATCH", `/rooms/${room.id}/channels/${text.id}`, mira.token, { name: "general", topic: "Everything that is not a raid" });
  await api(mira.page, "PATCH", `/rooms/${room.id}/channels/${voice.id}`, mira.token, { name: "Lounge" });
  const category = text.category_id ?? null;
  await api(mira.page, "POST", `/rooms/${room.id}/channels`, mira.token, { kind: "announcement", name: "announcements", encrypted: true, category_id: category });
  const strategy = await api(mira.page, "POST", `/rooms/${room.id}/channels`, mira.token, { kind: "text", name: "raid-strategy", encrypted: true, category_id: category });
  const guides = await api(mira.page, "POST", `/rooms/${room.id}/channels`, mira.token, { kind: "forum", name: "guides", encrypted: true, category_id: category });
  const screenshots = await api(mira.page, "POST", `/rooms/${room.id}/channels`, mira.token, { kind: "text", name: "screenshots", encrypted: true, category_id: category });
  const signups = await api(mira.page, "POST", `/rooms/${room.id}/channels`, mira.token, { kind: "text", name: "raid-signups", encrypted: false, topic: "The Raid Planner bot keeps the list", category_id: category });
  const raid = await api(mira.page, "POST", `/rooms/${room.id}/channels`, mira.token, { kind: "voice", name: "Raid Night", category_id: category });
  const files = await api(mira.page, "POST", `/rooms/${room.id}/channels`, mira.token, { kind: "files", name: "shared-files", category_id: category });
  await api(mira.page, "PATCH", `/rooms/${room.id}/channels/${guides.id}`, mira.token, {
    topic: "Guides, routes and questions",
    tags: [{ name: "Tanking", emoji: "🛡️" }, { name: "Healing", emoji: "💚" }, { name: "Routes", emoji: "🗺️" }, { name: "Question", emoji: "❓" }],
  });
  const mod = [2, 11, 12, 13, 14, 15, 19, 20, 25].reduce((m, n) => m | bit(n), 0n);
  const lead = [5, 19, 20, 25, 30].reduce((m, n) => m | bit(n), 0n);
  const roleOwl = await api(mira.page, "POST", `/rooms/${room.id}/roles`, mira.token, { name: "Night Owl", color: "#9b8cff", hoist: false, permissions: "0", position: 1 });
  const roleLead = await api(mira.page, "POST", `/rooms/${room.id}/roles`, mira.token, { name: "Raid Lead", color: "#f0a35e", hoist: true, permissions: lead.toString(), position: 2 });
  const roleMod = await api(mira.page, "POST", `/rooms/${room.id}/roles`, mira.token, { name: "Moderator", color: "#04cfc7", hoist: true, permissions: mod.toString(), position: 3 });
  for (const member of [jonas, lena, theo, kai]) {
    const invite = await api(mira.page, "POST", `/rooms/${room.id}/invites`, mira.token, { max_uses: 1 });
    await api(member.page, "POST", `/invites/${invite.code}/join`, member.token, {});
  }
  const users = Object.fromEntries((await api(mira.page, "GET", `/rooms/${room.id}/members`, mira.token)).map((m: { user: { username: string; id: string } }) => [m.user.username, m.user.id]));
  await api(mira.page, "PATCH", `/rooms/${room.id}/members/${users.jonas}`, mira.token, { roles: [roleMod.id] });
  await api(mira.page, "PATCH", `/rooms/${room.id}/members/${users.lena}`, mira.token, { roles: [roleLead.id] });
  for (const u of ["theo", "kai"]) await api(mira.page, "PATCH", `/rooms/${room.id}/members/${users[u]}`, mira.token, { roles: [roleOwl.id] });
  // A private channel for the officers (the access mark in the channel list; hidden in the role preview).
  const officers = await api(mira.page, "POST", `/rooms/${room.id}/channels`, mira.token, { kind: "text", name: "officers", encrypted: true, topic: "Raid leads and moderators", category_id: category });
  const everyone = ((await api(mira.page, "GET", `/rooms/${room.id}`, mira.token)).roles as { id: string; is_everyone: boolean }[]).find((r) => r.is_everyone)!.id;
  const override = (channel: string, subject: string, allow: bigint, deny: bigint) =>
    api(mira.page, "PUT", `/rooms/${room.id}/overrides`, mira.token, { target_type: "channel", target_id: channel, subject_type: "role", subject_id: subject, allow: allow.toString(), deny: deny.toString() });
  await override(officers.id, everyone, 0n, bit(0));
  await override(officers.id, roleMod.id, bit(0), 0n);
  await override(officers.id, roleLead.id, bit(0), 0n);
  // Only the leads upload into shared-files: "read only" for everybody else (the restricted mark in the preview).
  await override(files.id, everyone, 0n, bit(3));
  await override(files.id, roleMod.id, bit(3), 0n);
  await override(files.id, roleLead.id, bit(3), 0n);

  // ---- The conversation in #general (end-to-end encrypted: every message is sent through the UI) ----------------
  // Everybody opens every encrypted channel once first: a member joins a channel's MLS group when opening it, and
  // messages sent before that cannot be read by that member (forward secrecy; see REPORT.md).
  const general = `/rooms/${room.id}/channels/${text.id}`;
  for (const u of [mira, jonas, lena, theo, kai]) {
    for (const [id, name] of [[strategy.id, "raid-strategy"], [guides.id, "guides"], [screenshots.id, "screenshots"], [text.id, "general"]]) {
      await u.page.goto(`/rooms/${room.id}/channels/${id}`);
      await expect(u.page.getByTestId("channel-name")).toHaveText(name, { timeout: 30_000 });
      if (name === "guides") await expect(u.page.getByTestId("forum-new-post")).toBeEnabled({ timeout: 30_000 });
      else await expect(u.page.getByLabel("Message", { exact: true })).toBeEnabled({ timeout: 30_000 });
    }
  }
  // The welcome message carries the arena map (one message: the conversation still fits the desktop capture).
  await mira.page.getByLabel("Choose file").setInputFiles({ name: "boss-arena.png", mimeType: "image/png", buffer: asset("arena-map") });
  await send(mira.page, "Welcome to **Night Owls**! 🦉 Raid night moves to *Friday 21:00*, arena layout below 👇");
  await expect(message(mira.page, "Welcome to").getByTestId("attachment-image").locator("img")).toBeVisible({ timeout: 30_000 });
  await expect(message(lena.page, "Welcome to")).toBeVisible({ timeout: 30_000 });
  await send(lena.page, "Keybind for the dodge in phase one:\n```lua\nbind(\"shift+space\", function() cast(\"blink\") end)\n```");
  await expect(message(theo.page, "Keybind for the dodge")).toBeVisible({ timeout: 30_000 });
  await reply(theo.page, "Keybind for the dodge", "That bind saved my run yesterday! Fair warning though: ||the boss has a second phase|| 👀");
  await expect(message(mira.page, "Fair warning")).toBeVisible({ timeout: 30_000 });
  await expect(message(jonas.page, "Fair warning")).toBeVisible({ timeout: 30_000 });
  await react(lena.page, "Welcome to", "🔥");
  await react(jonas.page, "Welcome to", "🔥");
  await react(theo.page, "Welcome to", "👍");
  await react(mira.page, 'bind("shift+space"', "❤️");
  await react(mira.page, "second phase", "😂");
  await react(jonas.page, "second phase", "😂");

  // A thread on the welcome message with the arena map (the thread indicator under the message).
  await step("thread-general", async () => {
    await expect(message(theo.page, "Welcome to")).toBeVisible({ timeout: 30_000 });
    await contextMenu(message(theo.page, "Welcome to"));
    await theo.page.getByRole("menuitem", { name: "Reply in thread" }).click();
    const theoThread = theo.page.getByTestId("thread-panel");
    await expect(theoThread).toBeVisible();
    await send(theo.page, "Could we swap spawn B and C? C is closer to the healers.", theoThread);
    await theo.page.keyboard.press("Escape");
    await expect(lena.page.getByTestId("thread-indicator")).toBeVisible({ timeout: 30_000 });
    await lena.page.getByTestId("thread-indicator").click();
    const lenaThread = lena.page.getByTestId("thread-panel");
    await expect(message(lenaThread, "swap spawn B and C")).toBeVisible({ timeout: 30_000 });
    await send(lena.page, "Works for me, I updated the map in #raid-strategy.", lenaThread);
    await lena.page.keyboard.press("Escape");
  });

  // Mira pins the announcement.
  await step("pin", async () => {
    const welcome = message(mira.page, "Welcome to");
    await welcome.hover();
    await welcome.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(welcome.getByLabel("Pinned")).toBeVisible();
  });

  // ---- A few messages in #raid-strategy for the search ---------------------------------------------------------
  const strategyUrl = `/rooms/${room.id}/channels/${strategy.id}`;
  await mira.page.goto(strategyUrl);
  await send(mira.page, "Tanks call the pull, healers stack left after the first pull.");
  await send(mira.page, "If we wipe, the next pull is at 21:30 sharp.");
  await lena.page.goto(strategyUrl);
  await send(lena.page, "Pull timer stays at 10 seconds so everyone can buff.");
  await mira.page.reload();
  await expect(message(mira.page, "Pull timer")).toBeVisible({ timeout: 30_000 });

  // ---- A poll in #raid-strategy (encrypted: created and voted on through the UI) ------------------------------
  await step("poll", async () => {
    const question = "Which boss do we learn first in Season 4?";
    const answers = ["Crystal Golem", "The Drowned King", "Ashen Twins", "Hollow Matriarch"];
    await lena.page.goto(strategyUrl);
    await expect(lena.page.getByLabel("Message", { exact: true })).toBeEnabled({ timeout: 30_000 });
    await lena.page.getByTestId("composer-plus").click();
    await lena.page.getByTestId("plus-poll").click();
    const dialog = lena.page.getByRole("dialog", { name: "Create a poll" });
    await dialog.getByLabel("Question", { exact: true }).fill(question);
    for (const [i, answer] of answers.entries()) {
      if (i >= 2) await dialog.getByTestId("poll-add-option").click();
      await dialog.getByLabel(`Option ${i + 1}`, { exact: true }).fill(answer);
    }
    await dialog.getByText("1 week", { exact: true }).click();
    await dialog.getByTestId("poll-create").click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    // Everybody votes (the option ids are o1 … o4 in the order above); Mira last, so her view shows the results.
    const votes: [Demo, number][] = [[lena, 0], [jonas, 0], [theo, 1], [kai, 0], [mira, 1]];
    for (const [u, choice] of votes) {
      if (u !== lena) await u.page.goto(strategyUrl);
      const poll = u.page.getByTestId("poll").filter({ hasText: question });
      await expect(poll).toBeVisible({ timeout: 30_000 });
      await poll.locator(`[data-testid="poll-option"][data-option="o${choice + 1}"]`).getByRole("radio").check();
      await poll.getByTestId("poll-vote").click();
      await expect(poll).toHaveAttribute("data-view", "results", { timeout: 20_000 });
    }
    const poll = mira.page.getByTestId("poll").filter({ hasText: question });
    await expect(poll.getByTestId("poll-voters")).toHaveText("5 votes", { timeout: 30_000 });
    await poll.scrollIntoViewIfNeeded();
    await shot(mira.page, "poll", { alt: "A poll in the encrypted channel raid-strategy: Which boss do we learn first in Season 4?, with four options, result bars, counts and shares, the names of the voters, Mira's own vote marked as Your vote, Change vote and the remaining time until it closes.", caption: "Polls in a channel: results after voting, with your own vote marked; in encrypted channels the votes are encrypted too.", use: ["landing", "docs"] });
    await mira.page.setViewportSize(PHONE);
    await mira.page.goto(strategyUrl);
    await expect(poll.getByTestId("poll-voters")).toHaveText("5 votes", { timeout: 30_000 });
    await poll.scrollIntoViewIfNeeded();
    await shot(mira.page, "poll", { alt: "The same poll on a phone: the question, the four options with their bars and voters, and Mira's vote marked.", caption: "The poll on a phone." });
  });
  await mira.page.setViewportSize(DESKTOP);

  // ---- Forum channel #guides: tagged posts, a thread open beside the list ------------------------------------
  const guidesUrl = `/rooms/${room.id}/channels/${guides.id}`;
  await step("threads", async () => {
    const posts: [Demo, string, string, string[]][] = [
      [mira, "Speedrun route: Sunken Citadel in under 18 minutes", "Skip the bridge, take the left tunnel and clear both packs at the gate together.", ["Routes"]],
      [jonas, "Healer cooldowns for phase two", "Stagger the big cooldowns: first at 70 %, second at 40 %, then everything at the enrage.", ["Healing"]],
      [lena, "Positioning guide for the boss ring", "Tanks hold the boss on the north edge, everyone else stays inside the ring until the second phase.", ["Tanking", "Routes"]],
      [theo, "Which timer overlay do you use?", "Mine keeps resetting after a wipe. Any recommendations for something lightweight?", ["Question"]],
    ];
    for (const [u, title, body, tags] of posts) {
      await u.page.goto(guidesUrl);
      await expect(u.page.getByTestId("forum-view")).toBeVisible({ timeout: 30_000 });
      await expect(u.page.getByTestId("forum-new-post")).toBeEnabled({ timeout: 30_000 });
      await u.page.getByTestId("forum-new-post").click();
      const d = u.page.getByTestId("forum-post-dialog");
      await d.getByTestId("forum-post-title-input").fill(title);
      await d.getByTestId("forum-post-body").fill(body);
      for (const tag of tags) await d.getByTestId("forum-post-tag-option").filter({ hasText: tag }).click();
      await d.getByTestId("forum-post-submit").click();
      const panel = u.page.getByTestId("thread-panel");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      if (u === jonas) await send(u.page, "Also: call your cooldown in voice so nobody doubles up.", panel);
    }
    // Replies in Jonas' post.
    for (const [u, answer] of [[lena, "Great list! Can we add the dispel timings too?"], [mira, "Pinned this one for Friday, thanks Jonas 🙌"]] as const) {
      await u.page.goto(guidesUrl);
      const post = u.page.getByTestId("forum-post").filter({ hasText: "Healer cooldowns" });
      await expect(post).toBeVisible({ timeout: 30_000 });
      await post.click();
      const panel = u.page.getByTestId("thread-panel");
      await expect(message(panel, "Stagger the big cooldowns")).toBeVisible({ timeout: 30_000 });
      await send(u.page, answer, panel);
    }
    await mira.page.reload();
    await expect(message(mira.page.getByTestId("thread-panel"), "dispel timings")).toBeVisible({ timeout: 30_000 });
    await expect(mira.page.getByTestId("forum-post")).toHaveCount(4, { timeout: 30_000 });
    await shot(mira.page, "threads", { alt: "The forum channel guides with four posts carrying tags such as Routes, Healing and Question, and the post Healer cooldowns for phase two open as a thread on the right with its replies.", caption: "Forum channels collect posts with tags; every post is a thread, end-to-end encrypted like the channel.", use: ["landing", "docs"] });
  });

  // ---- Chat view and the message widgets -------------------------------------------------------------------
  await step("chat", async () => {
    await mira.page.goto(general);
    await expect(message(mira.page, "Welcome to").getByTestId("attachment-image").locator("img")).toBeVisible({ timeout: 30_000 });
    await expect(message(mira.page, "second phase").getByRole("button", { name: /😂 2/ })).toBeVisible({ timeout: 30_000 });
    await expect(mira.page.getByTestId("thread-indicator")).toContainText("2 replies", { timeout: 30_000 });
    await shot(mira.page, "chat", { alt: "An end-to-end encrypted text channel named general with a pinned welcome message carrying an image of the boss arena with four marked spawn points and a thread of two replies, a Lua code block, a reply with a hidden spoiler and emoji reactions; every message and the member list on the right, grouped by the roles Moderator and Raid Lead, show the members' illustrated avatars.", caption: "Text channels are end-to-end encrypted: Markdown, images, code blocks, spoilers, replies, threads and reactions.", use: ["landing", "docs"] });
  });
  await step("chat-widgets", async () => {
    await mira.page.goto(general);
    await expect(message(mira.page, "Fair warning")).toBeVisible({ timeout: 30_000 });
    await contextMenu(message(mira.page, "Fair warning"));
    await expect(mira.page.getByTestId("message-menu")).toBeVisible();
    await shot(mira.page, "menu-message", { alt: "The context menu of a message in the channel general with entries such as Reply, Create thread, Reply in thread, Add reaction, Copy text, Pin message, Delete message and Report message.", caption: "Right-click (or long-press on a phone) a message for every action on it." }, { keepMouse: true });
    await mira.page.keyboard.press("Escape");
    await expect(mira.page.getByTestId("message-menu")).toHaveCount(0);
    await mira.page.getByRole("button", { name: "Insert emoji" }).click();
    const picker = mira.page.getByTestId("emoji-picker");
    await expect(picker.getByRole("group", { name: "Smileys & emotion" })).toBeVisible();
    await shot(mira.page, "emoji-picker", { alt: "The emoji picker opened above the message composer, with a search field, the skin tone selector and the Smileys and emotion group.", caption: "The emoji picker: search, skin tones, recently used, and the custom emojis of the room." }, { keepMouse: true });
    await mira.page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    const box = mira.page.getByLabel("Message", { exact: true });
    await box.fill("/");
    await expect(mira.page.getByTestId("command-palette")).toBeVisible();
    await shot(mira.page, "composer-commands", { alt: "The message composer with a slash typed and the command palette above it, listing commands with short descriptions.", caption: "Typing / in the composer lists the commands, including those of installed bots." });
    await box.fill("/help");
    await box.press("Enter");
    await expect(mira.page.getByTestId("command-help")).toBeVisible();
    await shot(mira.page, "composer-help", { alt: "The help panel shown by the /help command above the composer, listing the available commands with their arguments and descriptions.", caption: "/help lists every command you can use in this channel; it is shown only to you." });
    await mira.page.keyboard.press("Escape");
    await box.fill("");
    await mira.page.goto(general);
    await message(mira.page, "Welcome to").getByTestId("attachment-image").locator("img").click();
    const viewer = mira.page.getByTestId("media-viewer");
    await expect(viewer.getByTestId("viewer-image")).toBeVisible();
    await shot(mira.page, "media-viewer", { alt: "The media viewer showing the arena map, a glowing boss ring with four spawn points joined by arrows, enlarged over the dimmed channel, with zoom and download controls.", caption: "Images open in the media viewer with zoom and download; the file is decrypted on the device." });
    await mira.page.keyboard.press("Escape");
  });
  await step("chat-phone", async () => {
    await mira.page.setViewportSize(PHONE);
    await mira.page.goto(general);
    await expect(message(mira.page, "Welcome to")).toBeVisible({ timeout: 30_000 });
    await shot(mira.page, "chat", { alt: "The channel general on a phone: messages with the members' avatars, the arena map with its thread, the code block, the spoiler, reactions and the composer at the bottom.", caption: "The same channel on a phone.", use: ["landing", "docs"] });
  });
  await mira.page.setViewportSize(DESKTOP);

  // ---- Search (local encrypted index) ------------------------------------------------------------------------
  await step("search", async () => {
    await mira.page.goto(general);
    await expect(message(mira.page, "Welcome to")).toBeVisible({ timeout: 30_000 });
    await mira.page.getByTestId("search-open").click();
    const panel = mira.page.getByTestId("search-panel");
    await panel.getByTestId("search-input").fill("pull");
    await expect(async () => {
      await panel.getByTestId("search-submit").click();
      await expect(panel.getByTestId("search-result").nth(2)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await shot(mira.page, "search", { alt: "The search panel with the query pull, results from the encrypted channels and the status line explaining what was searched on this device.", caption: "Search in encrypted channels runs on a local, encrypted index on the device, and the status line says what was searched.", use: ["landing", "docs"] });
  });

  // ---- Voice with a camera tile and a screen share -------------------------------------------------------------
  await step("voice", async () => {
    const raidUrl = `/rooms/${room.id}/channels/${raid.id}`;
    // The channel's status line under its name in the voice header (VOICE.md §2a).
    await api(mira.page, "PATCH", `/rooms/${room.id}/channels/${raid.id}`, mira.token, { status: "Sunken Citadel prog, pull at 21:15" });
    for (const u of [mira, jonas, lena, theo]) {
      await u.page.goto(raidUrl);
      await u.page.getByTestId("voice-join").click();
      await expect(u.page.getByTestId("voice-stage")).toBeVisible({ timeout: 30_000 });
    }
    await expect(mira.page.getByTestId("voice-tile")).toHaveCount(4, { timeout: 30_000 });
    // Mira's camera (the fake capture device plays assets/cam-mira.png); Jonas and Lena stay avatar tiles.
    await mira.page.getByTestId("voice-camera").click();
    await expect(mira.page.getByTestId("video-camera").first()).toBeVisible({ timeout: 30_000 });
    // Theo shares his screen (the canvas of fakeScreen with assets/screen-share.png).
    let screenShared = true;
    try {
      await theo.page.getByTestId("voice-screen").click();
      await theo.page.getByTestId("screen-share-start").click();
      await expect(mira.page.getByTestId("screen-tile").first()).toBeVisible({ timeout: 30_000 });
      // Streams are opt-in: Mira joins Theo's.
      await mira.page.getByTestId("screen-tile").first().getByTestId("stream-join").click({ timeout: 30_000 });
      await expect(mira.page.getByTestId("screen-tile").first()).toHaveAttribute("data-state", "watching", { timeout: 30_000 });
    } catch (e) {
      screenShared = false;
      console.warn("screen share failed:", e);
    }
    // Wait until the (decrypted) videos actually play.
    const playing = (sel: string) => () =>
      mira.page.getByTestId(sel).first().evaluate((el) => {
        const v = el instanceof HTMLVideoElement ? el : el.querySelector("video");
        return v ? v.videoWidth > 0 && v.currentTime > 1 : false;
      });
    await expect.poll(playing("video-camera"), { timeout: 30_000 }).toBe(true);
    if (screenShared) await expect.poll(playing("screen-tile"), { timeout: 30_000 }).toBe(true);
    // The shared screen large, the camera and avatar tiles in a row beside it.
    await mira.page.getByTestId("screen-focus").first().click({ timeout: 5_000 }).catch(() => undefined);
    await mira.page.waitForTimeout(2500); // the screen share reaches full quality
    await shot(mira.page, "voice", { alt: "The voice channel Raid Night with four participants: Theo's shared screen showing a party facing a crystal golem, Mira's camera tile, and the illustrated avatars of Jonas and Lena on their tiles; the header shows the channel status Sunken Citadel prog, pull at 21:15, the session timer and End-to-end encrypted, the call controls are at the bottom.", caption: "Voice, video and screen sharing, end-to-end encrypted with keys from the channel's MLS group.", use: ["landing", "docs"] });
    await mira.page.setViewportSize(PHONE);
    await mira.page.waitForTimeout(1500);
    await shot(mira.page, "voice", { alt: "The voice stage on a phone with the shared boss fight, Mira's camera tile, the avatar tiles of Jonas and Lena and the call controls.", caption: "The voice stage on a phone.", use: ["landing", "docs"] });
  });
  await mira.page.setViewportSize(DESKTOP);
  // The header's status line and session timer, and the quick menu of the microphone button (a right-click).
  await step("voice-status", async () => {
    await expect(mira.page.getByTestId("voice-status")).toHaveText("Sunken Citadel prog, pull at 21:15", { timeout: 15_000 });
    await expect(mira.page.getByTestId("voice-session-timer")).toBeVisible({ timeout: 15_000 });
    await mira.page.waitForTimeout(1500);
    const stageMic = mira.page.getByTestId("voice-stage").getByTestId("voice-mute");
    await ((await stageMic.count()) ? stageMic.first() : mira.page.getByTestId("voice-mute").last()).click({ button: "right" });
    await expect(mira.page.getByRole("menu").last()).toBeVisible();
    await shot(mira.page, "voice-status", { alt: "The voice channel Raid Night during a session: the header with the channel's status line Sunken Citadel prog, pull at 21:15 and the running session timer, and the quick menu of the microphone button with the microphones, push-to-talk, the input volume and the voice settings.", caption: "Voice channels carry a status line and a session timer; a right-click on the microphone or headphones button switches devices and volumes during the call." }, { keepMouse: true });
    await mira.page.keyboard.press("Escape");
  });
  for (const u of [theo, lena, jonas, mira]) await u.page.getByTestId("voice-leave").first().click({ timeout: 5_000 }).catch(() => undefined);

  // ---- Whiteboard on #raid-strategy --------------------------------------------------------------------------
  await step("whiteboard", async () => {
    await mira.page.goto(`${strategyUrl}/whiteboard`);
    await mira.page.getByRole("button", { name: "Open whiteboard" }).click();
    const board = mira.page.getByTestId("whiteboard-board");
    await expect(board).toHaveAttribute("data-role", "owner", { timeout: 30_000 });
    const canvas = mira.page.getByTestId("whiteboard-canvas");
    await expect(canvas).toBeVisible();
    // The route sketch (assets/whiteboard.png) as the board's background image, through the media pipeline of the
    // node (fit into 1280 px, locked at the back); the board then zooms to fit it.
    await mira.page.getByRole("button", { name: "Background", exact: true }).click();
    await mira.page.getByRole("dialog").getByLabel("Background image", { exact: true }).setInputFiles({ name: "route-sketch.png", mimeType: "image/png", buffer: asset("whiteboard") });
    await expect(board).toHaveAttribute("data-images", "1", { timeout: 30_000 });
    await expect(mira.page.getByRole("dialog")).toHaveCount(0);
    await mira.page.waitForTimeout(800);
    const b = (await canvas.boundingBox())!;
    // Screen position of a point given as a fraction of the picture: the image is centred on the scene origin, and
    // the canvas exposes Excalidraw's zoom and scroll (data-zoom, data-scroll).
    const zoom = Number(await canvas.getAttribute("data-zoom"));
    const [scrollX, scrollY] = (await canvas.getAttribute("data-scroll"))!.split(",").map(Number) as [number, number];
    const [imgW, imgH] = [1280, 717];
    const at = (fx: number, fy: number) => ({ x: b.x + ((fx - 0.5) * imgW + scrollX) * zoom, y: b.y + ((fy - 0.5) * imgH + scrollY) * zoom });
    const drag = async (tool: string, from: [number, number], to: [number, number]) => {
      await mira.page.getByTestId(`toolbar-${tool}`).click({ force: true });
      const p = at(...from);
      const q = at(...to);
      await mira.page.mouse.move(p.x, p.y);
      await mira.page.mouse.down();
      await mira.page.mouse.move(q.x, q.y, { steps: 12 });
      await mira.page.mouse.up();
    };
    const label = async (pos: [number, number], words: string) => {
      await mira.page.getByTestId("toolbar-text").click({ force: true });
      const p = at(...pos);
      await mira.page.mouse.click(p.x, p.y);
      await mira.page.keyboard.type(words);
      await mira.page.keyboard.press("Escape");
    };
    // Labels first, strokes afterwards (a click with the text tool on a shape binds or selects instead).
    await label([0.04, 0.7], "Start");
    await label([0.75, 0.47], "Boss");
    await label([0.5, 0.05], "Shortcut: skip the bridge");
    await drag("ellipse", [0.65, 0.4], [0.74, 0.58]);
    await drag("arrow", [0.66, 0.2], [0.69, 0.38]);
    // A hand-drawn wavy underline below the note.
    await mira.page.getByTestId("toolbar-freedraw").click({ force: true });
    const start = at(0.5, 0.1);
    await mira.page.mouse.move(start.x, start.y);
    await mira.page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      const p = at(0.5 + (0.19 * i) / 24, 0.1 + 0.008 * Math.sin(i / 2));
      await mira.page.mouse.move(p.x, p.y);
    }
    await mira.page.mouse.up();
    await mira.page.keyboard.press("Escape");
    await mira.page.getByTestId("toolbar-selection").click({ force: true }).catch(() => undefined);
    await mira.page.mouse.click(b.x + b.width - 60, b.y + b.height - 160);
    await mira.page.keyboard.press("Escape");
    await expect.poll(async () => Number(await board.getAttribute("data-elements")), { timeout: 15_000 }).toBeGreaterThanOrEqual(7);
    await shot(mira.page, "whiteboard", { alt: "The whiteboard of the channel raid-strategy with a route sketch as its background image, waypoints joined by arrows towards a cross, and notes drawn on top: Start, Boss with a circle around the cross, an arrow and the note Shortcut: skip the bridge.", caption: "Every channel and conversation has a whiteboard for sketching together, synchronised end-to-end encrypted.", use: ["landing", "docs"] });
    await mira.page.goto(general);
  });

  // ---- Roles editor -----------------------------------------------------------------------------------------
  await step("roles", async () => {
    await mira.page.goto(`/rooms/${room.id}/settings/roles`);
    await mira.page.getByTestId("role-list").getByText("Moderator").click();
    await expect(mira.page.getByTestId("role-editor")).toBeVisible();
    await shot(mira.page, "roles", { alt: "The role editor in the room settings with the Moderator role selected: name, colour, show separately and the permission switches.", caption: "Roles and permissions: hierarchy, colour, show separately in the member list, and fine-grained permission switches." });
  });

  // ---- The room seen as the Night Owl role (a preview on the device, read-only) ---------------------------------
  await step("view-as-role", async () => {
    await mira.page.goto(`/rooms/${room.id}/settings/roles`);
    await mira.page.getByTestId("role-list").getByText("Night Owl").click();
    await mira.page.getByTestId("view-as-role").click();
    const dialog = mira.page.getByTestId("view-as-dialog");
    await expect(dialog).toBeVisible();
    const owl = dialog.locator('[data-testid="view-as-role-option"][data-role="Night Owl"]');
    if (!(await owl.isChecked())) await owl.check();
    // Joined yesterday: the whole encrypted history of the demo is inside the role's history window.
    const d = new Date(Date.now() - 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await dialog.getByTestId("view-as-joined").fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    await dialog.getByTestId("view-as-start").click();
    const banner = mira.page.getByTestId("role-preview-banner");
    await expect(banner).toContainText("Viewing as Night Owl", { timeout: 15_000 });
    await expect(mira.page.getByTestId("channel-name")).toBeVisible();
    await mira.page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, general);
    await expect(mira.page.getByTestId("channel-name")).toHaveText("general", { timeout: 15_000 });
    await expect(message(mira.page, "Welcome to")).toBeVisible({ timeout: 30_000 });
    await expect(mira.page.getByTestId("channel-row").filter({ hasText: "officers" })).toHaveCount(0);
    await shot(mira.page, "view-as-role", { alt: "The room Night Owls Gaming previewed as the role Night Owl: a banner Viewing as Night Owl with Exit preview above the channel general, the private channel officers missing from the channel list and the files channel shared-files marked read only for the role, the conversation and the composer as a member with that role sees them.", caption: "View the room as a role: room settings show what a member with only that role sees and may do, read-only on your device." });
    await mira.page.getByTestId("role-preview-exit").click();
    await expect(banner).toHaveCount(0);
  });

  // ---- Files channel ----------------------------------------------------------------------------------------
  await step("files", async () => {
    await mira.page.goto(`/rooms/${room.id}/channels/${files.id}`);
    await expect(mira.page.getByTestId("files-view")).toBeVisible();
    for (const folder of ["Maps", "Clips", "Guides"]) {
      await mira.page.getByTestId("files-new-folder").click();
      await mira.page.getByTestId("files-name-input").fill(folder);
      await mira.page.getByTestId("files-name-submit").click();
      await expect(mira.page.getByText(folder, { exact: true }).first()).toBeVisible();
    }
    const roster = "name,role,class,attendance\n" + ["Mira,healer,druid", "Jonas,tank,warden", "Lena,dps,ranger", "Theo,healer,priest", "Kai,dps,rogue"].map((r, i) => `${r},${90 - i * 3}%`).join("\n") + "\n";
    await mira.page.getByTestId("files-upload-input").setInputFiles([
      { name: "boss-arena.png", mimeType: "image/png", buffer: asset("arena-map") },
      { name: "crystal-golem.png", mimeType: "image/png", buffer: asset("screen-share") },
      { name: "raid-roster.csv", mimeType: "text/csv", buffer: Buffer.from(roster.repeat(12)) },
      { name: "loot-rules.md", mimeType: "text/markdown", buffer: Buffer.from("# Loot rules\n\nNeed before greed. Mounts are rolled at the end.\n".repeat(30)) },
      { name: "speedrun-route.txt", mimeType: "text/plain", buffer: Buffer.from("Skip the bridge, take the left tunnel, pull both packs at the gate.\n".repeat(40)) },
      { name: "keybinds.lua", mimeType: "text/plain", buffer: Buffer.from('bind("shift+space", function() cast("blink") end)\n'.repeat(25)) },
    ]);
    await expect(mira.page.getByTestId("upload-item").and(mira.page.locator('[data-status="done"]'))).toHaveCount(6, { timeout: 30_000 });
    await mira.page.reload();
    await expect(mira.page.getByTestId("files-view")).toBeVisible();
    await expect(mira.page.getByTestId("file-row")).toHaveCount(9, { timeout: 30_000 });
    await shot(mira.page, "files", { alt: "The files channel shared-files with the folders Clips, Guides and Maps and six files such as images, a roster and a route, with their sizes, the uploader and the storage meter.", caption: "Files channels: a shared folder tree per channel, with uploads, previews and a storage meter.", use: ["landing", "docs"] });
  });

  // ---- User settings ----------------------------------------------------------------------------------------
  await step("security", async () => {
    await mira.page.goto("/settings/security");
    const cdp = await mira.page.context().newCDPSession(mira.page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } } as never);
    await mira.page.getByRole("button", { name: "Add passkey" }).click();
    await mira.page.getByLabel("Name of the passkey", { exact: true }).fill("Laptop fingerprint");
    await mira.page.getByRole("button", { name: "Add passkey" }).click();
    const reauth = mira.page.getByTestId("reauth-dialog");
    await reauth.getByTestId("reauth-password").fill(mira.password);
    await reauth.getByTestId("reauth-submit").click();
    await expect(mira.page.getByTestId("passkey-list")).toContainText("Laptop fingerprint", { timeout: 30_000 });
    const toast = mira.page.getByText("Passkey added", { exact: false });
    await toast.locator("xpath=..").getByRole("button").first().click({ timeout: 3_000 }).catch(() => undefined);
    await expect(toast).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
    await mira.page.waitForLoadState("networkidle");
    await shot(mira.page, "security", { alt: "The security settings with an active authenticator app, a passkey named Laptop fingerprint that can also unlock messages, and the recovery codes.", caption: "The mandatory second factor: authenticator app and passkeys, plus recovery codes." });
    await mira.page.evaluate(() => document.querySelector('[data-testid="e2ee-status"]')?.scrollIntoView({ block: "start" }));
    await shot(mira.page, "settings-security", { alt: "The lower part of the security settings: the end-to-end encryption section with the recovery key and the security key, the option to require the recovery key on every start, and changing the password.", caption: "Encryption settings: the recovery key, the security key that proves your devices to others, and an optional lock on every start.", use: ["landing", "docs"] });
  });
  await step("devices", async () => {
    // A second device for the list: a sign-in over the API in the next TOTP window.
    await mira.page.waitForTimeout(31_000 - (Date.now() % 30_000));
    const pre = await (await mira.page.request.post(`${NODE}/api/v1/auth/login`, { data: { username: "mira", password: mira.password, device_name: "Phone" } })).json();
    await mira.page.request.post(`${NODE}/api/v1/auth/second-factor/verify`, { data: { preauth_token: pre.preauth_token, totp_code: totp(mira.secret) } });
    await mira.page.goto("/settings/devices");
    await expect(mira.page.getByTestId("device")).toHaveCount(2, { timeout: 15_000 }).catch(() => undefined);
    await shot(mira.page, "settings-devices", { alt: "The devices settings listing the signed-in devices of the account, the current one marked as this device, each with a button to sign it out.", caption: "Every signed-in device is listed and can be signed out; each device has its own encryption keys." });
  });
  await step("privacy", async () => {
    await mira.page.goto("/settings/privacy");
    await expect(mira.page.getByTestId("metadata-mode")).toBeVisible();
    await shot(mira.page, "settings-privacy", { alt: "The privacy and safety settings: who may send direct messages and friend requests, link previews, image metadata, activity status and blocked users.", caption: "Privacy and safety: direct messages, link previews, metadata removal and blocking.", use: ["landing", "docs"] });
  });
  await step("data", async () => {
    await mira.page.goto("/settings/profile");
    await mira.page.getByTestId("my-data-show").click();
    await expect(mira.page.getByTestId("my-data-summary")).toBeVisible({ timeout: 15_000 });
    await mira.page.evaluate(() => document.querySelector('[data-testid="my-data-summary"]')?.scrollIntoView({ block: "center" }));
    await shot(mira.page, "settings-data", { alt: "The My data section of the profile settings with a summary of what the node stores about the account, by category, and a button to download all of it.", caption: "Your data: a summary of everything the node stores about you, and a full export." });
  });
  await step("notifications", async () => {
    await mira.page.goto("/settings/notifications");
    await expect(mira.page.getByTestId("notification-settings")).toBeVisible();
    await shot(mira.page, "settings-notifications", { alt: "The notification settings with the default mode for all rooms, sounds, desktop notifications and the list of per-room and per-channel overrides.", caption: "Notifications: a default for everything, with overrides per room and channel." });
  });

  // ---- Applications: consent screen, install, bot and webhook messages with embeds ---------------------------
  let planner: { secret: string; username: string } | null = null;
  const signupsUrl = `/rooms/${room.id}/channels/${signups.id}`;
  await step("bots", async () => {
    const perms = (bit(0) | bit(1) | bit(4) | bit(25)).toString();
    const app = await api(lena.page, "POST", "/applications", lena.token, { name: "Raid Planner", description: "Schedules raids, tracks sign-ups and reminds everyone an hour before the pull.", public: true, requested_permissions: perms });
    await api(lena.page, "PUT", `/applications/${app.id}/commands`, lena.token, {
      commands: [
        { name: "raid", description: "Create a raid and open sign-ups", args: [{ name: "when", description: "Day and time, for example Friday 21:00", type: "string", required: true }] },
        { name: "signup", description: "Sign up for the next raid", args: [{ name: "role", description: "Tank, healer or damage", type: "string", options: [{ name: "Tank", value: "tank" }, { name: "Healer", value: "healer" }, { name: "Damage", value: "dps" }] }] },
        { name: "remind", description: "Remind everyone before the pull" },
      ],
    });
    await mira.page.goto(`/add/${app.id}`);
    await expect(mira.page.getByTestId("add-app-consent")).toBeVisible();
    await mira.page.locator(`[data-testid="add-app-room"][data-room="${room.id}"]`).click().catch(() => undefined);
    await shot(mira.page, "consent", { alt: "The consent screen for adding the bot Raid Planner to the room Night Owls Gaming, listing its owner, the permissions it asks for and a notice that a bot reads the encrypted channels it can view.", caption: "Adding a bot: who owns it, the permissions it asks for, and a plain notice about encrypted channels." });
    await api(mira.page, "POST", `/rooms/${room.id}/applications`, mira.token, { application: `localhost/${app.id}`, permissions: perms });
    const botToken = await api(lena.page, "POST", `/applications/${app.id}/tokens`, lena.token, { name: "main" });
    planner = { secret: botToken.secret, username: app.bot.username };
    await lena.page.goto(signupsUrl);
    await send(lena.page, "Sign-ups for Friday are open, Raid Planner keeps the list. Tell it your role with `/signup` 🙌");
    await api(lena.page, "POST", `/rooms/${room.id}/channels/${signups.id}/messages`, botToken.secret, {
      content: {
        type: "text",
        body: "New raid scheduled by **Lena Park**",
        embeds: [
          {
            title: "Sunken Citadel (hard mode)",
            description: "Friday 21:00 · bring flasks and the dodge bind from #general",
            color: 0xf0a35e,
            fields: [
              { name: "🛡️ Tanks", value: "Jonas, Mira (2/2)", inline: true },
              { name: "💚 Healers", value: "Theo (1/2)", inline: true },
              { name: "⚔️ Damage", value: "Lena, Kai (2/6)", inline: true },
            ],
            footer: "Reminder one hour before the pull",
          },
        ],
      },
    });
    const hook = await api(mira.page, "POST", `/rooms/${room.id}/channels/${signups.id}/webhooks`, mira.token, { name: "Patch Notes" });
    const hookPath = (hook.url as string).slice((hook.url as string).indexOf("/api/v1/"));
    const hookResp = await mira.page.request.post(`${NODE}${hookPath}?wait=true`, {
      data: {
        username: "Patch Notes",
        content: {
          type: "text",
          body: "",
          embeds: [{ title: "Season 4 patch: what changes for raids", description: "Hard mode for the Sunken Citadel, a shorter enrage timer and **new loot tables**.", color: 0x9b8cff, fields: [{ name: "Enrage", value: "9:00 → 8:15", inline: true }, { name: "Loot", value: "+2 drops", inline: true }] }],
        },
      },
    });
    if (!hookResp.ok()) throw new Error(`webhook: ${hookResp.status()} ${await hookResp.text()}`);
    await mira.page.goto(signupsUrl);
    await expect(mira.page.getByTestId("message-embed")).toHaveCount(2, { timeout: 30_000 });
    await shot(mira.page, "bots", { alt: "The channel raid-signups with a message from the bot Raid Planner showing a raid embed with sign-ups for tanks, healers and damage, and a webhook message with patch notes.", caption: "Bots and webhooks post rich embeds; bots get their own permissions and a BOT badge.", use: ["landing", "docs"] });
    await mira.page.goto(`/rooms/${room.id}/settings/applications`);
    await expect(mira.page.getByTestId("room-application-list")).toBeVisible();
    await mira.page.getByTestId("room-application-commands").first().click().catch(() => undefined);
    await shot(mira.page, "room-applications", { alt: "The Applications tab of the room settings with the installed bot Raid Planner, its permissions and its three slash commands, each with a switch.", caption: "Installed applications per room, with their permissions and commands." });
  });

  // ---- A date poll in #raid-signups (plaintext; created and answered through the UI) ---------------------------
  await step("poll-date", async () => {
    const question = "Season 4 launch raid: which evening works for you?";
    // Three evenings a week from now with three start times each (in the browser's time zone).
    const days = [7, 8, 9].map((n) => {
      const d = new Date(Date.now() + n * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const times = ["19:00", "20:30", "22:00"];
    await lena.page.goto(signupsUrl);
    await expect(lena.page.getByLabel("Message", { exact: true })).toBeEnabled({ timeout: 30_000 });
    await lena.page.getByTestId("composer-plus").click();
    await lena.page.getByTestId("plus-date-poll").click();
    const dialog = lena.page.getByRole("dialog", { name: "Create a poll" });
    await dialog.getByLabel("Question", { exact: true }).fill(question);
    const calendar = dialog.getByTestId("poll-calendar");
    for (const day of days) {
      const cell = calendar.locator(`[data-day="${day}"]`);
      if (!(await cell.count())) await dialog.getByRole("button", { name: "Next month" }).click();
      await cell.click();
    }
    const groups = dialog.getByTestId("poll-day");
    await expect(groups).toHaveCount(3);
    for (let d = 0; d < 3; d++) {
      const group = groups.nth(d);
      await group.getByText("All day").click();
      for (let k = 0; k < times.length; k++) {
        if (k > 0) await group.getByTestId("poll-add-time").click();
        await group.getByTestId("poll-time-start").nth(k).fill(times[k]!);
      }
    }
    await expect(dialog.getByTestId("poll-zone")).toContainText("9 of 60 slots");
    await dialog.getByText("1 week", { exact: true }).click();
    await dialog.getByTestId("poll-create").click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    // The answers per slot (s1 … s9: day by day, then by time): yes, maybe or no.
    const answers: [Demo, string][] = [
      [lena, "yyn mym nnn"],
      [jonas, "ymm yyn myn"],
      [theo, "myy yyy nmy"],
      [kai, "nyy yym nny"],
      [mira, "yyn yyy mnn"],
    ];
    const label = { y: "Yes", m: "Maybe", n: "No" } as const;
    for (const [u, pattern] of answers) {
      if (u !== lena) await u.page.goto(signupsUrl);
      const poll = u.page.getByTestId("poll").filter({ hasText: question });
      await expect(poll).toBeVisible({ timeout: 30_000 });
      const marks = pattern.replace(/ /g, "").split("") as (keyof typeof label)[];
      for (const [i, m] of marks.entries()) await poll.locator(`[data-testid="poll-slot"][data-slot="s${i + 1}"]`).locator("label", { hasText: label[m] }).click();
      await poll.getByTestId("poll-vote").click();
      await expect(poll).toHaveAttribute("data-view", "results", { timeout: 20_000 });
    }
    const poll = mira.page.getByTestId("poll").filter({ hasText: question });
    await expect(poll.getByTestId("poll-voters")).toHaveText("5 votes", { timeout: 30_000 });
    await poll.scrollIntoViewIfNeeded();
    await shot(mira.page, "poll-date", { alt: "A date poll in the channel raid-signups, Season 4 launch raid: which evening works for you?, showing the results as a compact grid with three evenings as columns and three start times as rows, yes and maybe counts per slot, a star on the best slot, which is summarised above the grid, and Mira's own answers as badges.", caption: "Date polls find the evening that suits most: the results are a compact grid of days and times, shown in your own time zone.", use: ["docs"] });
  });

  // ---- Message components: the Raid Planner's sign-up card with buttons, a select menu and a form -------------
  await step("components", async () => {
    if (!planner) throw new Error("the bots step did not create the Raid Planner");
    bot = await startBot(planner.secret);
    await lena.page.goto(signupsUrl);
    await send(lena.page, `@${planner.username} post the sign-up card for Friday, please`);
    await mira.page.goto(signupsUrl);
    const card = mira.page.getByTestId("message").filter({ has: mira.page.getByTestId("message-components") }).last();
    await expect(card).toBeVisible({ timeout: 45_000 });
    await card.getByRole("button", { name: /Sign up/ }).click();
    await expect(card.getByTestId("interaction-ephemeral")).toBeVisible({ timeout: 20_000 });
    await card.getByTestId("component-select-trigger").click();
    await expect(card.getByRole("listbox")).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await shot(mira.page, "components", { alt: "A message of the bot Raid Planner in the channel raid-signups: a sign-up card with an embed of tanks, healers and damage, the buttons Sign up, Bench me, Leave a note and the link button Raid guide, and the select menu Choose your role open with Tank, Healer and Damage and their descriptions; under the card the bot's answer You are on the list for Friday, marked Only you can see this.", caption: "Bots can add buttons, select menus and forms to their messages, drawn with the app's own controls; an answer can be visible to you alone.", use: ["landing", "docs"] });
    await mira.page.keyboard.press("Escape");
    await card.getByRole("button", { name: /Leave a note/ }).click();
    const form = mira.page.getByRole("dialog", { name: "A note for the raid lead" });
    await expect(form).toBeVisible({ timeout: 20_000 });
    await form.getByLabel("When can you be there?").fill("20:45");
    await form.locator("textarea").first().fill("I can tank the first pull if Jonas is late, and I will bring flasks for everyone.");
    await mira.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shot(mira.page, "components-modal", { alt: "The form A note for the raid lead that the Raid Planner bot opened after a click on Leave a note: the bot's name with the BOT badge, a one-line field When can you be there? with 20:45 and a note field with a character counter, and the buttons Cancel and Send.", caption: "A bot's form opens as a dialog of the app; required fields and lengths are checked before anything is sent." });
    await form.getByTestId("component-modal-submit").click();
    await expect(form).toBeHidden({ timeout: 20_000 });
  });
  if (bot && bot.exitCode === null) bot.kill("SIGTERM");

  // ---- Moderation: auto-moderation rules and a report --------------------------------------------------------
  await step("automod", async () => {
    await api(mira.page, "PUT", `/rooms/${room.id}/automod`, mira.token, {
      rules: [
        { name: "Scam phrases", action: "block", terms: ["free gold", "free mounts", "account giveaway"], whole_word: false, enabled: true },
        { name: "Unknown link shorteners", action: "delete", links: "block_list", domains: ["short.example", "gold-giveaway.example"], enabled: true },
        { name: "Insults", action: "timeout", timeout_minutes: 10, terms: ["noob*", "trash player"], enabled: true },
      ],
    });
    await mira.page.goto(`/rooms/${room.id}/settings/automod`);
    await expect(mira.page.getByTestId("automod-rule")).toHaveCount(3, { timeout: 15_000 });
    await shot(mira.page, "room-automod", { alt: "The Auto-moderation tab of the room settings with three rules: blocked scam phrases, a block list of link domains and a timeout for insults.", caption: "Auto-moderation rules per room: words and links, with block, delete or timeout as the action." });
  });
  await step("moderation", async () => {
    const shotsUrl = `/rooms/${room.id}/channels/${screenshots.id}`;
    await kai.page.goto(shotsUrl);
    await expect(kai.page.getByTestId("channel-name")).toHaveText("screenshots");
    await send(kai.page, "Selling my raid carry service, DM me for prices 💰💰💰 first 10 people get a discount!!!");
    await expect(message(kai.page, "raid carry service")).toBeVisible({ timeout: 30_000 });
    await theo.page.goto(shotsUrl);
    const spam = message(theo.page, "raid carry service");
    await expect(spam).toBeVisible({ timeout: 45_000 });
    await contextMenu(spam);
    await theo.page.getByTestId("message-menu").getByRole("menuitem", { name: "Report message" }).click();
    const dialog = theo.page.getByTestId("report-dialog");
    await dialog.getByTestId("report-category").selectOption("spam");
    await dialog.getByTestId("report-detail").fill("Posted the same advert in three channels tonight.");
    await dialog.getByTestId("report-consent").check({ timeout: 5_000 }).catch(() => undefined);
    await dialog.getByTestId("report-submit").click();
    await expect(theo.page.getByText("Report sent")).toBeVisible({ timeout: 15_000 });
    await jonas.page.goto(`/rooms/${room.id}/settings/reports`);
    await jonas.page.getByTestId("report-row").first().click();
    await expect(jonas.page.getByTestId("report-detail")).toBeVisible({ timeout: 15_000 });
    await shot(jonas.page, "moderation", { alt: "The reports inbox of the room settings, seen by a moderator: one open spam report with the reporter, the category, the note and the reported message as evidence, and actions such as a timeout.", caption: "Reports go to the room's moderators with the evidence the reporter chose to share, even from encrypted channels.", use: ["landing", "docs"] });
  });

  // ---- Invites tab, channel creation, channel notifications ---------------------------------------------------
  await step("invites", async () => {
    await api(mira.page, "POST", `/rooms/${room.id}/invites`, mira.token, { max_uses: 10, expires_hours: 168 });
    await api(mira.page, "POST", `/rooms/${room.id}/invites`, mira.token, { expires_hours: 0 });
    await mira.page.goto(`/rooms/${room.id}/settings/invites`);
    await expect(mira.page.getByTestId("invite-row").first()).toBeVisible({ timeout: 15_000 });
    await shot(mira.page, "invites", { alt: "The Invites tab of the room settings with the form to create an invite link with a maximum number of uses and an expiry, and the list of active invites with their uses.", caption: "Invite links with a use limit and an expiry; each can be revoked." });
  });
  // ---- Room rules in Markdown on the invite page (they are asked for on joining only, so they are set this late) ---
  await step("invite-rules", async () => {
    await api(mira.page, "PATCH", `/rooms/${room.id}`, mira.token, {
      rules:
        "### Raid night\n\n1. Be in **Raid Night** before the pull.\n2. **Flasks** from phase two.\n3. Sign up by Thursday.\n\n### Always\n\n- Be kind, **no spoilers**.\n- Loot is *need before greed*.\n",
    });
    const invite = await api(mira.page, "POST", `/rooms/${room.id}/invites`, mira.token, { max_uses: 1, expires_hours: 24 });
    for (const vp of [DESKTOP, PHONE]) {
      await kai.page.setViewportSize(vp);
      await kai.page.goto(`/invite/${invite.code}`);
      await expect(kai.page.getByTestId("invite-room-name")).toHaveText("Night Owls Gaming", { timeout: 30_000 });
      await expect(kai.page.getByTestId("room-rules").locator("h3")).toHaveCount(2);
      await kai.page.getByLabel("I accept the rules", { exact: true }).check();
      await kai.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      if (vp === DESKTOP) await shot(kai.page, "invite-rules", { alt: "The invite page of the room Night Owls Gaming with its illustrated icon and the member count, the room's rules rendered from Markdown with the headings Raid night and Always, a numbered list and a bulleted list with bold and italic words, the ticked box I accept the rules and the Join button.", caption: "An invite link shows the room and its rules before you join; rules are written in Markdown and must be accepted first." });
      else await shot(kai.page, "invite-rules", { alt: "The same invite page on a phone: the room icon, the name Night Owls Gaming, the rules with their headings and lists, the accepted rules and the Join button.", caption: "The invite page on a phone." });
    }
    await kai.page.setViewportSize(DESKTOP);
  });
  await step("channel-create", async () => {
    await mira.page.goto(general);
    await mira.page.getByRole("button", { name: /Create channel/ }).click();
    const create = mira.page.getByRole("dialog", { name: "Create channel" });
    await expect(create).toBeVisible();
    await create.locator('input[name="channel_name"]').fill("patch-notes");
    await shot(mira.page, "channel-create", { alt: "The Create channel dialog with the channel type selector and the name patch-notes typed in.", caption: "Creating a channel: text, announcements, forum, voice or files." });
    await mira.page.keyboard.press("Escape");
  });
  await step("menu-notifications", async () => {
    await mira.page.goto(general);
    await contextMenu(mira.page.getByTestId("channel-row").filter({ hasText: "raid-strategy" }));
    await mira.page.getByTestId("channel-menu").getByRole("menuitem", { name: "Notifications" }).click();
    await expect(mira.page.getByTestId("context-submenu")).toBeVisible();
    await shot(mira.page, "menu-notifications", { alt: "The context menu of the channel raid-strategy with the Notifications submenu open: default, all messages, only mentions or nothing.", caption: "Notifications per channel or room, from the context menu." }, { keepMouse: true });
    await mira.page.keyboard.press("Escape");
    await mira.page.keyboard.press("Escape");
  });

  // ---- Friends, verification and a direct message ----------------------------------------------------------
  await step("friends-dm", async () => {
    for (const friend of [lena, jonas, theo]) {
      await api(mira.page, "POST", "/users/me/friends/requests", mira.token, { user: friend.username });
      const list = await api(friend.page, "GET", "/users/me/friends", friend.token);
      for (const r of list.incoming) await api(friend.page, "POST", `/users/me/friends/requests/${r.id}/accept`, friend.token, {});
    }
    await api(kai.page, "POST", "/users/me/friends/requests", kai.token, { user: "mira", message: "Hi! Saw your speedrun guide, want to team up?" });
    try {
      await lena.page.goto("/friends");
      await lena.page.getByTestId("friends-list").locator("li").filter({ hasText: "mira@localhost" }).getByTestId("verify-button").click();
      const lenaCode = await lena.page.getByTestId("verify-dialog").getByTestId("verify-payload").inputValue();
      await mira.page.goto("/friends");
      await mira.page.getByTestId("friends-list").locator("li").filter({ hasText: "lena@localhost" }).getByTestId("verify-button").click();
      const vd = mira.page.getByTestId("verify-dialog");
      await vd.getByLabel("Scanned or pasted code of the other person").fill(lenaCode);
      await vd.getByRole("button", { name: "Compare" }).click();
      await vd.getByRole("button", { name: "Mark as verified" }).click();
      await expect(vd.getByTestId("verify-state")).toHaveAttribute("data-state", "verified");
      await vd.getByRole("button", { name: "Close", exact: true }).click();
      await lena.page.keyboard.press("Escape");
    } catch (e) {
      console.warn("verification failed:", e);
    }
    // Theo hangs out in the Lounge: the friends list says where (and the rail's room icon carries the voice badge).
    await theo.page.goto(`/rooms/${room.id}/channels/${voice.id}`);
    await theo.page.getByTestId("voice-join").click();
    await expect(theo.page.getByTestId("voice-stage")).toBeVisible({ timeout: 30_000 });
    await mira.page.goto("/friends");
    await expect(mira.page.getByTestId("friends-list").locator("li")).toHaveCount(3, { timeout: 15_000 });
    await expect(mira.page.getByTestId("friends-list").getByText(/In voice/)).toBeVisible({ timeout: 20_000 }).catch(() => undefined);
    await shot(mira.page, "friends", { alt: "The friends page with three friends, Lena Park marked with a verified badge, Theo Laurent shown in voice in the Lounge of Night Owls Gaming, and an incoming friend request from Kai Brennan with a short message.", caption: "Friends, friend requests and verified contacts: verification compares safety numbers in person or by QR code, and a friend in voice shows where." });
    await theo.page.getByTestId("voice-leave").first().click({ timeout: 5_000 }).catch(() => undefined);
    await mira.page.getByTestId("friends-list").locator("li").filter({ hasText: "lena@localhost" }).getByRole("button", { name: "Message" }).click();
    await expect(mira.page.getByTestId("conversation-name")).toBeVisible({ timeout: 30_000 });
    const dmUrl = new URL(mira.page.url()).pathname;
    await send(mira.page, "Are you still up for testing the new route tonight?");
    await lena.page.goto(dmUrl);
    await expect(message(lena.page, "new route tonight")).toBeVisible({ timeout: 30_000 });
    await send(lena.page, "Yes! I sketched the shortcut on the whiteboard in #raid-strategy, have a look 👀");
    await expect(message(mira.page, "sketched the shortcut")).toBeVisible({ timeout: 30_000 });
    await send(mira.page, "Looks great. If it saves two minutes, Theo owes us snacks 😄");
    await expect(message(lena.page, "owes us snacks")).toBeVisible({ timeout: 30_000 });
    await send(lena.page, "Deal. I'll ping you at 20:45, bring the flasks.");
    await expect(message(mira.page, "20:45")).toBeVisible({ timeout: 30_000 });
    await react(lena.page, "owes us snacks", "😂");
    await expect(message(mira.page, "owes us snacks").getByRole("button", { name: /😂 1/ })).toBeVisible({ timeout: 30_000 });
    await shot(mira.page, "dm", { alt: "A direct message conversation between Mira Okafor and Lena Park, end-to-end encrypted, with their illustrated avatars beside the messages, Lena shown as a verified contact in the header and the list of direct messages on the left.", caption: "Direct messages with friends, end-to-end encrypted, with verified contacts marked.", use: ["landing", "docs"] });
  });

  // ---- Discover: public rooms of the other members ---------------------------------------------------------
  const publicRooms: Record<string, { id: string; channels: { id: string; kind: string }[] }> = {};
  await step("discover", async () => {
    const listed: [Demo, string, string, string, Demo[]][] = [
      [kai, "Indie Dev Lounge", "Devlogs, playtests and honest feedback for small game projects. Show us your pixels.", "room-indie-dev", [jonas, theo]],
      [theo, "Late Night Music", "Lo-fi sessions, synth patches and a listening party every Thursday after midnight.", "room-late-night-music", [jonas, lena, kai]],
      [lena, "Study Group", "Quiet focus sessions, shared notes and exam prep together. Every subject welcome.", "room-study-group", [kai]],
    ];
    for (const [owner, name, description, icon, members] of listed) {
      const r = await api(owner.page, "POST", "/rooms", owner.token, { name, description, join_mode: "public" });
      publicRooms[name] = r;
      await api(owner.page, "PATCH", `/rooms/${r.id}`, owner.token, { discoverable: true });
      await roomIcon(owner, r.id, icon);
      for (const member of members) await api(member.page, "POST", `/rooms/${r.id}/join`, member.token, {}).catch(() => undefined);
    }
    await mira.page.goto("/discover");
    await expect(mira.page.getByTestId("discover-room")).toHaveCount(3, { timeout: 30_000 });
    await expect(mira.page.getByTestId("discover-room").getByTestId("avatar-image")).toHaveCount(3, { timeout: 30_000 }).catch(() => undefined);
    await shot(mira.page, "discover", { alt: "The Discover page listing three public rooms of this node, Late Night Music, Indie Dev Lounge and Study Group, each with an illustrated icon, the member count, a description and a Join button.", caption: "Discover public rooms on this node and on the nodes it knows.", use: ["landing", "docs"] });
  });

  // ---- Room rail: a folder of three rooms, voice activity, the room card ------------------------------------
  await step("rail-folders", async () => {
    const names = ["Late Night Music", "Indie Dev Lounge", "Study Group"];
    for (const name of names) await api(mira.page, "POST", `/rooms/${publicRooms[name]!.id}/join`, mira.token, {});
    // Theo and Kai listen in the voice channel of Late Night Music: the room's rail icon gets the voice badge.
    const music = publicRooms["Late Night Music"]!;
    const musicVoice = music.channels.find((c) => c.kind === "voice")!;
    for (const u of [theo, kai]) {
      await u.page.goto(`/rooms/${music.id}/channels/${musicVoice.id}`);
      await u.page.getByTestId("voice-join").click();
      await expect(u.page.getByTestId("voice-stage")).toBeVisible({ timeout: 30_000 });
    }
    await mira.page.goto(general);
    await expect(message(mira.page, "Welcome to")).toBeVisible({ timeout: 30_000 });
    const rail = mira.page.getByTestId("room-rail");
    const railRoom = (name: string) => rail.getByRole("link", { name: new RegExp(`^${name}(, .+)?$`) });
    await expect(railRoom("Study Group")).toBeVisible({ timeout: 30_000 });
    await rail.getByTestId("rail-end").click({ button: "right" });
    await mira.page.getByTestId("rail-menu").getByRole("menuitem", { name: "New folder…" }).click();
    const dialog = mira.page.getByTestId("folder-dialog");
    await dialog.getByLabel("Name").fill("Hangouts");
    await dialog.getByText("Violet").click();
    await dialog.getByRole("button", { name: "Create folder" }).click();
    await expect(dialog).toHaveCount(0);
    for (const name of names) {
      await railRoom(name).click({ button: "right", position: { x: 12, y: 12 } });
      await mira.page.getByTestId("room-menu").getByRole("menuitem", { name: "Move to folder" }).click();
      await mira.page.getByTestId("context-submenu").getByRole("menuitem", { name: "Hangouts" }).click();
      await expect(railRoom(name)).toHaveCount(0);
    }
    const folder = rail.getByTestId("rail-folder-button");
    await expect(folder).toHaveAccessibleName(/^Folder Hangouts, 3 rooms/);
    await folder.click();
    await expect(folder).toHaveAttribute("aria-expanded", "true");
    // The card names the people in voice with the member entries another view loaded: open the room once (in the
    // app, so the entries stay), then go back to #general.
    await railRoom("Late Night Music").click();
    await expect(mira.page.getByText("Theo Laurent").first()).toBeVisible({ timeout: 30_000 });
    await mira.page.waitForTimeout(1500);
    await railRoom("Night Owls Gaming").click();
    await expect(message(mira.page, "Welcome to")).toBeVisible({ timeout: 30_000 });
    // The room card of Late Night Music (the pointer rests on its icon): members, description and who is in voice.
    await railRoom("Late Night Music").hover();
    await expect(mira.page.getByTestId("room-card-participant").locator("img")).toHaveCount(2, { timeout: 15_000 }).catch(() => undefined);
    await expect(mira.page.getByTestId("room-card-voice")).toBeVisible({ timeout: 15_000 });
    await shot(mira.page, "rail-folders", { alt: "The room rail on the left with Night Owls Gaming and the expanded violet folder Hangouts holding Late Night Music, Indie Dev Lounge and Study Group; Late Night Music carries a green voice badge, and its room card shows the member count, the description and the avatars of Theo and Kai in its voice channel.", caption: "Group rooms into folders in the rail; badges and the room card show who is in voice without opening the room." }, { keepMouse: true });
    await mira.page.mouse.move(DESKTOP.width - 2, DESKTOP.height / 2);
    for (const u of [theo, kai]) await u.page.getByTestId("voice-leave").first().click({ timeout: 5_000 }).catch(() => undefined);
  });

  // ---- Room settings → Channels: reordering by drag and drop (a drag in progress), the override editor's hint -----
  // A second category for the raid channels, made this late so the sidebars of the other scenes stay as they are.
  let raidsCategory: string | null = null;
  await step("channel-order", async () => {
    const raids = await api(mira.page, "POST", `/rooms/${room.id}/categories`, mira.token, { name: "Raids" });
    raidsCategory = raids.id;
    for (const c of [raid, signups]) await api(mira.page, "PATCH", `/rooms/${room.id}/channels/${c.id}`, mira.token, { category_id: raids.id });
    await mira.page.goto(`/rooms/${room.id}/settings/channels?channel=${screenshots.id}`);
    const tree = mira.page.getByTestId("channel-tree");
    await expect(tree.locator(`[data-testid="channel-tree-category"][data-category="${raids.id}"]`)).toBeVisible({ timeout: 15_000 });
    // screenshots is picked up by its handle and held over the category Raids (the drop target's ring).
    const row = tree.locator(`[data-testid="channel-tree-row"][data-channel="${screenshots.id}"]`);
    const from = (await row.getByTestId("reorder-handle").boundingBox())!;
    const to = (await tree.locator(`[data-testid="channel-tree-category"][data-category="${raids.id}"]`).boundingBox())!;
    await mira.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await mira.page.mouse.down();
    await mira.page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    await mira.page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 12 });
    // Playwright sends drag events on mouse moves only: a last small move inside the header, after the dragleave of
    // its children, so the header keeps its drop ring.
    await mira.page.mouse.move(to.x + 62, to.y + to.height / 2);
    await expect(row).toHaveClass(/opacity-50/, { timeout: 5_000 });
    await expect(tree.locator(`[data-testid="channel-tree-category"][data-category="${raids.id}"]`)).toHaveClass(/ring-2/, { timeout: 5_000 });
    await shot(mira.page, "channel-order", { alt: "Room settings, Channels, of Night Owls Gaming: the channel tree with a drag handle and up and down arrows on every channel and category, the channel screenshots dimmed while it is dragged onto the highlighted category Raids, which holds Raid Night and raid-signups, and the editor of the selected channel beside the tree.", caption: "Channels and categories are reordered in the room settings: drag them by the handle or use the arrows." }, { keepMouse: true });
    // Back over its own row: the drop changes nothing.
    await mira.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 12 });
    await mira.page.mouse.up();
    await expect(row).not.toHaveClass(/opacity-50/, { timeout: 5_000 });
  });
  // The category Raids starts every newcomer fresh: @everyone may not read the history from before joining there.
  await step("overrides-hint", async () => {
    if (!raidsCategory) throw new Error("the channel-order step did not create the category Raids");
    await api(mira.page, "PUT", `/rooms/${room.id}/overrides`, mira.token, { target_type: "category", target_id: raidsCategory, subject_type: "role", subject_id: everyone, allow: "0", deny: bit(34).toString() });
    await mira.page.goto(`/rooms/${room.id}/settings/channels?category=${raidsCategory}`);
    const editor = mira.page.getByTestId("category-editor");
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.getByRole("combobox", { name: "Role", exact: true }).selectOption({ label: "Night Owl" });
    await expect(editor.getByTestId("inherited-READ_HISTORY")).toHaveText("Inherited: denied by @everyone here", { timeout: 15_000 });
    await shot(mira.page, "overrides-hint", { alt: "Room settings, Channels: the permissions of the category Raids for the role Night Owl beside the channel tree, every permission left neutral with its inherited value in grey: Read history from before joining denied by @everyone here, View channel, Add reactions and the others allowed or denied by the roles.", caption: "A permission left neutral shows in grey what it inherits: from the roles, the category, or @everyone in the same layer." });
  });

  // ---- Legal documents and the legal settings tab ------------------------------------------------------------
  await step("legal", async () => {
    await api(mira.page, "PUT", "/admin/legal/documents/privacy", mira.token, {
      lang: "en",
      markdown:
        "# Privacy policy\n\nThis demo node is run by the Night Owls community for testing.\n\n## What we store\n\n- Your account (username, display name, date of birth, password hash)\n- Encrypted messages we cannot read\n- Files in files channels, encrypted at rest\n\n## How long\n\nUntil you delete your account. Deleted accounts are removed within 30 days.\n\n## Contact\n\nadmin@nightowls.example\n",
    });
    await api(mira.page, "PUT", "/admin/legal/documents/imprint", mira.token, { lang: "en", markdown: "# Imprint\n\nNight Owls demo node\n\nContact: admin@nightowls.example\n" });
    await mira.page.goto("/settings/legal");
    await expect(mira.page.getByTestId("settings-legal-docs")).toBeVisible();
    await shot(mira.page, "settings-legal", { alt: "The Legal and privacy settings with the node's published documents, the privacy policy and the imprint, and the section for notices about your own content.", caption: "Legal and privacy: the node's documents and any notices about your content." });
  });

  // ---- Node administration --------------------------------------------------------------------------------
  await step("admin", async () => {
    await mira.page.goto("/admin");
    await expect(mira.page.getByTestId("admin-stats")).toBeVisible();
    await mira.page.waitForLoadState("networkidle");
    await shot(mira.page, "admin", { alt: "The node administration overview with counters for users, rooms, messages and storage, and the effective configuration of the node.", caption: "Node administration: an overview with counters and the effective configuration.", use: ["landing", "docs"] });
    await mira.page.goto("/admin/reports");
    await mira.page.getByTestId("report-row").first().click({ timeout: 15_000 });
    await expect(mira.page.getByTestId("report-detail")).toBeVisible({ timeout: 15_000 });
    await shot(mira.page, "admin-reports", { alt: "The Reports tab of the node administration: every report of the node, filtered by status and by who handles it, with the spam report about a message of Kai Brennan in Night Owls Gaming opened: the reporter, the note, the message text the reporter released and the moderation actions.", caption: "Node admins see every report of the node; reports about accounts of other nodes can be forwarded to their home node." });
    await mira.page.goto("/admin/federation");
    await expect(mira.page.getByRole("heading", { name: "Other nodes" })).toBeVisible();
    await shot(mira.page, "admin-federation", { alt: "The Federation tab of the node administration with the form to check another node and the list of known nodes, still empty on this demo node.", caption: "Federation: check other nodes for conformance and see which nodes this one knows." });
  });

  if (failures.length) throw new Error(`failed steps:\n${failures.join("\n")}`);
});
