// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { contactLinkHtml, RUNTIME_VARS, runtimeEnv } from "./runtime-env";

describe("runtime values of the legal pages", () => {
  it("are Caddy template actions reading one environment variable each", () => {
    for (const name of RUNTIME_VARS) expect(runtimeEnv(name)).toBe(`{{env "${name}"}}`);
  });

  it("puts the contact address into a single-quoted href, so the action's quotes stay inside the attribute", () => {
    expect(contactLinkHtml()).toBe(`<a href='mailto:{{env "TAVRN_CONTACT_EMAIL"}}'>{{env "TAVRN_CONTACT_EMAIL"}}</a>`);
    expect(contactLinkHtml('translate="no"')).toBe(
      `<a href='mailto:{{env "TAVRN_CONTACT_EMAIL"}}' translate="no">{{env "TAVRN_CONTACT_EMAIL"}}</a>`,
    );
  });
});
