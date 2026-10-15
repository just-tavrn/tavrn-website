// SPDX-License-Identifier: Apache-2.0
// The configuration of scripts/check-js-licenses.mjs: the production dependencies of the website. Only a small part
// ends up in the built site (Astro's and Starlight's client code, Preact for the status island, Pagefind, the Inter
// font and Lucide's icon paths), but the whole build stays on permissive licenses.
export default {
  packages: ["."],
  allowed: [
    "BlueOak-1.0.0",
    "Python-2.0",
    // The Inter typeface (@fontsource-variable/inter), bundled into the site as woff2 files (LICENSE.md, NOTICE).
    "OFL-1.1",
  ],
  // Packages whose metadata carries no SPDX license, verified against their license file.
  verified: {
    // Mermaid's colour library: MIT, as its license file says.
    khroma: "MIT",
  },
  // Single packages allowed with a license outside the list, with the reason. Nothing of them reaches the site.
  exceptions: {
    // Browser usage data (attribution licence) read by browserslist inside Babel, which @astrojs/preact's Vite preset
    // runs at build time only.
    "caniuse-lite": "CC-BY-4.0",
    // Mermaid's ELK layout engine: astro.config.mjs replaces the chunk that imports it by a stub (the docs draw with
    // dagre), so it is installed but never bundled.
    elkjs: "EPL-2.0",
  },
};
