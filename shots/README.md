# Screenshots

The PNG files in `out/` are made by [`make.ts`](make.ts), a Playwright script that drives the tavrn web client against a
local development node. Five fictitious demo accounts (Mira Okafor, Jonas Berg, Lena Park, Theo Laurent, Kai Brennan)
meet in the room "Night Owls Gaming"; three more public rooms (Indie Dev Lounge, Late Night Music, Study Group) fill the
Discover page. Everything shown is created by the script; the node's domain is `localhost`, all other addresses use the
reserved `.example` domain. The pictures (avatars, room icons, the arena map, Mira's camera, Theo's shared screen and the
whiteboard's background) are illustrations in [`assets/`](assets/README.md): the avatars and icons are uploaded through
the API, the camera is a Y4M video made from `cam-mira.png` with `ffmpeg` and played by Chromium's fake capture device,
and the shared screen is a canvas in the page that shows `screen-share.png`. Chromium's fake microphones and speakers
are listed under ordinary device names in the voice quick menus. The bot of the `components` scenes is
[`raid-planner-bot.ts`](raid-planner-bot.ts), started by `make.ts` with the installed `@tavrn/bot` of the tavrn-web
checkout.

[`manifest.json`](manifest.json) lists every image with its scene, viewport, pixel size, alt text, caption and where it
is meant to be used (`landing`, `docs`). The alt texts and captions live next to each capture in `make.ts`; `run.sh`
writes the manifest into the output directory (`<out>/manifest.json`).

## Making them again: one command

```sh
TAVRN_NODE_BIN=/path/to/tavrn-node TAVRN_WEB=/path/to/tavrn-web ./run.sh out
```

`run.sh` needs a [tavrn-web](https://github.com/just-tavrn/tavrn-web) checkout with `pnpm install` done (for its
Playwright installation and the dev server) and a [tavrn-node](https://github.com/just-tavrn/tavrn-node) binary;
`livekit-server` on the `PATH` for voice, `ffmpeg` for the camera video (optional: without it the camera tile shows
Chromium's test pattern). It

1. starts a fresh node with an empty database in a temporary directory (or `SHOTS_DATA`, which is emptied first),
   voice enabled and `mira` as node admin:

   ```sh
   TAVRN_DOMAIN=localhost TAVRN_LISTEN=127.0.0.1:8700 \
   TAVRN_DATABASE_URL="sqlite://$DATA/demo.db?mode=rwc" TAVRN_DATA_DIR=$DATA/data \
   TAVRN_ADMIN_USERS=mira TAVRN_REGISTRATION=open TAVRN_ROOM_CREATION=local \
   TAVRN_WEBAUTHN_ORIGIN=http://localhost:5700 \
   TAVRN_LIVEKIT_PORT=9700 TAVRN_RTC_UDP_PORT_RANGE=50000-50149 TAVRN_RTC_TCP_PORT=10700 \
   TAVRN_RTC_EXTERNAL_IP=<this machine's address on its default route> \
   tavrn-node --dev
   ```

2. starts the web client's dev server on port 5700 against it, unless one is already running there
   (`E2E_NODE_PORT=8700 E2E_WEB_PORT=5700 pnpm --filter @tavrn/web dev` in tavrn-web),
3. copies `make.ts`, `playwright.config.ts` and `raid-planner-bot.ts` into `e2e/shots/` of tavrn-web and runs, from
   `e2e/`,
   `SHOTS_OUT=<out> SHOTS_ASSETS=<this folder>/assets npx playwright test -c shots/playwright.config.ts --project chromium --workers=1`,
4. optimizes the PNGs losslessly (`oxipng`, or the Python binding `pip install pyoxipng`), and
5. stops the node and the dev server it started (by PID), removes `e2e/shots/` and the temporary data directory.

Ports and addresses can be changed with `SHOTS_NODE_PORT`, `SHOTS_WEB_PORT`, `SHOTS_LIVEKIT_PORT`, `SHOTS_RTC_TCP_PORT`,
`SHOTS_RTC_UDP_RANGE` and `SHOTS_MEDIA_IP`. `SHOTS_ONLY=chat,voice` captures only some scenes (the setup always runs
fully); `SHOTS_DEBUG=1` saves a picture of every open page under `out/debug/` when a scene fails. A run takes about
four to six minutes.

The current images were made with (the venv only provides `pyoxipng`):

```sh
PATH=<venv>/bin:$PATH SHOTS_DATA=<work>/node \
TAVRN_NODE_BIN=<tavrn-node build> TAVRN_WEB=<tavrn-web checkout> ./run.sh <work>/out
```

against `tavrn-node 0.4.0-rc.8` (a debug build of tavrn-node `7a93d2a`, 2026-10-15) and tavrn-web `d875382`, with the
`pnpm install` of that commit (its `@tavrn/bot` brings the message components).

Every scene is its own step: a failing scene is logged (`step <name>: FAILED …`) and skipped, the other scenes still
run, and the test fails at the end with the list of failed steps.

## Scenes

All images are 2× (retina): desktop 1440×900 → 2880×1800 px, phone 390×844 → 780×1688 px, dark theme, English.

| Scene | Viewports | Shows | Use |
|---|---|---|---|
| `chat` | desktop, phone | the encrypted channel #general: Markdown, the arena map with a thread, a code block, a spoiler, a reply, reactions, a pinned message, the member list by roles, all with avatars | landing, docs |
| `voice` | desktop, phone | the voice channel Raid Night: Theo's screen share, Mira's camera, avatar tiles, "End-to-end encrypted" | landing, docs |
| `poll` | desktop, phone | a poll in the encrypted channel #raid-strategy after voting: result bars, voters, the own vote marked, Change vote | landing, docs |
| `poll-date` | desktop | a date poll in #raid-signups with the compact results grid (days × times) and the best slot | docs |
| `components` | desktop | a message of the Raid Planner bot with an embed, buttons, a link button and the select menu open, and an answer only Mira sees | landing, docs |
| `components-modal` | desktop | the form the bot opens after "Leave a note" | docs |
| `threads` | desktop | the forum channel #guides with tagged posts and a post open as a thread | landing, docs |
| `files` | desktop | the files channel with folders and files | landing, docs |
| `search` | desktop | the search panel with results from encrypted channels and the status line | landing, docs |
| `dm` | desktop | a direct message with a verified friend | landing, docs |
| `friends` | desktop | the friends page with a verified badge and an incoming request | docs |
| `discover` | desktop | the Discover page with three public rooms and their icons | landing, docs |
| `bots` | desktop | a bot message with an embed and a webhook message in a plaintext channel | landing, docs |
| `consent` | desktop | the consent screen of an application's add link | docs |
| `room-applications` | desktop | room settings → Applications with the bot's commands | docs |
| `moderation` | desktop | room settings → Reports with one open report and its evidence | landing, docs |
| `room-automod` | desktop | room settings → Auto-moderation with three rules | docs |
| `roles` | desktop | room settings → Roles with the Moderator role | docs |
| `invites` | desktop | room settings → Invites | docs |
| `voice-status` | desktop | the voice header with the channel status and the session timer, and the microphone's quick menu | docs |
| `rail-folders` | desktop | the room rail with the folder Hangouts expanded, a voice badge and the room card of Late Night Music | docs |
| `view-as-role` | desktop | the room previewed as the role Night Owl: the banner, the private channel hidden, the access marks | docs |
| `whiteboard` | desktop | the whiteboard of #raid-strategy: a route sketch as background image with notes drawn on top | landing, docs |
| `security` | desktop | settings → Security: second factor, passkey, recovery codes | docs |
| `settings-security` | desktop | settings → Security, lower half: recovery key, identity key | landing, docs |
| `settings-devices` | desktop | settings → Devices | docs |
| `settings-privacy` | desktop | settings → Privacy & safety | landing, docs |
| `settings-data` | desktop | settings → Profile → My data summary | docs |
| `settings-notifications` | desktop | settings → Notifications | docs |
| `settings-legal` | desktop | settings → Legal & privacy with a published privacy policy and imprint | docs |
| `admin` | desktop | node administration overview | landing, docs |
| `admin-reports` | desktop | node administration → Reports with the spam report opened | docs |
| `admin-federation` | desktop | node administration → Federation (no other node known) | docs |
| `login` | desktop, phone | the sign-in card | landing, docs |
| `login-remote` | desktop | "Account of another node" on the sign-in page | docs |
| `register` | desktop | registration step 1 of 4 | docs |
| `onboarding` | desktop | registration step 2 of 4: choose the second factor | docs |
| `onboarding-recovery-key` | desktop | registration step 4 of 4: the recovery key | docs |
| `menu-message` | desktop | the context menu of a message | docs |
| `emoji-picker` | desktop | the emoji picker of the composer | docs |
| `composer-commands` | desktop | the command palette after typing `/` | docs |
| `composer-help` | desktop | the output of `/help` | docs |
| `media-viewer` | desktop | the media viewer on the arena map | docs |
| `channel-create` | desktop | the Create channel dialog | docs |
| `menu-notifications` | desktop | a channel's context menu with the Notifications submenu | docs |

## License

The screenshots and the pictures in [`assets/`](assets/README.md) are CC-BY-4.0; the tavrn logo visible in the
screenshots stays a trademark of the project. The script is Apache-2.0.

## Bringing them into the website

```sh
node shots/import.mjs <out>          # from the website repository; reads <out>/manifest.json
```

copies the PNGs into `src/assets/screenshots/`, removes images the run no longer has, and regenerates
`src/assets/screenshots/manifest.ts`. Keep the scene keys the pages use (`grep -r 'scene=' src`) or update them.
