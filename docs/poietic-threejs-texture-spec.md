# Spécification : flux texture Poietic Generator → Three.js

Document pour l’implémentation **côté Poietic Generator** afin d’exposer une source d’image consommable par **Three.js** (textures `THREE.Texture`, `CanvasTexture`, `DataTexture`) sans dépendre d’iframes multiples.

## 1. Objectif

Fournir une **source bitmap 2D** mise à jour en **temps quasi réel**, utilisable depuis une app web tierce (ex. Arbre) pour :

- `map` / `alphaMap` sur un `MeshBasicMaterial` ou `MeshStandardMaterial` ;
- répétition UV (`texture.wrapS` / `texture.wrapT = RepeatWrapping`, `repeat.set(5, 5)` pour un motif en damier côté client) ;
- rendu WebGL **sans** empiler des iframes (pas de Z-buffer partagé, coût DOM élevé pour un tiling 5×5).

**Hors scope** : rejouer toute l’UI Poietic dans Three.js ; l’API ne remplace pas le viewer HTML pour l’interaction complète.

## 2. Contraintes navigateur (Three.js)

| Contrainte | Détail |
|------------|--------|
| **CORS** | Réponses HTTP et handshake WebSocket compatibles avec l’origine du client (`Access-Control-Allow-Origin` ou liste configurable). |
| **Format** | Préférence : **PNG** ou **JPEG** (décodage `Image` / `createImageBitmap`) ; option **RGBA8 brut** (`width × height × 4`) pour latence minimale. |
| **Taille** | Résolution fixe ou annoncée dans les métadonnées ; éviter les changements de dimensions sans message explicite. |
| **Fréquence** | Souvent 5–15 fps pour une texture d’ambiance ; 30 fps si besoin (coût réseau + décodage). |
| **Authentification** | Si nécessaire : query, header, ou sous-protocole WebSocket ; comportement documenté. |

## 3. Options d’architecture

### Option A — HTTP : une image par requête

- `GET https://<host>/api/texture/frame.png` ou `?t=<timestamp>` pour éviter le cache.
- Réponse : `Content-Type: image/png`, corps = une frame.
- Client : `TextureLoader`, ou `fetch` + `createImageBitmap` + mise à jour de `texture.image` et `needsUpdate = true`.

**Inconvénient** : overhead HTTP par image ; gestion du cache / anti-cache.

### Option B — WebSocket : flux binaire (recommandé)

- `wss://<host>/api/texture/stream/v1`
- Mélange **JSON** (métadonnées) et **binaire** (frames).

**Avantage** : une connexion, latence maîtrisée, pas de polling.

### Option C — Canvas partagé / même origine

Peu adapté si Poietic et le client sont sur **des origines différentes** sans proxy.

## 4. Spécification recommandée

### 4.1 WebSocket

- **URL** : `wss://<host>/api/texture/stream/v1`
- **Query optionnelle** : `token=…`, `quality=low|med|high`, `maxFps=10`

### 4.2 Protocole

1. Le client ouvre la WebSocket.
2. Le serveur envoie un message JSON **hello** :

```json
{
  "type": "hello",
  "version": 1,
  "width": 512,
  "height": 512,
  "pixelFormat": "rgba8",
  "maxFps": 10
}
```

`pixelFormat` peut être `rgba8` ou `png` (voir ci-dessous).

3. Ensuite, le serveur envoie des **frames binaires** :
   - **rgba8** : buffer de taille `4 × width × height`. Documenter si les couleurs sont **prémultipliées** ou non ; recommandation : **non prémultiplié**, canal alpha dans A.
   - **png** : fichier PNG complet (pratique si le pipeline encode déjà en PNG).

4. Option : messages `{"type":"ping"}` / `{"type":"pong"}` pour maintenir la connexion.

### 4.3 HTTP de secours

- `GET /api/texture/latest.png` — une image récente, **CORS** aligné sur la config du projet.
- Utile pour prototyper avec `TextureLoader`.

### 4.4 Configuration serveur

- **Origines CORS** : liste blanche (ex. production + `http://localhost:5173`).
- **Rate limiting** par IP / token.
- **Plafond** résolution (ex. 1024×1024).

### 4.5 Sécurité

- Ne pas inclure de données personnelles dans le flux si ce n’est pas nécessaire.
- Token optionnel pour scènes privées ; JWT court possible.
- **WSS** obligatoire en production.

## 5. Exemple consommateur Three.js (RGBA8)

Après réception du message `hello` avec `width` et `height` :

```ts
const tex = new THREE.DataTexture(
  new Uint8Array(width * height * 4),
  width,
  height,
  THREE.RGBAFormat
);
tex.needsUpdate = true;
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.repeat.set(5, 5);
// À chaque frame binaire : copier dans tex.image.data, puis tex.needsUpdate = true
```

Avec des frames **PNG** : `createImageBitmap(new Blob([buffer]))` puis assignation à `texture.image`.

## 6. Livrables côté Poietic

1. Documentation (README ou OpenAPI pour la partie HTTP) : URL, formats, schéma `hello`, exemples.
2. **Page de test** : petit client qui affiche le flux sur un canvas 2D (validation sans Three.js).
3. **Variables d’environnement** suggérées : `TEXTURE_STREAM_MAX_FPS`, `TEXTURE_WIDTH`, `TEXTURE_HEIGHT`, `CORS_ORIGINS`.

## 7. Damier 5×5 côté client (Arbre)

Une fois une **seule texture** disponible :

- `texture.repeat.set(5, 5)` sur le plan ;
- éventuellement `texture.offset` pour animer le motif.

Aucun besoin de multiplier les connexions ou les rendus côté Poietic pour un motif répété en UV.

## 8. Résumé

Implémenter un **flux binaire stable** (WebSocket + **RGBA8** ou **PNG**) avec un message **`hello`**, **CORS / WSS** corrects, et une **résolution fixe** annoncée : meilleur compromis pour Three.js et pour un tiling UV côté client.
