# Proposition Technique : Optimisation InstancedMesh & Déploiement 3D Automatique

## 1. Objectifs
1.  **Performance** : Passer de la gestion de centaines d'individus à plusieurs milliers (10k+) à 60 FPS.
2.  **Automatisation** : Calculer la position spatiale (X, Y, Z) de tous les individus d'un GEDCOM complet sans intervention manuelle.
3.  **Esthétique** : Maintenir le concept "Time-Space Cube" (X=Génération, Y=Temps, Z=Famille).

---

## 2. Optimisation via InstancedMesh

Actuellement, chaque `IndividualBox` est un `Mesh` distinct (1 Draw Call par individu). Avec 5000 individus, cela sature le GPU/CPU.

### Méthodologie

Nous allons migrer vers **trois couches de rendu** distinctes :

1.  **Couche Instance (Boîtes de vie)** : Un seul `InstancedMesh` pour tous les rectangles de vie.
2.  **Couche Instance (Connecteurs)** : Un seul `InstancedMesh` (ou `LineSegments`) pour les traits d'union et de filiation.
3.  **Couche LOD (Texte/UI)** : Affichage conditionnel des étiquettes HTML/Text uniquement pour les nœuds proches de la caméra ou survolés.

### Implémentation Technique

#### A. La Géométrie de base
Au lieu d'utiliser une `BoxGeometry` centrée, nous utiliserons une géométrie dont l'origine est à la base (naissance).
```typescript
const geometry = new THREE.BoxGeometry(1, 1, 1);
geometry.translate(0, 0.5, 0); // L'origine est maintenant en bas du cube
```

#### B. Gestion des Matrices (Transformation)
Pour chaque individu `i`, nous calculons une matrice de transformation `Matrix4` :
*   **Position** : `(X, BirthDate_Y, Z)`
*   **Scale** : `(Thickness, Lifespan, Thickness)` -> Grâce à la translation précédente, le scale Y étirera la boîte vers le haut (la mort) sans bouger la base (la naissance).
*   **Color** : Utilisation de `instanceColor` pour définir le sexe (Bleu/Rose/Gris) sans changer de matériau.

#### C. Interaction (Raycasting)
Le `Raycaster` natif de Three.js gère les `InstancedMesh`. Il renvoie l'`instanceId`.
*   Nous maintiendrons une `Map<instanceId, IndividualId>` pour retrouver les données GEDCOM lors d'un clic.
*   L'état "Sélectionné/Hover" sera géré via un `InstancedAttribute` (ex: émissivité) ou une "Highlight Box" séparée (un simple Mesh unique qui se déplace sur l'élément sélectionné).

---

## 3. Algorithme de Déploiement Automatique (Auto-Layout)

Le défi est de placer les individus sur l'axe Z (latéral) pour éviter les collisions tout en gardant les familles groupées, sachant que X (Génération) et Y (Temps) sont contraints.

### Algorithme Proposé : "Buchheim-Walker Temporel"

C'est une adaptation de l'algorithme standard de dessin d'arbres, modifié pour le contexte généalogique 3D.

#### Principes :
1.  **Axe X (Profondeur)** : Fixé par la génération par rapport à la racine.
2.  **Axe Y (Vertical)** : Fixé par les dates de naissance/décès.
3.  **Axe Z (Latéral)** : Calculé dynamiquement.

#### Étapes de l'Algorithme :

**Phase 1 : Construction du graphe (DAG)**
Le GEDCOM n'est pas un arbre parfait (implexe/pedigree collapse).
*   On sélectionne un individu racine.
*   On parcourt les descendants et ascendants.
*   *Gestion des implexes* : Si un individu apparait plusieurs fois (mariage entre cousins), on crée un "Lien fantôme" visuel plutôt que de dupliquer la boîte, ou on le place à sa première occurrence logique.

**Phase 2 : Traversée "Bottom-Up" (Calcul des largeurs)**
On commence par les feuilles (les individus les plus éloignés en génération).
*   Pour chaque famille nucléaire (Parents + Enfants), on calcule la "Largeur Z" nécessaire.
*   `Largeur_Famille = Somme(Largeurs_Enfants) + Espacements`.
*   On attribue une position Z relative au parent central.

**Phase 3 : Traversée "Top-Down" (Placement absolu)**
On part de la racine (Z=0).
*   On propage les coordonnées Z aux enfants en ajoutant les décalages calculés en Phase 2.
*   **Règle de Contours** : On maintient un tableau des "Frontières Z" par génération pour s'assurer qu'aucune branche ne chevauche une autre voisine. Si une collision est détectée à la génération G, on décale tout le sous-arbre droit vers la droite.

**Phase 4 : Optimisation Spatiale (Relaxation)**
Une fois placé, on applique une passe de "centrage" :
*   Les parents sont repositionnés au centre exact de la moyenne des positions Z de leurs enfants (pour aligner les traits de filiation verticalement autant que possible).
*   Les conjoints sont "aimantés" : Le conjoint est placé à `Z_Individu + Offset_Standard`.

### Gestion des Ascendants vs Descendants
L'algorithme s'exécute en deux passes indépendantes partant de la racine :
1.  **Vers le Futur (+X)** : Arbre des descendants.
2.  **Vers le Passé (-X)** : Arbre des ascendants.

---

## 4. Architecture des Données (Refactoring)

Pour supporter cette charge, la structure `RenderedPerson` actuelle (basée sur React State) est trop lourde. Nous devons passer à un "Store de Scène" optimisé.

### Nouvelle Structure : `SceneGraphStore`

```typescript
interface LayoutNode {
  id: string; // ID GEDCOM
  matrix: Matrix4; // Position/Scale calculés
  color: Color;
  metadata: {
     generation: number;
     birthYear: number;
  }
}

class GenealogyLayoutEngine {
  // Entrée : GedcomData
  // Sortie : Float32Array (Matrices) + Float32Array (Couleurs)
  
  public computeLayout(rootId: string, data: GedcomData): LayoutResult {
      // 1. Identification des noeuds visibles
      // 2. Calcul algorithmique (Buchheim-Walker)
      // 3. Génération des buffers pour Three.js
      return { instanceMatrix, instanceColors, mapIdToIndex };
  }
}
```

## 5. Feuille de Route d'Implémentation

1.  **Semaine 1 : Moteur de Layout (Algorithme pur)**
    *   Implémenter la logique de positionnement Z sans rendu 3D.
    *   Visualiser le résultat en 2D (Console ou Canvas simple) pour valider l'absence de chevauchement.

2.  **Semaine 2 : Composant `InstancedGenealogy`**
    *   Créer un composant React Three Fiber qui remplace la liste `.map()` actuelle.
    *   Lui passer les buffers générés par le moteur.
    *   Gérer les `onClick` via l'index d'instance.

3.  **Semaine 3 : Connecteurs & LOD**
    *   Générer les lignes de connexion (LineSegments) en batch.
    *   Implémenter le système LOD pour n'afficher le texte que si `camera.position.distanceTo(node) < seuil`.

4.  **Semaine 4 : Animations & Transitions**
    *   Utiliser une librairie comme `maath` ou `gsap` pour interpoler les matrices lors des changements de racine (transition fluide des positions).

