# Third-Party Notices

This project bundles third-party font assets under `dive/src/assets/fonts/`. Their licenses are reproduced
in full alongside the font files; this document is a summary index.

## Pretendard Variable

- **Copyright**: Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard), with
  Reserved Font Name 'Pretendard'. Includes bundled components copyright Adobe (Source), The Inter Project
  Authors (Inter), and The M+ FONTS Project Authors (M PLUS 1).
- **License**: SIL Open Font License, Version 1.1 (OFL-1.1)
- **Source**: <https://github.com/orioncactus/pretendard>
- **License file**: [`dive/src/assets/fonts/LICENSE-Pretendard.txt`](dive/src/assets/fonts/LICENSE-Pretendard.txt)

## JetBrains Mono

- **Copyright**: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
- **License**: SIL Open Font License, Version 1.1 (OFL-1.1)
- **Source**: <https://github.com/JetBrains/JetBrainsMono>
- **License file**: [`dive/src/assets/fonts/LICENSE-JetBrainsMono.txt`](dive/src/assets/fonts/LICENSE-JetBrainsMono.txt)

## IBM Plex Sans KR

- **Copyright**: Copyright 2018 IBM Corp. All rights reserved.
- **License**: SIL Open Font License, Version 1.1 (OFL-1.1)
- **Source**: <https://github.com/IBM/plex>, distributed via the `@fontsource/ibm-plex-sans-kr` npm package; the `.woff2` files are bundled into the build from that package (imported in `dive/src/main.tsx`).
- **License file**: [`dive/src/assets/fonts/LICENSE-IBMPlexSansKR.txt`](dive/src/assets/fonts/LICENSE-IBMPlexSansKR.txt) (vendored from the npm package so the OFL text is tracked in-tree alongside Pretendard/JetBrains Mono).

## Node.js runtime (bundled in the Pi sidecar)

- **Copyright**: Copyright Node.js contributors, plus the bundled third-party components under their own licenses (reproduced in the aggregate `LICENSE` file of every official Node.js release).
- **License**: MIT, plus the bundled-component licenses in Node's own aggregate `LICENSE`
- **Source**: <https://nodejs.org/dist/> — `dive/pi-sidecar/build-sidecar.mjs` downloads and SHASUMS256.txt-verifies the official Node.js binary matching the build toolchain's `process.versions.node`, then embeds it as the Single-Executable-Application base for the redistributed `dive-pi-sidecar` binary (`tauri.conf.json` `externalBin`).
- **License file**: not vendored in this repository — it is fetched at build time rather than checked in; see <https://github.com/nodejs/node/blob/main/LICENSE> for the current aggregate text. No local copy currently travels with the built installer.

## @earendil-works/pi-ai and @earendil-works/pi-coding-agent

- **Copyright**: Copyright Mario Zechner / earendil-works (<https://github.com/earendil-works/pi>)
- **License**: MIT (per each package's `package.json` `license` field)
- **Source**: private npm packages consumed by the Pi sidecar; versions pinned in `dive/pi-sidecar/package.json`
- **License file**: neither package ships a `LICENSE` file in its npm distribution, and `dive/pi-sidecar/build-sidecar.mjs` bundles the sidecar with esbuild `legalComments: "none"`, which strips any in-source MIT header comments from the built binary. No MIT notice for these two packages currently travels with the redistributed sidecar.
