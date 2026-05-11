# G2 Core Contracts (v0)

## Objectif
Définir les contrats publics stables exposés par G2 pour permettre à Ğ2 de se brancher proprement, sans dépendance inverse.

## Principe d’architecture
- Flux autorisé : `G2 -> Ğ2`
- Flux interdit : `Ğ2 -> G2`

## Enveloppe d’événement canonique

Tous les événements inter-projets utilisent cette enveloppe logique :

- `eventId` (string, UUID)
- `eventType` (string, ex: `identity.claimed.v1`)
- `schemaVersion` (string, ex: `1.0`)
- `producer` (`g2-core` | `g2-currency`)
- `producedAt` (ISO8601 UTC)
- `nonce` (string)
- `payloadHash` (sha256 du payload canonique)
- `signature` (signature du producteur)
- `payload` (objet métier versionné)

## Événements exposés par G2 (v0)

- `identity.claimed.v1`
- `identity.wallet_bound.v1`
- `identity.certified.v1`
- `identity.membership_candidate.v1`
- `network.peer_connected.v1`
- `network.snapshot_received.v1`
- `sync.merge_conflict_detected.v1`

## Objets versionnés (v0)

- `IdentityClaimRecord`
- `WalletBindingProof`
- `CertificationRecord`
- `MembershipDecision`
- `MonetaryTransaction`
- `EpochSnapshot`

## Contrat des objets (résumé)

### IdentityClaimRecord
Déclare la revendication d’une identité (personne vivante) avec clé publique, contexte et signature.

### WalletBindingProof
Lie une identité revendiquée à un wallet, avec preuve cryptographique de contrôle.

### CertificationRecord
Certifie une identité par une autre (`personhood` ou `relationship`), avec validité temporelle et signature.

### MembershipDecision
Décision de statut (`candidate`, `member`, `suspended`, `revoked`) avec justification et signatures de quorum.

### MonetaryTransaction
Transaction signée avec nonce monotone, montant, émetteur, destinataire.

### EpochSnapshot
Snapshot finalisé d’epoch (N, M, DU, transactions appliquées, signatures validateurs).

## Règles de compatibilité

- Ajout de champs : autorisé en mineure si backward-compatible.
- Suppression/renommage de champs obligatoires : interdit en mineure.
- Changement non compatible : nouvelle version majeure.
- Toute version doit être rejouable de manière déterministe.

## Règles de sécurité minimales

- Tous les objets réseau critiques sont signés.
- Protection anti-rejeu obligatoire (nonce + fenêtre temporelle).
- Rejet de tout payload non vérifiable.
- Vérification de hash avant toute application métier.

## Gouvernance des contrats

- Toute évolution des contrats part d’abord par PR dans G2.
- Ğ2 consomme des versions taggées de G2.
- Aucune évolution Ğ2 ne doit imposer une dépendance vers G2.

## Politique de version

- Baseline actuelle : `v0`
- Schéma initial recommandé : `1.0`
- Les changements de contrat doivent être documentés dans un changelog dédié.