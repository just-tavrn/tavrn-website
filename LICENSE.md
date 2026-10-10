# Licenses

This repository holds the source of the tavrn website (<https://tavrn.org>). Its files are under different
licenses, depending on what they are:

| Files | License |
|---|---|
| Code: everything under `src/` that is not text content (`*.astro`, `*.ts`, `*.tsx`, `*.mjs`, `*.css`), `scripts/`, `e2e/`, `deploy/`, the workflows in `.github/` and the configuration files | [Apache-2.0](LICENSE-APACHE), see [NOTICE](NOTICE) |
| Texts: the pages' wording (`src/i18n/*.json`, the Markdown and MDX files under `src/content/`), the governance texts (`README.md`, `CLA.md`, `TRADEMARK.md`, this file) | [CC-BY-4.0](LICENSE-CC-BY-4.0) |
| Screenshots in `src/assets/screenshots/` (they show the tavrn user interface with the logo; the trademark note below applies to the logo in them) | [CC-BY-4.0](LICENSE-CC-BY-4.0) |
| The generated pictures used in the screenshots (`shots/assets/`: fictitious people, room icons, game scenes; [details](shots/assets/README.md)) | [CC-BY-4.0](LICENSE-CC-BY-4.0) |
| The logo, icons and images derived from them (`src/assets/brand/`, `public/icon-*.png`, `public/favicon*`, `public/apple-touch-icon.png`, `public/og.png`) | **not licensed**, see below |

Code samples inside the texts (for example the Compose snippets) may also be used under Apache-2.0.

The wiki's node admin and developer pages are copied at build time from other repositories of the project (the git
submodules under `sources/`, see the README). They are not part of this repository's texts and keep the license of
their source, which each page names at the bottom.

## Attribution

When you reuse the texts or screenshots, attribute them as "the tavrn project", link to this repository
(<https://github.com/just-tavrn/tavrn-website>) and say whether you changed them, as CC-BY-4.0 requires.

## The name and the logo

The name "tavrn" and the logo and icons are the project's marks. They are **not** covered by CC-BY-4.0 or
Apache-2.0, even though the image files sit in this repository. You may use them as the
[trademark policy](TRADEMARK.md) allows (for example to talk about the project); other uses need permission.
A fork of this website that is not about the tavrn project must remove them.

## Third-party components

The site bundles the Inter typeface (SIL Open Font License 1.1, through `@fontsource-variable/inter`) and Lucide
icons (ISC). Both are rendered into the built pages; their licenses travel with the packages.

## Other repositories

Each repository of the [just-tavrn](https://github.com/just-tavrn) organization carries its own license; the
[repository map](https://github.com/just-tavrn/tavrn#repositories) lists them. Contributions are accepted under
the [contributor license agreement](CLA.md).
