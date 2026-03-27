# Audit Technique & Feuille de Route : LifeThread P2P

Ce document rassemble les recommandations prioritaires pour transformer le prototype actuel en une application de généalogie 3D P2P robuste et performante.

## 1. Architecture P2P & Synchronisation (Priorité Critique)

Le modèle actuel envoie l'intégralité du JSON (`SYNC_GEDCOM`) à chaque connexion, ce qui est non viable pour des fichiers volumineux.

*   **Adoption des CRDTs (Conflict-free Replicated Data Types)** :
    *   Remplacer l'échange brut de JSON par une librairie comme **Yjs** ou **Automerge**.
    *   **Avantage** : Synchronisation des "deltas" (uniquement les changements) et résolution automatique des conflits d'édition.
    *   **Stack** : `yjs` + `y-webrtc` pour conserver l'approche PeerJS sans serveur central.
*   **Présence & Curseurs** :
    *   Ajouter la visualisation de la présence des pairs (avatars ou vecteurs de caméra) pour faciliter la collaboration en temps réel dans l'espace 3D.

## 2. Performance & Moteur 3D (Le défi "Time-Space Cube")

Le rendu par composants individuels (`IndividualBox`) sature le CPU/GPU au-delà de 500 individus.

*   **Tout passer en InstancedMesh** :
    *   Abandonner progressivement le rendu individuel pour utiliser exclusivement `InstancedGenealogyTree`.
    *   Cela permet de rendre 10,000+ individus en un seul "draw call".
*   **Optimisation du Texte (SDF)** :
    *   Remplacer les composants `<Html>` (qui créent des nœuds DOM lourds) par du texte WebGL via `@react-three/drei/Text` (basé sur des Signed Distance Fields).
    *   Implémenter un **LOD (Level of Detail)** : Ne rendre le texte que si la caméra est proche de l'individu.
*   **Gestion des Implexes** :
    *   Pour les mariages entre cousins (boucles dans le graphe), dupliquer visuellement les nœuds ("Fantômes") et les relier par des lignes pointillées pour éviter de briser la structure de l'arbre visuel.

## 3. UX / UI & Navigation

La navigation 3D libre est souvent désorientante pour les utilisateurs non-initiés.

*   **Navigation "Point & Click"** :
    *   La caméra doit voler automatiquement vers un individu sélectionné (interpolation fluide) plutôt que de forcer l'utilisateur à naviguer manuellement.
*   **Mode Focus** :
    *   Possibilité d'isoler une branche spécifique (cacher le reste de l'arbre) pour améliorer la lisibilité.
*   **Search In-Scene** :
    *   La recherche dans la barre latérale doit piloter la caméra 3D.

## 4. Persistance (Offline First)

*   **IndexedDB** :
    *   Ne pas demander le ré-upload du GEDCOM à chaque visite.
    *   Utiliser `Dexie.js` ou `idb` pour stocker l'arbre localement dans le navigateur.

## 5. Qualité du Code & Build (Problème `index.html`)

### Le Conflit des Versions (Importmap vs Bundler)
Actuellement, `index.html` contient un bloc `<script type="importmap">` qui force le chargement de React/Three via un CDN (esm.sh).

**Risques :**
1.  **Dual React** : Si `package.json` installe React, et que `index.html` le charge aussi via CDN, l'application plantera (Hooks invalidés).
2.  **Versioning** : Vous ne contrôlez pas la version exacte utilisée en production.

**Actions requises :**
*   **Si modification possible** : Supprimer le bloc `importmap` de `index.html` et laisser Vite gérer les dépendances via `node_modules`.
*   **Si environnement verrouillé (IDX/StackBlitz)** : Configurer `vite.config.ts` pour marquer `react`, `react-dom`, et `three` comme `external` afin que le build n'inclue pas sa propre copie, évitant ainsi le doublon.

### Autres refactorings
*   **Web Workers** : Déplacer le parsing GEDCOM (`parseGedcom`) et le calcul de layout (`GenealogyLayoutEngine`) dans un Web Worker pour ne pas geler l'interface (Main Thread) lors du chargement.
*   **Unification** : Supprimer `Scene3D` mode "manuel" pour ne garder que le mode "Auto-Layout/Instanced".
