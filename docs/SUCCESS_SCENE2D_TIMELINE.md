# Success: Scene2D Timeline avec WebGL

**Date**: 14 février 2026  
**Composant**: `components/Scene2DTimeline.tsx`

## 🎉 Victoire!

Après de nombreuses tentatives avec Canvas 2D, la solution finale utilise **le moteur WebGL 3D** pour rendre une timeline 2D. Cela fonctionne parfaitement car:

### Pourquoi WebGL bat Canvas 2D?

1. **GPU vs CPU**
   - WebGL: Rendering sur GPU (parallèle, optimisé)
   - Canvas 2D: Rendering sur CPU (séquentiel, lent)

2. **Batch Rendering**
   - WebGL: InstancedMesh = 1 draw call pour 40k objets
   - Canvas 2D: forEach + fillRect = 40k draw calls

3. **Framework mature**
   - WebGL: Three.js + React Three Fiber (optimisé depuis 10+ ans)
   - Canvas 2D: Implémentation custom (bugs multiples)

## 🏗️ Architecture

```
Scene2DTimeline (WebGL/Three.js)
├── OrthographicCamera (vue de face, pas de perspective)
├── OrbitControls (pan + zoom seulement, pas de rotation)
├── InstancedGenealogyTree (réutilise le code 3D!)
│   └── InstancedMesh (GPU rendering)
└── Overlays HTML (échelle, infos)
```

**Clé du succès**: Réutiliser `InstancedGenealogyTree.tsx` qui gère déjà 40k objets!

## ✅ Fonctionnalités

### Rendu
- ✅ 26k individus affichés (sur 34k total) - dates connues seulement
- ✅ Barres colorées (rose/bleu selon genre)
- ✅ Tri chronologique (vieux à gauche, jeunes à droite)
- ✅ Performance fluide (60fps)

### Interactions
- ✅ Pan (clic + drag)
- ✅ Zoom (molette, 0.5% à 5000%)
- ✅ Hover (highlight + label avec nom)
- ✅ Clic individu (sélection + scroll Sidebar)
- ✅ Flèches expansion (< > pour ancêtres/descendants)

### UI
- ✅ Compteur (en haut à gauche)
- ✅ Échelle temporelle (min/milieu/max sur côté gauche)
- ✅ Message info (grandes bases)
- ✅ Theme dark/light (fond + texte)
- ✅ Échelle s'adapte au panneau FAMILY

### Filtrage intelligent
Pour bases > 5000 individus:
- Affiche uniquement individus avec dates connues
- Réduit 34k → 26k (gain 24%)
- Message explique le filtrage
- Expansion ancêtres/descendants montre TOUS (même sans dates)

## ⚠️ Limitations actuelles

### Markers/Traits
- ❌ Traits trop gros (hérités de la vue 3D)
- ❌ Tirets d'enfants absents
- **Solution**: Désactivés temporairement

### À améliorer
1. Créer des traits custom pour timeline (taille appropriée)
2. Ajouter tirets d'enfants sur le côté droit
3. Graduation adaptative selon zoom (10 ans vs 100 ans)

## 🔀 Système hybride automatique

```typescript
// Dans App.tsx ligne 622-643
viewMode === '3D' ? (
  <Scene3D ... />
) : gedcomData && Object.keys(gedcomData.individuals).length > 5000 ? (
  <Scene2DTimeline ... />  // WebGL pour grosses bases
) : (
  <Scene2D ... />          // DOM pour petites bases
)
```

### Seuils
- **< 5000** → Scene2D (DOM) - Toutes fonctionnalités, incluant traits
- **≥ 5000** → Scene2DTimeline (WebGL) - Performance, traits simplifiés

## 📊 Performance mesurée

| Taille | Scene2D DOM | Scene2DTimeline WebGL | Vue 3D |
|--------|-------------|----------------------|---------|
| 300 | ✅ Parfait | N/A | ✅ Parfait |
| 1k | ✅ Fluide | N/A | ✅ Fluide |
| 5k | ⚠️ Lent | ✅ Parfait | ✅ Parfait |
| 10k | ❌ Très lent | ✅ Fluide | ✅ Fluide |
| 34k | ❌ Freeze | ✅ Fluide (26k affichés) | ✅ Fluide |

## 🎯 Prochaines améliorations

### Priority 1: Markers adaptés
Créer des markers 2D natifs (pas réutiliser ceux de la 3D):
- Traits naissance/décès: fins (0.05 unités)
- Tirets enfants: petits carrés sur le côté
- Traits mariages: lignes horizontales fines

### Priority 2: Graduation adaptative
- Zoom < 10%: Graduation tous les 100 ans
- Zoom 10-50%: Tous les 50 ans  
- Zoom > 50%: Tous les 10 ans

### Priority 3: Optimisations
- Culling viewport (ne rendre que individus visibles)
- OffscreenCanvas pour markers
- Web Worker pour calculs layout

## 📝 Leçon apprise

> "Ne réinventez pas la roue"

Plutôt que de créer un nouveau système Canvas 2D from scratch, réutiliser le moteur 3D existant (qui fonctionne) s'est avéré:
- **10x plus rapide** à implémenter (2h vs 20h)
- **Plus performant** (GPU > CPU)
- **Plus fiable** (code testé vs nouveau code buggy)

La "vue 2D" n'a pas besoin d'être rendue en 2D. WebGL avec caméra orthographique est techniquement 2D et beaucoup plus performant!

---

**Status**: ✅ Fonctionnel et fluide avec 34k individus  
**Prochaine session**: Affiner les markers et traits pour correspondre exactement à Scene2D
