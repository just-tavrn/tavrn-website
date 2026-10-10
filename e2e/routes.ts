// SPDX-License-Identifier: Apache-2.0
/** Every route of the site with the heading it must show (the first h1). */
export const routes = [
  { path: "/", heading: "Your community, your node, your keys." },
  { path: "/download", heading: "Download" },
  { path: "/status", heading: "Status" },
  { path: "/roadmap", heading: "Roadmap" },
  { path: "/issues", heading: "Known issues" },
  { path: "/report", heading: "Report a problem" },
  { path: "/legal/", heading: "Legal" },
  { path: "/legal/imprint", heading: "Imprint" },
  { path: "/legal/privacy", heading: "Privacy policy" },
  { path: "/docs/", heading: "tavrn docs" },
  { path: "/docs/users/getting-started/", heading: "Getting started" },
  { path: "/docs/admins/install/", heading: "Install with Docker Compose" },
  { path: "/docs/developers/overview/", heading: "Developer overview" },
  // A page with Mermaid diagrams: the privacy and CSP checks cover the lazily loaded renderer too.
  { path: "/docs/developers/architecture/", heading: "Architecture" },
  { path: "/this-page-does-not-exist", heading: "Page not found", status: 404 },
] as const;
