# Note: Synchronisation 2D ↔ 3D

## Comportement Actuel

### 2D → 3D (Partiellement fonctionnel)
**Ce qui fonctionne**:
- ✅ L'individu sélectionné en 2D devient le centre en 3D (rootIndividual)
- ✅ Vue TOP activée automatiquement
- ✅ Boîtes désactivées automatiquement

**Ce qui ne fonctionne pas complètement**:
- ⚠️ Si vous avez sélectionné uniquement les **ancêtres** en 2D (flèche `<`), la 3D montre l'**arbre complet** (pas juste ancêtres)
- ⚠️ La 3D ne respecte pas le filtrage 2D (ancêtres OU descendants)

### 3D → 2D (Fonctionne bien)
- ✅ Ce qui est visible en 3D est automatiquement visible en 2D
- ✅ Synchronisation continue via `handleVisibleIdsChange`

## Pourquoi C'est Complexe?

### Architectures Différentes

**Vue 2D**:
- Liste **filtrée** d'individus
- Affichage **chronologique** (timeline)
- Filtrage **binaire**: ancêtres OU descendants OU tous

**Vue 3D**:
- **Arbre** construit autour de `rootIndividual`
- Affichage **spatial** (générations)
- Logique **hiérarchique**: construit l'arbre selon relations familiales

### Le Défi

Pour que 2D → 3D respecte le filtrage (ancêtres seulement), il faudrait:

1. **Option A**: Modifier Scene3D pour accepter une liste fixe d'IDs à afficher
   - **Complexe**: Nécessite refactoring de Scene3D
   - **Risqué**: Peut casser la logique existante
   
2. **Option B**: Utiliser `sceneExtras` mais calculer les positions correctement
   - **Complexe**: Besoin de calculateIndividualGeometry pour chaque individu
   - **Lent**: 26k calculs de géométrie
   
3. **Option C**: Accepter que 3D montre toujours l'arbre complet
   - **Simple**: Documenter le comportement
   - **UX**: L'utilisateur voit plus d'informations (pas forcément mauvais)

## 💡 Comportement Recommandé

### Ce que je propose:

**2D → 3D**: 
- Montre l'**arbre complet** de l'individu sélectionné (ancêtres ET descendants)
- Pourquoi? La 3D est faite pour explorer l'arbre complet
- L'utilisateur peut ensuite filtrer en 3D s'il veut

**3D → 2D**:
- Montre **exactement** ce qui était visible en 3D
- Préserve la sélection

### Avantages de cette approche:
1. ✅ **Simple** - Pas de refactoring majeur
2. ✅ **Prévisible** - 3D montre toujours l'arbre complet
3. ✅ **UX cohérent** - Chaque vue a sa logique propre
4. ✅ **Pas de bugs** - Code stable

### Message utilisateur:

Ajouter un message quand on passe en 3D depuis une vue 2D filtrée:
> "Vue 3D: Affichage de l'arbre complet de [Nom]. Utilisez les boutons de drag ou AUTO LAYOUT pour filtrer."

## 🔧 Solution Alternative (Si vraiment nécessaire)

Si vous voulez ABSOLUMENT que 3D respecte le filtrage 2D:

### Approche: Utiliser autoLayoutMode comme signal

```typescript
// Dans handleSetViewMode (2D → 3D)
if (selectedIdsFor2D.size > 0) {
  // Déterminer si c'est ancêtres ou descendants
  const hasAncestors = /* check if any ancestor in selection */;
  const hasDescendants = /* check if any descendant in selection */;
  
  if (hasAncestors && !hasDescendants) {
    setAutoLayoutMode('ancestors'); // 3D montrera ancêtres seulement
  } else if (hasDescendants && !hasAncestors) {
    setAutoLayoutMode('descendants'); // 3D montrera descendants seulement
  } else {
    setAutoLayoutMode('all'); // Les deux
  }
}
```

**Temps estimé**: 1-2h pour implémenter et tester

## ❓ Décision

Voulez-vous:

**A)** Garder le comportement actuel (3D montre arbre complet) + documenter ✅  
**B)** Implémenter la détection ancêtres/descendants (1-2h)  
**C)** Refactorer Scene3D pour accepter liste fixe d'IDs (5-10h, risqué)

Ma recommandation: **A** - C'est un comportement raisonnable et l'utilisateur peut ajuster en 3D.

---

**Pour l'instant**: La synchronisation 3D → 2D fonctionne parfaitement. La synchronisation 2D → 3D montre l'arbre complet (pas juste le filtre 2D).
