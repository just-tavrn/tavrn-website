// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { docsId } from "./docs-id";

describe("docsId", () => {
  it("puts the wiki under docs/", () => {
    expect(docsId("index.mdx")).toBe("docs");
    expect(docsId("users/getting-started.md")).toBe("docs/users/getting-started");
    expect(docsId("admins/index.md")).toBe("docs/admins");
    expect(docsId("Developers/Bot SDK.md")).toBe("docs/developers/bot-sdk");
  });

  it("keeps a frontmatter slug as it is", () => {
    expect(docsId("users/x.md", "docs/users/elsewhere")).toBe("docs/users/elsewhere");
  });
});
