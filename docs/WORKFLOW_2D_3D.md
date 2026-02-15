# Workflow 2D ↔ 3D - Transitions Fluides

**Date**: 14 février 2026  
**Implémentation**: `App.tsx` lignes 129-176

## 🔄 Système de Synchronisation

### État Partagé
Les deux vues (2D et 3D) partagent les mêmes états:
- `selectedIndividual` - Individu actuellement sélectionné
- `selectedIdsFor2D` - Set des individus visibles/sélectionnés
- `rootIndividual` - Individu racine (utilisé principalement en 3D)

### Synchronisation Automatique

#### 3D → 2D
**Fonction**: `handleVisibleIdsChange` (ligne 344)

Quand la vue 3D change (expansion, drag, etc.), elle appelle ce callback avec les IDs visibles. Cela met à jour `selectedIdsFor2D`, donc:
- Retour en 2D → Affiche exactement ce qui était visible en 3D
- Synchronisation en temps réel

#### 2D → 3D  
**Fonction**: `handleSetViewMode` (ligne 145-176)

Quand on passe de 2D à 3D:
1. Active automatiquement la vue **TOP** (vue du dessus, plus simple)
2. Désactive les **boîtes** (showBoxes = false) pour vue épurée
3. Conserve `selectedIdsFor2D` → La 3D affiche les mêmes individus

## 📋 Workflow Utilisateur

### Scénario 1: Exploration depuis 2D

**Étape 1**: Démarrage
- Application s'ouvre en **vue 2D**
- Tous les individus de la base sont affichés

**Étape 2**: Sélection et expansion en 2D
- Clic sur un individu → Sélection
- Clic sur flèche `<` → Affiche UNIQUEMENT les ancêtres
- OU clic sur flèche `>` → Affiche UNIQUEMENT les descendants

**Étape 3**: Passage en 3D
- Clic sur bouton **"3D View"** (BottomPanel)
- ✅ Vue 3D **TOP** activée automatiquement
- ✅ **Boîtes désactivées** automatiquement
- ✅ Affiche les **mêmes individus** qu'en 2D

**Étape 4**: Retour en 2D
- Clic sur bouton **"2D Plan"**
- ✅ Retour à la vue 2D
- ✅ Affiche les **mêmes individus** qu'en 3D

### Scénario 2: Modification en 3D puis retour 2D

**Étape 1**: En vue 3D
- Sélection d'un autre individu
- Drag pour ajouter ancêtres/descendants (via dragMode)
- Les individus visibles changent

**Étape 2**: Retour automatique en 2D
- Grâce à `handleVisibleIdsChange`, `selectedIdsFor2D` est mis à jour en continu
- Clic sur **"2D Plan"**
- ✅ La vue 2D affiche exactement ce qui était visible en 3D

### Scénario 3: Réinitialisation complète

**En 2D**:
- Bouton **"All"** (Sidebar) → Affiche tous les individus

**En 3D**:
- Changer `rootIndividual` → Reconstruit l'arbre
- OU utiliser Auto Layout "All" → Affiche toute la base

**Retour à l'autre vue**: Synchronisation automatique

## 🎯 Transitions Automatiques

### 2D → 3D
```typescript
handleSetViewMode('3D') {
  if (wasIn2D) {
    setCameraView('TOP');      // Vue du dessus
    setShowBoxes(false);       // Pas de boîtes
    // selectedIdsFor2D preserved → 3D shows same individuals
  }
}
```

### 3D → 2D
```typescript
handleVisibleIdsChange(visibleIds) {
  setSelectedIdsFor2D(visibleIds); // Continuous sync
}
```

Quand on retourne en 2D, `selectedIdsFor2D` contient déjà les bons IDs.

## 🔍 Cas d'Usage Détaillés

### Cas 1: Arbre complet d'un individu

1. **2D**: Sélectionner "Jean DUPONT"
2. **2D**: Clic flèche `<` → Ancêtres seulement
3. **2D**: Clic flèche `>` (sur Jean) → Descendants seulement  
   *OU* Clic sur "All" puis re-sélection + les deux flèches
4. **Passer en 3D** → Vue TOP montre l'arbre complet de Jean
5. **Retour 2D** → Même sélection (arbre de Jean)

### Cas 2: Exploration progressive

1. **2D**: Vue complète (tous)
2. **Passer en 3D** → Vue TOP de toute la base
3. **3D**: Drag pour étendre l'arbre (ajout ancêtres)
4. **Retour 2D** → Affiche uniquement ce qui était visible en 3D

### Cas 3: Changement de focus en 3D

1. **2D**: Arbre de "Marie MARTIN" affiché
2. **Passer en 3D** → Vue TOP de Marie
3. **3D**: Clic sur "Pierre DURAND" (autre branche)
4. **3D**: Drag pour étendre Pierre
5. **Retour 2D** → Affiche l'arbre de Pierre (pas Marie!)

## 🎨 Expérience Utilisateur

### Points forts ✅
1. **Aucune perte d'information** entre les vues
2. **Vue TOP automatique** en 3D (plus simple qu'ISO)
3. **Boîtes désactivées** automatiquement (vue plus claire)
4. **Sélection préservée** dans les deux sens

### Comportement attendu
- Switch 2D ↔ 3D: **Instantané** (< 100ms)
- Synchronisation: **Temps réel**
- Aucun "saut" visuel de sélection

## 🐛 Cas Particuliers

### Si aucun individu sélectionné
- **2D → 3D**: Affiche toute la base en vue TOP
- **3D → 2D**: Affiche toute la base

### Si base très large (> 5k)
- **2D < 5k**: Scene2D (DOM)
- **2D ≥ 5k**: Scene2DTimeline (WebGL)
- **3D**: Toujours Scene3D (optimisé)
- Transitions fluides quelle que soit la taille

### Si données normalisées
- Switch Original ↔ Normalized: Préserve sélection
- Fonctionne avec les transitions 2D ↔ 3D

## 📝 Code Clé

### Ligne 145-176: `handleSetViewMode`
Gère les transitions intelligentes:
- 2D → 3D: Active TOP + cache boîtes
- 3D → 2D: Rien de spécial (sync déjà faite)

### Ligne 344-352: `handleVisibleIdsChange`
Callback de Scene3D qui synchronise en continu:
- Quand 3D change → Met à jour selectedIdsFor2D
- Utilisé par: drag, expansion, auto-layout

### Ligne 593-637: Rendu conditionnel
```typescript
viewMode === '3D' ? (
  <Scene3D selectedIds via selectedIdsFor2D />
) : size > 5000 ? (
  <Scene2DTimeline selectedIds={selectedIdsFor2D} />
) : (
  <Scene2D selectedIds={selectedIdsFor2D} />
)
```

## 🧪 Tests Manuels

### Test 1: Transition basique
1. Vue 2D → Sélectionner individu → Flèche `<`
2. Clic "3D View"
3. Vérifier: Vue TOP, pas de boîtes, mêmes individus
4. Clic "2D Plan"
5. Vérifier: Mêmes individus qu'avant

### Test 2: Modification en 3D
1. Vue 2D → Expansion individu A
2. Passer en 3D
3. Sélectionner individu B + drag pour étendre
4. Retour 2D
5. Vérifier: Affiche l'arbre de B (pas A)

### Test 3: Réinitialisation
1. Vue 2D → Plusieurs expansions
2. Passer en 3D → Modifier
3. Retour 2D → Clic "All"
4. Vérifier: Tous les individus réapparaissent

### Test 4: Grandes bases
1. Charger base 34k
2. Passer 2D (WebGL) ↔ 3D plusieurs fois
3. Vérifier: Transitions fluides, pas de freeze

## ✅ État Actuel

**Fonctionnel**: Oui, transitions de base fonctionnent  
**À tester**: Workflows complets avec votre base  
**À améliorer**: 
- Vue TOP pourrait se centrer automatiquement sur la sélection
- Zoom pourrait s'adapter à la taille de la sélection

---

**Conclusion**: Le système de synchronisation 2D ↔ 3D est implémenté et devrait fonctionner de manière transparente pour l'utilisateur.
