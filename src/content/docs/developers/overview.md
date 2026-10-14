---
title: Developer overview
description: The parts of tavrn, where their code lives and where to start when you build a client, a bot or an integration.
sidebar:
  order: 1
---

tavrn is split into repositories with clear roles. The protocol is the contract every implementation follows;
the node, the clients and the libraries implement it. These pages collect the documents that are versioned with
the code, copied here every time the website is built.

## Where to start

- **To understand the system**, read the [architecture](/docs/developers/architecture/) in one page: nodes and
  identities, discovery, end-to-end encryption, voice, bots and the federation trust model.
- **To build a client or an integration**, start with the [protocol overview](/docs/developers/protocol/overview/)
  and the [core protocol](/docs/developers/protocol/core/), then use the TypeScript client
  [`@tavrn/sdk`](/docs/developers/sdk/sdk/).
- **To write a bot**, read [applications and bots](/docs/developers/protocol/applications/) and the bot runtime
  [`@tavrn/bot`](/docs/developers/sdk/bot/). Bots are visible members of encrypted channels and read only what
  they are allowed to see.
- **To work on the web client or the apps**, see the [web client](/docs/developers/web/client/),
  [desktop app](/docs/developers/web/desktop/) and [Android app](/docs/developers/web/android/) pages.
- **To run a node**, the [node admin pages](/docs/admins/overview/) are the place to go.

## The repositories

| Repository | What it is |
|---|---|
| [tavrn-protocol](https://github.com/just-tavrn/tavrn-protocol) | The specification, `openapi.json`, test vectors and permission tables |
| [tavrn-crypto](https://github.com/just-tavrn/tavrn-crypto) | The encryption core in Rust on OpenMLS, also as WebAssembly (`@tavrn/crypto`) |
| [tavrn-js](https://github.com/just-tavrn/tavrn-js) | The SDK `@tavrn/sdk`, the encryption layer `@tavrn/e2ee` and the bot runtime `@tavrn/bot` |
| [tavrn-node](https://github.com/just-tavrn/tavrn-node) | The node server with the embedded web client and the voice server |
| [tavrn-web](https://github.com/just-tavrn/tavrn-web) | The web client and the desktop app |
| [tavrn](https://github.com/just-tavrn/tavrn) | The overview, the architecture, the roadmap and the Discussions |

Contributions are welcome; the [contributing page](/docs/developers/contributing/) explains how, and which
license each repository has.
