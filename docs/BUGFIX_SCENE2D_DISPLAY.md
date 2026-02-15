# Bugfix: Affichage d'un seul individu au chargement

**Date**: 14 février 2026  
**Problème**: Un seul individu s'affichait au chargement du GEDCOM au lieu de tous

## Bugs identifiés et corrigés

### 1. Auto-sélection au chargement (App.tsx ligne 180)

**Problème**: Quand un GEDCOM était chargé, la fonction `handleDataLoaded` ajoutait automatiquement le premier individu à `selectedIdsFor2D`:

```typescript
// AVANT (ligne 180)
setSelectedIdsFor2D(new Set([bestCandidate.id]));
```

Résultat: `selectedIdsFor2D.size === 1`, donc le filtre dans Scene2DCanvas n'affichait que cet individu.

**Solution**: Vider la sélection au chargement pour afficher TOUS les individus:

```typescript
// APRÈS (ligne 180)
setSelectedIdsFor2D(new Set()); // Empty = show all
```

### 2. Bouton "All" invisible (Sidebar.tsx ligne 409)

**Problème**: Le bouton ne s'affichait que si `selectedIdsFor2D.size > 0`:

```typescript
// AVANT
{selectedIdsFor2D && selectedIdsFor2D.size > 0 && onClear2DSelection && (
  <button>All</button>
)}
```

Résultat: Au chargement (quand tous sont visibles), le bouton n'apparaissait pas pour revenir à "tous" après un filtrage.

**Solution**: Toujours afficher le bouton + compteur:

```typescript
// APRÈS
<span>2D: {selectedIdsFor2D ? selectedIdsFor2D.size : 0}/{total}</span>
{onClear2DSelection && (
  <button>All</button>
)}
```

### 3. Filtre avec selectedId (Scene2DCanvas.tsx ligne 73)

**Problème**: Le filtre incluait `isFocused = selectedId === indi.id`, ce qui pouvait causer l'affichage d'un seul individu même si `selectedIds` était vide.

```typescript
// AVANT
return isSelectedFor2D || isManual || isFocused;
```

**Solution**: Retirer `isFocused` du filtre:

```typescript
// APRÈS
return isSelectedFor2D || isManual;
```

## Logique finale

### Au chargement d'un GEDCOM:
1. `selectedIdsFor2D` est vide (`new Set()`)
2. Scene2DCanvas détecte `selectedIds.size === 0`
3. Affiche **TOUS** les individus
4. Le compteur affiche "2D: 0/XXX" (0 = tous visibles)

### Après clic sur flèche `<` ou `>`:
1. `handleExpandFamily` remplit `selectedIdsFor2D` avec ancêtres/descendants
2. Scene2DCanvas filtre et affiche uniquement ces individus
3. Le compteur affiche "2D: N/XXX" (N = nombre filtré)

### Après clic sur bouton "All":
1. `handleClear2DSelection` vide `selectedIdsFor2D`
2. Scene2DCanvas détecte `selectedIds.size === 0`
3. Affiche **TOUS** les individus à nouveau
4. Le compteur revient à "2D: 0/XXX"

## Tests de validation

- [x] Charger un GEDCOM → Tous les individus s'affichent
- [x] Compteur affiche "0/XXX" au chargement
- [x] Bouton "All" toujours visible
- [x] Clic sur flèche `<` → Filtre ancêtres uniquement
- [x] Compteur affiche "N/XXX" après filtrage
- [x] Clic sur "All" → Retour à tous les individus
- [x] Compteur revient à "0/XXX"

## Remarque importante

Le compteur "0/XXX" peut sembler contre-intuitif (0 sélectionnés mais tous visibles). Cela pourrait être amélioré:

**Option 1**: Afficher "All" au lieu de "0"
```typescript
<span>2D: {selectedIdsFor2D?.size === 0 ? 'All' : selectedIdsFor2D.size}/{total}</span>
```

**Option 2**: Afficher le nombre réel d'individus visibles
```typescript
<span>2D: {visibleCount}/{total}</span>
```

Pour l'instant, on garde "0/XXX" car c'est techniquement correct (0 sélectionnés explicitement = tous par défaut).

---

**Statut**: ✅ Corrigé  
**Testable**: Oui, rechargez la page et chargez un GEDCOM
