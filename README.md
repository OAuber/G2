<div align="center">

<h1>
  🧬 <strong>Ğ<sup><span style="color:#9CA3AF;">2</span></sup></strong> — Free Peer-to-Peer Genealogy
</h1>

### Create, edit, and visualize genealogical trees in 2D and 3D

*Distributed genealogy, owned by genealogists.*

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-000000?logo=three.js&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![PWA](https://img.shields.io/badge/PWA-5A0FC8?logo=pwa&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](#licence)

</div>

---

## Vision

**Ğ2** (pronounced Gdeux, Getou, or Djeetoo) is a genealogy app designed for serious research and collaborative investigation. It enables genealogists to:

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

Long-term hypothesis: if the Ğ2 Web of Trust becomes robust and viral enough, it could eventually support the creation of a Ğ2 free currency. This is a strategic trajectory, not a current feature.

---

## Project Status

- The GitHub repository is **private for now**.
- It will be **opened at launch**.
- The project is in active development and strategic framing.

---

## Project Origins

The G2 concept continues the **Arbre** project initiated by Olivier Auber in the 2000s.

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
| **Vite Plugin PWA** | Installability and offline mode |

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
