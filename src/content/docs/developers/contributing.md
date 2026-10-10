---
title: Contributing
description: How to contribute to tavrn, where each part lives, the contributor license agreement, the licenses and the trademark policy.
sidebar:
  order: 80
---

tavrn is open source, and bug reports, fixes, translations, documentation, protocol reviews and accessibility
testing are all welcome. The rules that apply to every repository of the project are kept in the organization's
[`.github` repository](https://github.com/just-tavrn/.github):

- the [contributing guide](https://github.com/just-tavrn/.github/blob/main/CONTRIBUTING.md): where things live,
  how to propose a change and what a good pull request looks like;
- the [code of conduct](https://github.com/just-tavrn/.github/blob/main/CODE_OF_CONDUCT.md);
- the [security policy](https://github.com/just-tavrn/.github/blob/main/SECURITY.md): security problems are
  reported privately, never in a public issue;
- [support](https://github.com/just-tavrn/.github/blob/main/SUPPORT.md): questions go to the
  [Discussions](https://github.com/just-tavrn/tavrn/discussions), not to issues.

## Where to start

Issues and pull requests belong in the repository that owns the code. Changes to what goes over the wire (the
API, the message format, federation or the encryption) start in the protocol repository; the implementations
follow. For anything larger than a small fix, open an issue first so the approach can be agreed before you spend
time on it. If you are not sure where something belongs, open a discussion.

## The contributor license agreement

Contributions are accepted under a short
[contributor license agreement](https://github.com/just-tavrn/.github/blob/main/CLA.md). You sign it once, with a
single comment on your first pull request, when the CLA bot asks for it. You keep the copyright of your work. The
agreement lets the project offer additional licenses next to the open-source ones, and it comes with a written
promise: everything published under an open-source license stays available under it.

## Licenses

Each repository has the license that fits its role:

| Repository | What it holds | License |
|---|---|---|
| [tavrn](https://github.com/just-tavrn/tavrn) | Overview, documentation, roadmap | CC-BY-4.0 |
| [tavrn-protocol](https://github.com/just-tavrn/tavrn-protocol) | The specification, `openapi.json`, test vectors | Apache-2.0 for the machine-readable parts, CC-BY-4.0 for the prose |
| [tavrn-crypto](https://github.com/just-tavrn/tavrn-crypto) | The encryption core and `@tavrn/crypto` | MPL-2.0 |
| [tavrn-js](https://github.com/just-tavrn/tavrn-js) | `@tavrn/sdk`, `@tavrn/e2ee`, `@tavrn/bot` | Apache-2.0; `@tavrn/e2ee` is MPL-2.0 |
| [tavrn-node](https://github.com/just-tavrn/tavrn-node) | The node server and its deployment | AGPL-3.0-only |
| [tavrn-web](https://github.com/just-tavrn/tavrn-web) | The web client and the desktop app | Apache-2.0 |
| [tavrn-website](https://github.com/just-tavrn/tavrn-website) | This website | Apache-2.0 for the code, CC-BY-4.0 for the texts |
| [.github](https://github.com/just-tavrn/.github) | Organization-wide documents and workflows | CC-BY-4.0 for the texts, Apache-2.0 for the code |

The node is AGPL-3.0-only so that improvements of a hosted node stay open. The clients, the SDK and the bot runtime
are Apache-2.0, so anyone can build clients, bots and integrations. The encryption code is MPL-2.0: you can embed
it anywhere, but changes to the encryption itself are published.

The pages of this wiki that are copied from other repositories keep the license of their source; each of them
says which at the bottom.

## The name and the logo

The name "tavrn" and the logo are not covered by these licenses. You may run tavrn under its name for yourself,
your community or your company, also with your own configuration and local patches. Distributing a modified
version under the name, or running a hosting business under it, needs permission. The details and examples are in
the [trademark policy](https://github.com/just-tavrn/.github/blob/main/TRADEMARK.md).
