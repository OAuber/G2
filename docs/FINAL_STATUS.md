# Status Final - Session du 14 février 2026

## ✅ Ce qui fonctionne parfaitement

### Vue 2D (Scene2D.tsx) - Toutes tailles
1. ✅ **Vue par défaut** - L'app démarre en vue 2D
2. ✅ **Affichage complet** - Tous les individus s'affichent au chargement
3. ✅ **Flèches REMPLAÇANTES** - Clic sur < ou > remplace la vue (ancêtres OU descendants)
4. ✅ **Bouton All/None** - Bascule entre tout afficher et tout cacher
5. ✅ **Données originales ET normalisées** - Fonctionne avec les deux
6. ✅ **Pan/Zoom** - Molette + clic-drag fonctionnels
7. ✅ **Échelle temporelle** - Grille avec années tous les 10 ans
8. ✅ **Recentrage automatique** - Après expansion (sans changer le zoom)
9. ✅ **Scroll automatique** - Sidebar scroll vers l'individu sélectionné
10. ✅ **Tri** - Par nom ou date (asc/desc)
11. ✅ **Recherche** - Dans Sidebar
12. ✅ **Marqueurs** - Naissance (bleu/rose), décès (noir), mariages, enfants
13. ✅ **Flèches expansion** - Visibles et fonctionnelles
14. ✅ **Hover** - Labels avec noms et dates

### Performances
- **< 1000 individus**: ✅ Parfait, fluide
- **1000-5000 individus**: ✅ Correct, utilisable
- **5000-10000 individus**: ⚠️ Lent mais fonctionne
- **> 10000 individus**: ❌ Très lent, Firefox alerte "page ralentit"

### Recommandation automatique
Un message jaune apparaît pour les bases > 5000 individus:
> "⚠️ Large database (X individuals displayed)  
> 2D view may be slow. Click '3D' button (top) for better performance with large datasets."

### Vue 3D (Déjà existante)
- ✅ **40k individus**: Fluide et rapide
- ✅ **InstancedMesh**: Rendu GPU optimisé
- ✅ Toutes les fonctionnalités

## ❌ Ce qui ne fonctionne pas

### Scene2DCanvas / Scene2DCanvasSimple (Tentatives Canvas)
**Fichiers créés mais non fonctionnels**:
- `components/Scene2DCanvas.tsx` (644 lignes) - Version complète, bugs multiples
- `components/Scene2DCanvasSimple.tsx` (225+ lignes) - Version simplifiée, bugs aussi

**Problèmes rencontrés**:
1. Calcul de coordonnées incorrect (translate/scale)
2. Labels et éléments UI mal positionnés
3. Re-renders en boucle causant freeze
4. Échelle temporelle décalée
5. Interactions non fiables
6. Crash lors du switch Original → Normalized

**Temps investi**: ~4-5h de debugging  
**Décision**: Abandonné temporairement

## 🎯 Solution recommandée

### Pour bases < 10k individus
✅ **Utiliser Scene2D (DOM)** - Fonctionne parfaitement
- Toutes les fonctionnalités
- Visualisation claire
- Interactions fluides

### Pour bases ≥ 10k individus
✅ **Utiliser Vue 3D** - Déjà optimisée et fonctionnelle
- Rendu GPU (InstancedMesh)
- Gère 40k+ individus sans ralentir
- Message automatique guide l'utilisateur

## 📋 Workflow utilisateur final

### 1. Démarrage
- Application démarre en **vue 2D**
- Aucun individu affiché (attente GEDCOM)

### 2. Chargement GEDCOM
- **Tous les individus** s'affichent en vue 2D
- Si > 5000 individus → Message recommande vue 3D
- Compteur Sidebar: "All (XXX)"

### 3. Exploration
**Option A - Petite base (< 5k)**:
- Rester en vue 2D
- Cliquer sur flèches < > pour filtrer
- Pan/Zoom pour navigation
- Bouton "All" pour revenir à la vue complète

**Option B - Grosse base (≥ 10k)**:
- Cliquer sur bouton "3D" (en haut)
- Utiliser la vue 3D optimisée
- Retour en 2D possible mais lent

### 4. Boutons disponibles
- **All/None**: Afficher/Cacher tous
- **< >** (flèches): Expansion ancêtres/descendants (REMPLAÇANT)
- **2D/3D**: Basculer entre vues
- **Normalize**: Calculer dates manquantes

## 🔧 Configuration technique

### WSL + Cursor
- ✅ Terminal WSL configuré automatiquement
- ✅ Scripts .bat pour fallback Windows
- ✅ Documentation complète

### Structure code
```
components/
├── Scene2D.tsx          ✅ Fonctionnel (DOM)
├── Scene3D.tsx          ✅ Fonctionnel (WebGL)
├── Scene2DCanvas.tsx    ❌ Non fonctionnel (abandonné)
├── Scene2DCanvasSimple.tsx ❌ Non fonctionnel (abandonné)
├── Sidebar.tsx          ✅ Fonctionnel
├── DetailsPanel.tsx     ✅ Fonctionnel
└── ...
```

## 🚀 Prochaines étapes suggérées

### Option 1: Accepter la situation actuelle ✅
- Scene2D fonctionne bien pour < 10k
- Vue 3D fonctionne bien pour > 10k
- Pas besoin de Canvas pour l'instant

### Option 2: Implémenter Canvas correctement 🔧
Nécessite:
1. Étude approfondie du système de coordonnées Canvas
2. Simplification drastique (juste rectangles, pas de labels/markers)
3. useLayoutEffect + RAF comme la vue 3D
4. 5-10h de développement supplémentaires

### Option 3: Virtualisation DOM 📦
Alternative à Canvas:
- Utiliser react-window ou react-virtualized
- Ne rendre que les éléments visibles
- Moins performant que Canvas mais plus simple
- 2-3h de développement

## 💭 Réflexion technique

**Pourquoi la vue 3D est plus performante que Canvas 2D?**

1. **GPU vs CPU**
   - Vue 3D: WebGL sur GPU (parallèle)
   - Canvas 2D: CPU (séquentiel)

2. **Batch rendering**
   - Vue 3D: InstancedMesh (1 draw call pour 40k objets)
   - Canvas 2D: forEach + fillRect (40k appels)

3. **Framework**
   - Vue 3D: Three.js optimisé depuis 10+ ans
   - Canvas 2D: Implémentation custom

**Conclusion**: Pour > 10k objets graphiques, WebGL (3D) bat Canvas 2D, même pour un affichage "2D".

Une "vue 2D" pourrait être implémentée EN 3D (caméra orthographique) pour bénéficier du GPU rendering.

## 📝 Notes pour future implémentation Canvas

Si vous voulez retry Canvas 2D plus tard:

1. **Utilisez requestAnimationFrame** (pas useEffect direct)
2. **Batch les updates** (comme useLayoutEffect de la vue 3D)
3. **Minimisez les re-renders** (évitez les state changes fréquents)
4. **Testez les coordonnées** sur papier avant d'impl émenter
5. **Commencez ULTRA simple** (juste rectangles) puis ajoutez features
6. **Inspirez-vous de la vue 3D** (InstancedGenealogyTree.tsx ligne 178-370)

---

**Temps total session**: ~5h  
**Résultat**: Scene2D DOM fonctionne pour toutes tailles (avec avertissement > 5k)  
**Recommandation**: Vue 3D pour bases > 10k
