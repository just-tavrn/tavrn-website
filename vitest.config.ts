// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
// Unit tests (src/**/*.test.ts) and checks of the built site (tests/*.test.ts, they need `pnpm build` first).
// getViteConfig gives the tests Astro's Vite setup, so image imports resolve as in the site.
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
