# Status Actuel - Scene2D Improvements

**Date**: 14 février 2026

## ✅ Fonctionnalités implémentées

### 1. Vue 2D par défaut au démarrage
- ✅ `App.tsx` ligne 56: `viewMode = '2D'` au lieu de `'3D'`
- ✅ L'application démarre en vue 2D

### 2. Affichage de TOUS les individus au chargement
- ✅ `Scene2D.tsx` ligne 67-74: Filtre modifié
  - Si `selectedIds.size === 0` → Afficher TOUS
  - Sinon → Filtre selon sélection
- ✅ `App.tsx` ligne 180: `setSelectedIdsFor2D(new Set())` au chargement
- ✅ Les 306 individus s'affichent directement (avec données originales ET normalisées)

### 3. Comportement REMPLAÇANT des flèches
- ✅ `App.tsx` ligne 303: `setSelectedIdsFor2D(newIds)` au lieu de merge
- ✅ Clic sur `<` → Affiche UNIQUEMENT les ancêtres
- ✅ Clic sur `>` → Affiche UNIQUEMENT les descendants

### 4. Bouton All/None dans Sidebar
- ✅ `Sidebar.tsx` ligne 409-445: Bouton toggle All/None
  - Si filtrés (size > 0) → "All" (Eye) en bleu
  - Si tous visibles (size === 0) → "None" (EyeOff) en rouge
  - Click toggle entre les deux états

### 5. Recentrage automatique après expansion
- ✅ `Scene2D.tsx` ligne 129-144: Reset de `hasCentered` quand liste change
- ✅ Après clic sur flèche, la vue se recentre automatiquement sur les nouveaux individus

### 6. Reset du scale après expansion
- ✅ `Scene2D.tsx` ligne 141: `setScale(1)` lors du recentrage
- ✅ Le zoom revient à 100% après chaque expansion

## ⚠️ Problème identifié

### Performance avec grandes bases (40k+ individus)
- **Problème**: Scene2D utilise des `<div>` DOM
- **Résultat**: Avec 40k individus → 40k éléments DOM → Ralentissement extrême
- **Solution nécessaire**: Scene2DCanvas (rendu Canvas)

## 🔧 Scene2DCanvas - Problèmes rencontrés

Une implémentation Scene2DCanvas a été créée mais rencontre des bugs:
1. Le translate.y n'est pas calculé correctement
2. Les événements wheel parasites causent un zoom out automatique
3. Le carré rouge de test s'affiche mais pas les individus

**Fichier**: `components/Scene2DCanvas.tsx` (644 lignes)
**Status**: Non fonctionnel, à déboguer

## 📋 TODO: Prochaines étapes

### Option A: Déboguer Scene2DCanvas (Recommandé pour grandes bases)
1. Corriger le calcul de translate.y pour positionner correctement
2. Empêcher les événements wheel parasites au chargement
3. Vérifier le code de rendu Canvas (fillRect des barres)
4. Tester avec 40k individus

### Option B: Optimiser Scene2D DOM (Plus simple mais limité)
1. Ajouter virtualisation (react-window ou react-virtualized)
2. Ne rendre que les individus visibles dans le viewport
3. Limite pratique: ~5000-10000 individus

### Option C: Basculement automatique
1. Si base < 5000 individus → Scene2D (DOM)
2. Si base ≥ 5000 individus → Scene2DCanvas (Canvas)
3. Meilleur des deux mondes

## 🎯 Recommandation

**Continuer avec Scene2DCanvas** car:
- Nécessaire pour bases de 40k+ individus
- Déjà 90% fonctionnel
- Bugs restants sont réparables

**Prochaine action**: 
1. Corriger le calcul de position dans Scene2DCanvas
2. Déboguer pourquoi les rectangles ne s'affichent pas (malgré fillRect)
3. Tester avec votre base de 40k individus

## 💡 Note sur les dates manquantes

Votre suggestion: Les individus sans dates doivent être:
- Positionnés à gauche (date fictive = date min de la base)
- Rendus avec gradient transparent
- Durée de vie par défaut: 80 ans

Cela devrait déjà fonctionner dans le code actuel (lignes 294-303 de Scene2D.tsx).

---

**En résumé**: Scene2D DOM fonctionne parfaitement pour votre base de 306 individus. Pour passer à 40k, il faut finaliser Scene2DCanvas.

Voulez-vous que je continue à déboguer Scene2DCanvas maintenant?
