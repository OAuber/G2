<div align="center">

# G2

### Free peer-to-peer genealogy

Create, edit, and visualize genealogical trees in 2D and 3D.

*Distributed genealogy, owned by genealogists.*

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-000000?logo=three.js&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![PWA](https://img.shields.io/badge/PWA-5A0FC8?logo=pwa&logoColor=white)](#installable-app-pwa)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](#license)

</div>

---

## Vision

**G2** is a genealogy application designed for serious research and collaborative investigation. It enables genealogists to:

- create and edit individuals and family links;
- visualize trees in **2D** and **3D**;
- work with large datasets (**tested with 40K individuals**);
- attach multimedia data (photos, documents);
- exchange data **peer to peer**, with no central platform.

The goal is not to build a universal genealogy tree, but a **Web of Trust** connecting genealogists and the people represented in their databases.

---

## Positioning and Principles

- **Data sovereignty**: each genealogist controls their data and visibility settings.
- **Platformless federation**: direct exchanges through P2P (WebRTC/PeerJS).
- **Selective publication**: publish unknown-root ancestors to encourage network matching.
- **Human validation**: automatic matches are leads, not truth; investigation and validation stay in genealogists' hands.
- **Ğ1 inspiration**: the conceptual framework is inspired by the Ğ1 free-currency Web of Trust, without claiming to be a currency at this stage.

---

## Current Capabilities

### Visualization
- 3D view (R3F/Three.js) with GPU rendering for large volumes.
- 2D views (grid and individual mode) for detailed exploration.
- Navigation, selection, focus, and visual comparison tools.

### Genealogical Data
- GEDCOM import/export.
- Missing-date normalization.
- Sorting, filtering, and relationship exploration.

### Multimedia Data
- Add photos and documents per individual.
- Primary photo per person.
- Media synchronization according to visibility rules.

### Peer-to-Peer and Identity
- P2P sharing sessions.
- Change proposal workflow.
- Invites and access profiles (`viewer`/`contributor`/`editor`).
- Signed local identity and encrypted private-key backup.

---

## Conceptual Alignment with Ğ1

The project reuses key lessons analyzed in [docs/p2p/DUNITER_PRINCIPLES_ANALYSIS.md](docs/p2p/DUNITER_PRINCIPLES_ANALYSIS.md):

- importance of identity and distributed trust;
- distinction between identity, action rights, and governance;
- role of explicit rules (validity, quotas, review, anti-spam);
- robustness of a living social graph rather than a single central truth.

Long-term hypothesis: if the **G2** Web of Trust becomes robust and viral enough, it could eventually support a free currency within the **G2** ecosystem. This is a strategic trajectory, not a current feature.

---

## Project Status

- The GitHub repository is **private for now**.
- It will be **opened at launch**.
- The project is in active development and strategic framing.

---

## Project Origins

**G2** continues the **Arbre** project initiated by Olivier Auber in the 2000s.

- Arbre project history: [PetiteHistoire](http://arbre.km2.net/wakka.php?wiki=PetiteHistoire)
- The historical wiki is currently unavailable, but the conceptual lineage remains central.

The software is free/open source, and its concept is framed as a free artwork.

---

## Tech Stack

| Technology | Role |
|---|---|
| **React 18** + **TypeScript** | Interface and app logic |
| **Three.js** + **React Three Fiber** + **Drei** | 3D WebGL rendering |
| **Vite** | Build and development server |
| **Tailwind CSS** | Utility-first styling |
| **PeerJS** (WebRTC) | Peer-to-peer communication |
| **Vite Plugin PWA** + **Workbox** | Web App Manifest, service worker, installability, offline caching of built assets |

Configuration for the PWA (manifest, precache patterns, standalone display) lives in `vite.config.ts`.

---

## Architecture (code layout)

The UI entry point is [`index.tsx`](index.tsx); [`App.tsx`](App.tsx) orchestrates domain hooks, P2P wiring, and the main shell (sidebar, scene, panels). Heavy UI lives in [`components/`](components/) (see below). Shared domain logic lives in [`services/`](services/) and app-level helpers in [`app/`](app/).

### `app/` — application layer (non-UI)

| Area | Role |
|------|------|
| [`app/autoSave.ts`](app/autoSave.ts) | IndexedDB autosave snapshots and restore |
| [`app/storageKeys.ts`](app/storageKeys.ts) | `localStorage` key names |
| [`app/p2pAppTypes.ts`](app/p2pAppTypes.ts) | P2P UI/session types (invites, proposals, documents, visibility) |
| [`app/p2pSyncConstants.ts`](app/p2pSyncConstants.ts) | Chunk sizes, timeouts, normalization version for sync |
| [`app/p2pSyncSenders.ts`](app/p2pSyncSenders.ts) | Factory for P2P sync senders (GEDCOM chunks, bundles, documents) |
| [`app/p2pInviteUrl.ts`](app/p2pInviteUrl.ts) | Invite token parsing from the URL |
| [`app/normalizeDocuments.ts`](app/normalizeDocuments.ts) | Document normalization helpers for UI and P2P |
| Other | e.g. [`app/royalsDemo.ts`](app/royalsDemo.ts), [`app/onlineDocTitle.ts`](app/onlineDocTitle.ts) |

### `hooks/` — React hooks by domain

Composable state used from `App.tsx`:

| Hook | Responsibility |
|------|------------------|
| [`useGedcomCore`](hooks/useGedcomCore.ts) | Raw/normalized GEDCOM, database name, root/selection |
| [`useDocumentsState`](hooks/useDocumentsState.ts) | Per-individual documents map |
| [`useAutoSave`](hooks/useAutoSave.ts) | Autosave toggles and IndexedDB integration |
| [`useSelfIdentity`](hooks/useSelfIdentity.ts) | Local identity and related UI signals |
| [`useP2PSession`](hooks/useP2PSession.ts) | Barrel: P2P transfer modes + re-exports for [`createP2PSyncSenders`](app/p2pSyncSenders.ts) |

### `components/` — UI

Large scene/panel components (2D grid, 3D scene, details, instanced tree) intentionally stay in dedicated files; smaller pieces are split where it helps maintenance (e.g. [`AppLayout`](components/AppLayout.tsx), [`IndividualNameBillboard`](components/IndividualNameBillboard.tsx), [`topPanel/TopPanelTabList`](components/topPanel/TopPanelTabList.tsx)). Tab metadata for the share panel is in [`components/topPanel/topPanelTabs.ts`](components/topPanel/topPanelTabs.ts).

`Scene3D` is loaded with `React.lazy` + `Suspense` from `App.tsx` to split the main bundle.

### `services/` — pure or domain logic

GEDCOM parsing ([`gedcomParser.ts`](services/gedcomParser.ts)), normalization ([`normalizationService.ts`](services/normalizationService.ts)), bundles ([`bundleService.ts`](services/bundleService.ts)), layout/geometry, P2P protocol and transport ([`p2p.ts`](services/p2p.ts), [`p2pProtocol.ts`](services/p2pProtocol.ts), [`p2pDomain.ts`](services/p2pDomain.ts)), identity crypto ([`selfIdentityCrypto.ts`](services/selfIdentityCrypto.ts)), relationship paths, etc.

### Tests and quality

- **Vitest**: [`vitest.config.ts`](vitest.config.ts); tests under [`tests/`](tests/) (e.g. `relationshipPath`, `gedcomParser`, `normalizationService`, `bundleService`).
- **Lint**: `npm run lint` ([`eslint.config.js`](eslint.config.js)).
- **Format**: optional `npm run format` ([`.prettierrc.json`](.prettierrc.json), [`.prettierignore`](.prettierignore)).
- **CI**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs install, build, test, and lint on push/PR to `main`.

---

## Quick Start

**Prerequisite**: [Node.js](https://nodejs.org/) (v18+)

```bash
npm install
npm run dev
```

App available at `http://localhost:5173`.

### Production build

```bash
npm run build
npm run preview
```

---

## Installable app (PWA)

Production output is a **Progressive Web App**: you can install **G2** from a supporting browser (desktop or mobile) so it opens in its own window, like a native app. A **service worker** (generated via Vite Plugin PWA and **Workbox**) precaches the built shell (HTML, JS, CSS, icons, and other static assets), so the interface remains usable **offline** for those cached resources after the first load. Live P2P features still depend on network conditions and signaling.

---

## Contact

- Technical questions: [contact@getou.app](mailto:contact@getou.app)
- Practical questions: [contact@getou.info](mailto:contact@getou.info)
- Governance questions: [contact@getou.org](mailto:contact@getou.org)

---

## Contribution and Support

Feedback, testing, genealogical analysis, documentation work, and code contributions are welcome.

During development, people who find the app useful and the initiative meaningful can also support the author with voluntary donations.

---

## References

- About the Ğ1 free currency: [monnaie-libre.fr](https://monnaie-libre.fr/)
- Internal Duniter/Ğ1 analysis: [docs/p2p/DUNITER_PRINCIPLES_ANALYSIS.md](docs/p2p/DUNITER_PRINCIPLES_ANALYSIS.md)

---

## License

This project is distributed under the **MIT** license. See [LICENSE](LICENSE).
