
# Audit Technique : LifeThread

## 1. Vue d'ensemble
Application web de visualisation généalogique en 3D ("Time-Space Cube").
- **Stack** : React 19, Vite, TypeScript, Tailwind CSS.
- **Moteur 3D** : Three.js via `@react-three/fiber` et `@react-three/drei`.
- **Données** : Parsing GEDCOM local & Synchronisation P2P.

## 2. Analyse de l'Architecture

### Structure des Fichiers
- **Entrée** : `index.tsx` monte `App.tsx`.
- **État Global** : Géré principalement dans `App.tsx`.
- **Parsing** : `services/gedcomParser.ts`.

### Composants Clés
#### `Scene3D.tsx`
- Gère la caméra et le rendu 3D.
- **Problème identifié** : La synchronisation entre l'état React (`cameraView`) et la position réelle de la caméra (modifiée par `OrbitControls`) nécessitait un "hack" (reset state) pour permettre le rappel d'une vue déjà active.

#### `services/p2p.ts` (Nouveau)
- Service singleton gérant la connexion WebRTC via `PeerJS`.
- Permet l'échange de l'objet `GedcomData` complet entre un Hôte et un Client.
- Événements : `SYNC_GEDCOM`.

## 3. Fonctionnalités Actuelles

| Fonctionnalité | État | Commentaire |
| :--- | :--- | :--- |
| **Import GEDCOM** | ✅ Fonctionnel | Supporte ANSI/UTF-8. |
| **Visualisation 3D** | ✅ Fonctionnel | Moteur robuste, shaders personnalisés pour les liens. |
| **P2P Sync** | ⚠️ Alpha | Service en place. Connexion par ID fonctionnelle. Transfert de données basique implémenté. |
| **Caméra** | ⚠️ Corrigé | Le bug du "double clic" pour la vue Top est résolu via un force-reset dans `App.tsx`. |

## 4. Problèmes Connus (Bug Report)

### 🔴 Conflit d'Environnement (IDE)
- **Symptôme** : Ralentissements extrêmes, warnings "Multiple instances of Three.js".
- **Cause** : Le fichier `index.html` contient un bloc `<script type="importmap">` injecté et verrouillé par l'environnement de développement (StackBlitz/IDX). Ce bloc force le chargement de React 19 et Three.js (CDN), entrant en conflit avec les versions bundle (React 18) de `package.json`.
- **Solution** : Impossible de supprimer le bloc (il revient automatiquement). La solution recommandée est de changer d'environnement de développement local (VS Code + Vite local) pour avoir le contrôle total sur `index.html`.

### 🟠 Synchronisation Caméra
- Si l'utilisateur est en vue 'TOP' et tourne la caméra manuellement, l'état reste 'TOP'. Cliquer à nouveau sur 'TOP' ne déclenchait rien.
- **Fix** : Implémenté dans `App.tsx` (reset temporaire à `null` avant de réappliquer la vue).

## 5. Feuille de Route P2P
1.  **Handshake** : Échange d'ID (Fait).
2.  **Sync Initiale** : Envoi du JSON complet (Fait).
3.  **Sync Incrémentale** : N'envoyer que les modifications (CRDT ou événements discrets) pour éviter de renvoyer tout le GEDCOM à chaque modification.
4.  **Curseur Distant** : Afficher où regarde l'autre pair (partage de vecteur caméra).

---
