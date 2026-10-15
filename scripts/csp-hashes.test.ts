// SPDX-License-Identifier: Apache-2.0
// The inline-script scanner of scripts/csp-hashes.mjs: which scripts a browser executes (and so needs a hash for).
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cspHash, inlineScripts, writeHashes } from "./csp-hashes.mjs";

describe("inlineScripts", () => {
  it("takes executable inline scripts and skips external and data scripts", () => {
    const html = `<script>a()</script><script type="module">b()</script><script src="/x.js"></script>
      <script type="application/ld+json">{"x":1}</script><SCRIPT TYPE="TEXT/JAVASCRIPT">c()</SCRIPT>`;
    expect(inlineScripts(html)).toEqual(["a()", "b()", "c()"]);
  });

  it("does not mistake data-src or data-type for src and type", () => {
    const html = `<script data-src="/x.js">a()</script><script data-type="json">b()</script><script data-x="1" src='/y.js'></script>`;
    expect(inlineScripts(html)).toEqual(["a()", "b()"]);
  });

  it("reads attributes whose values contain '>'", () => {
    expect(inlineScripts(`<script data-note="a > b">a()</script>`)).toEqual(["a()"]);
  });

  it("hashes the text as the browser sees it: line breaks normalised to LF", () => {
    const [script] = inlineScripts("<script>a();\r\nb();\rc();</script>");
    expect(script).toBe("a();\nb();\nc();");
    expect(cspHash(script!)).toBe(cspHash("a();\nb();\nc();"));
  });
});

describe("writeHashes", () => {
  it("fails when there is no built page to scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "csp-"));
    expect(() => writeHashes(join(dir, "missing"), join(dir, "out.txt"))).toThrow(/no HTML pages/);
    mkdirSync(join(dir, "empty"));
    expect(() => writeHashes(join(dir, "empty"), join(dir, "out.txt"))).toThrow(/no HTML pages/);
  });

  it("writes the sorted, unique hashes without a trailing newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "csp-"));
    mkdirSync(join(dir, "dist", "a"), { recursive: true });
    writeFileSync(join(dir, "dist", "index.html"), "<script>x()</script><script>y()</script>");
    writeFileSync(join(dir, "dist", "a", "index.html"), "<script>x()</script>");
    const n = writeHashes(join(dir, "dist"), join(dir, "out.txt"));
    expect(n).toBe(2);
    expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe([cspHash("x()"), cspHash("y()")].sort().join(" "));
  });
});
