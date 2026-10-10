// SPDX-License-Identifier: Apache-2.0
/**
 * What the docs sync (scripts/sync-docs.mjs) copies from the git submodules under sources/ into the wiki, and
 * where it goes. Operator and developer documents stay versioned with their code; the user guides are written in
 * this repository (src/content/docs/users/). Every generated page lands in src/content/docs/synced/ (gitignored)
 * with a `slug` that places it in its sidebar group, so the folder can be wiped and rebuilt on every sync.
 *
 * Sidebar order: the groups use `autogenerate` (src/docs-sidebar.ts), sorted by `order`. Hand-written pages of a
 * group sit between the synced ones by their own `sidebar.order`.
 */

/** The GitHub organization of every source repository (links to unsynced files and edit links). */
export const GITHUB = `https://github.com/${process.env.PUBLIC_GITHUB_ORG || "just-tavrn"}`;

/** Where the generated docs pages go (gitignored, wiped on every sync). */
export const OUT_DIR = "src/content/docs/synced";

/** The license of the documents of each source repository, as their LICENSE.md files state it. */
export const LICENSES = /** @type {Record<string, string>} */ ({
  tavrn: "CC-BY-4.0",
  "tavrn-node": "AGPL-3.0-only",
  "tavrn-protocol": "CC-BY-4.0",
  "tavrn-js": "Apache-2.0",
  "tavrn-web": "Apache-2.0",
});

/** @type {import("./lib/docs-transform.mjs").DocConfig[]} */
export const DOCUMENTS = [
  // Node admins: the orientation of the umbrella repository, then the operator handbook, one page per H2.
  {
    repo: "tavrn",
    path: "docs/self-hosting.md",
    slug: "docs/admins/overview",
    title: "Self-hosting: an orientation",
    label: "Overview",
    order: 1,
    description: "What running a tavrn node involves, what you need for it and the decisions you make as an operator.",
  },
  {
    repo: "tavrn-node",
    path: "docs/HANDBOOK.md",
    split: {
      prefix: "docs/admins",
      order: 10,
      drop: ["contents"],
      // The handbook's introduction ("in the order you need it", where the commands run) opens its first page.
      intro: "requirements",
      sections: {
        requirements: {
          slug: "requirements",
          description: "What a tavrn node needs: a Linux host with Docker, a domain, a reverse proxy, PostgreSQL, a data volume and ports for voice.",
        },
        "install-with-docker-compose": {
          slug: "install",
          label: "Install with Docker Compose",
          description: "Install a tavrn node with Docker Compose in eight steps, and what the compose file sets up.",
        },
        configuration: {
          slug: "configuration",
          description: "How a tavrn node loads its configuration, and what the settings of each area mean.",
        },
        "reverse-proxy-and-tls": { slug: "reverse-proxy", label: "Reverse proxy and TLS" },
        "keys-and-backups": {
          slug: "keys-and-backups",
          description: "The key files of a tavrn node, what to back up together with the database, and how to restore.",
        },
        database: {
          slug: "database",
          description: "PostgreSQL for a tavrn node: the bundled container or an existing server, migrations and dumps.",
        },
        "storage-and-media": {
          slug: "storage-and-media",
          description: "Encryption at rest, the storage key, the media pipeline, upload limits, files channels and message retention.",
        },
        federation: { slug: "federation" },
        "voice-and-video": {
          slug: "voice-and-video",
          label: "Voice and video",
          description: "Voice and video on a tavrn node: the bundled media server, its ports, announced addresses, TURN and limits.",
        },
        "web-push": { slug: "web-push" },
        "metrics-and-health": {
          slug: "metrics-and-health",
          description: "The health endpoints, the Prometheus metrics and suggested dashboards and alerts of a tavrn node.",
        },
        "scaling-with-valkey": { slug: "scaling", label: "Scaling with Valkey" },
        "webhooks-and-applications": {
          slug: "webhooks-and-applications",
          label: "Webhooks and applications",
          description: "Applications and bots on a node, incoming webhooks, and sealed webhook posts into encrypted channels.",
        },
        "legal-pages-and-gdpr": { slug: "legal-and-gdpr", label: "Legal pages and GDPR" },
        "moderation-and-auto-moderation": {
          slug: "moderation",
          label: "Moderation",
          description: "Node administration, spam bursts, reports, content auto-moderation and history restores after a key reset.",
        },
        "threads-and-forum-channels": { slug: "threads-and-forums", label: "Threads and forums" },
        "the-doctor-and-other-cli-commands": {
          slug: "doctor-and-cli",
          label: "Doctor and CLI",
          description: "The tavrn-node command line: the doctor, the configuration check and the other maintenance commands.",
        },
        "logs-and-troubleshooting": {
          slug: "troubleshooting",
          label: "Logs and troubleshooting",
          description: "Where a tavrn node logs, and the common problems with their causes and fixes.",
        },
        "upgrade-and-rollback": {
          slug: "upgrade",
          label: "Upgrade and rollback",
          description: "Update a tavrn node safely with pinned image tags and backups, and roll back when something goes wrong.",
        },
        "security-hardening-checklist": {
          slug: "security-hardening",
          label: "Security hardening",
          description: "A checklist to harden a tavrn node: proxy, keys, registration, federation, metrics and updates.",
        },
      },
    },
  },

  // Developers.
  {
    repo: "tavrn",
    path: "docs/architecture.md",
    slug: "docs/developers/architecture",
    label: "Architecture",
    order: 10,
    description: "tavrn in one page: nodes and identities, discovery, end-to-end encryption, voice, bots, federation trust, scaling.",
  },
  ...protocol([
    [
      "README.md",
      "overview",
      "Overview",
      {
        title: "Protocol overview",
        description: "The tavrn protocol is the contract between nodes, clients and bots: its documents, versioning and capabilities.",
      },
    ],
    [
      "PROTOCOL.md",
      "core",
      "Core protocol",
      { description: "The core of the tavrn protocol: identities, discovery, capabilities, the API, authentication, events and messages." },
    ],
    [
      "FEDERATION.md",
      "federation",
      "Federation",
      { description: "How tavrn nodes find, authenticate and trust each other: node keys, federation tokens, inboxes and the directory." },
    ],
    [
      "ENCRYPTION.md",
      "encryption",
      "Encryption",
      { description: "How tavrn encrypts conversations end to end: MLS groups, device keys, the history backup and what the node can and cannot see." },
    ],
    [
      "VOICE.md",
      "voice",
      "Voice and video",
      { description: "Voice, video and screen sharing in tavrn: limits, the join flow, encrypted media frames, the soundboard and connectivity." },
    ],
    [
      "WHITEBOARD.md",
      "whiteboard",
      "Whiteboard",
      { description: "The shared, end-to-end encrypted whiteboard of tavrn, built on encrypted ephemeral events." },
    ],
    [
      "FILES.md",
      "files",
      "Files channels",
      { description: "Files channels in tavrn: a shared folder tree per channel, external stores and end-to-end encrypted files." },
    ],
    [
      "APPLICATIONS.md",
      "applications",
      "Applications and bots",
      { description: "Applications and bots, slash commands, webhooks, event subscriptions and single sign-on in the tavrn protocol." },
    ],
    [
      "SEARCH.md",
      "search",
      "Search",
      { description: "Message search in tavrn: the node's index for plaintext channels and the local encrypted index for everything else." },
    ],
    [
      "MODERATION.md",
      "moderation",
      "Moderation",
      { description: "Reports with evidence, auto-moderation of unencrypted conversations, the welcome channel and room ownership transfer." },
    ],
    [
      "LEGAL.md",
      "legal",
      "Legal",
      { description: "Takedown notices, legal pages, terms acceptance and the users' data rights that a tavrn node can offer." },
    ],
    [
      "ENTITLEMENTS.md",
      "entitlements",
      "Entitlements",
      { description: "Per-user and per-room limits of a tavrn node, admin API tokens and attachment retention." },
    ],
    [
      "permissions.md",
      "permissions",
      "Permissions",
      {
        license: "CC-BY-4.0; the permission tables and their values: Apache-2.0",
        description: "The permission bits of tavrn (normative positions) and how roles, categories and channel overrides combine.",
      },
    ],
    ["CHANGELOG.md", "changelog", "Changelog", { description: "Changes of the tavrn protocol that implementations must follow, newest first." }],
  ]),
  {
    repo: "tavrn-js",
    path: "sdk/README.md",
    slug: "docs/developers/sdk/sdk",
    label: "@tavrn/sdk",
    order: 10,
  },
  {
    repo: "tavrn-js",
    path: "e2ee/README.md",
    slug: "docs/developers/sdk/e2ee",
    label: "@tavrn/e2ee",
    description: "@tavrn/e2ee, the client side of the end-to-end encryption, shared by the web client and the bot runtime.",
    order: 20,
    license: "MPL-2.0",
  },
  {
    repo: "tavrn-js",
    path: "bot/README.md",
    slug: "docs/developers/sdk/bot",
    label: "@tavrn/bot",
    description: "@tavrn/bot, the bot runtime for Node.js: identity, end-to-end encryption, messages, commands and installations.",
    order: 30,
  },
  {
    repo: "tavrn-web",
    path: "docs/CLIENT.md",
    slug: "docs/developers/web/client",
    label: "Web client",
    order: 10,
  },
  {
    repo: "tavrn-web",
    path: "docs/DESKTOP.md",
    slug: "docs/developers/web/desktop",
    label: "Desktop apps",
    description: "The desktop apps for Linux (Electron) and Windows (Tauri): shells around the web client, with the node picker, keychain, hotkeys and updates.",
    order: 20,
  },
  {
    repo: "tavrn-web",
    path: "docs/ACCESSIBILITY.md",
    slug: "docs/developers/web/accessibility",
    label: "Accessibility",
    description: "The accessibility of the web client: the WCAG 2.2 AA audit, automated checks, known gaps and a statement template.",
    order: 30,
  },
  {
    repo: "tavrn",
    path: "docs/roadmap.md",
    slug: "docs/developers/roadmap",
    label: "Roadmap",
    order: 90,
    description: "What has been built so far and what comes next, phase by phase.",
  },
];

/** Further copies outside the wiki: the roadmap page (src/pages/roadmap.astro) renders this one. */
export const PAGES = [
  {
    repo: "tavrn",
    path: "docs/roadmap.md",
    file: "src/content/pages/roadmap.md",
    route: "/roadmap/",
    description: "What has been built so far and what comes next, phase by phase.",
  },
];

/**
 * Files that only point into the handbook now (tavrn-node moved its operator guides there): links to them go to
 * the page that took their content.
 */
export const ALIASES = /** @type {Record<string, string>} */ ({
  "tavrn-node:docs/OPERATING.md": "docs/admins/overview",
  "tavrn-node:docs/SCALING.md": "docs/admins/scaling",
  "tavrn-node:docs/WEBHOOKS.md": "docs/admins/webhooks-and-applications",
  "tavrn-node:deploy/REVERSE-PROXY.md": "docs/admins/reverse-proxy",
});

/** The configuration reference generated from the node's .env.example (scripts/gen-env-reference.mjs). */
export const ENV_REFERENCE = {
  repo: "tavrn-node",
  path: "deploy/.env.example",
  /** Its tables describe the variables the example file leaves without a comment. */
  handbook: "docs/HANDBOOK.md",
  slug: "docs/admins/configuration-reference",
  label: "Configuration reference",
  // Right after the handbook's "Configuration" page.
  after: "docs/admins/configuration",
  /** Values that must not be published as they are (the private test node, a private address). */
  overrides: {
    TAVRN_REFERENCE_NODES: { display: "the project owner's public test node (see the description)" },
    TAVRN_SMTP_URL: { value: "smtp://192.0.2.10:8025" },
  },
  /** Sections, each starting at the comment block above its first variable. */
  sections: [
    { first: "TAVRN_DOMAIN", title: "Required" },
    { first: "IMAGE_TAG", title: "Container and database" },
    { first: "TAVRN_NAME", title: "Node" },
    { first: "TAVRN_WEBAUTHN_ORIGIN", title: "Second factor and passkeys", intro: true },
    { first: "TAVRN_SMTP_URL", title: "E-mail" },
    { first: "TAVRN_CAPTCHA_PROVIDER", title: "Captcha", intro: true },
    { first: "TAVRN_OIDC_ISSUER", title: "Single sign-on (OpenID Connect)", intro: true },
    { first: "TAVRN_SESSION_ACCESS_MINUTES", title: "Sessions and devices" },
    { first: "TAVRN_ROOM_CREATION", title: "Rooms and uploads" },
    { first: "TAVRN_UPLOAD_MAX_BYTES_CEILING", title: "Entitlement defaults", intro: true },
    { first: "TAVRN_MEDIA_FFMPEG", title: "Media pipeline", intro: true },
    { first: "TAVRN_GIF_PROVIDER", title: "GIF search", intro: true },
    { first: "TAVRN_UNFURL", title: "Link previews", intro: true },
    { first: "TAVRN_AUTOMOD_BURST_LIMIT", title: "Auto-moderation" },
    { first: "TAVRN_REPORTS_RATE_PER_HOUR", title: "Reports" },
    { first: "TAVRN_APP_CREATION", title: "Applications and bots", intro: true },
    { first: "TAVRN_WEBHOOKS_ENABLED", title: "Incoming webhooks", intro: true },
    { first: "TAVRN_SEARCH_ENABLED", title: "Search", intro: true },
    { first: "TAVRN_LEGAL_NOTICES", title: "Legal", intro: true },
    { first: "TAVRN_VOICE_ENABLED", title: "Voice, video and screen sharing", intro: true },
    { first: "TAVRN_FEDERATION_ENABLED", title: "Federation" },
    { first: "TAVRN_LISTEN", title: "Operations", intro: true },
    { first: "TAVRN_PUSH", title: "Web push", intro: true },
    { first: "TAVRN_METRICS", title: "Metrics", intro: true },
    { first: "VALKEY_PASSWORD", title: "Several instances", intro: true },
  ],
};

/**
 * The protocol documents, in reading order.
 * @param {[string, string, string, Partial<import("./lib/docs-transform.mjs").DocConfig>?][]} list
 */
function protocol(list) {
  return list.map(([path, slug, label, extra], i) => ({
    repo: "tavrn-protocol",
    path,
    slug: `docs/developers/protocol/${slug}`,
    label,
    order: (i + 1) * 10,
    ...extra,
  }));
}
