# Commandes Utiles - GeneaVerse 3D

## 📍 Navigation

### Aller dans le projet (WSL)
```bash
cd ~/projects/geneaverse-3d-v32
```

### Ouvrir dans un éditeur
```bash
# VS Code / Cursor
cursor .
# ou
code .
```

## 🚀 Développement

### Démarrer le serveur de développement
```bash
npm run dev
```
Accès : http://localhost:5173/

### Arrêter le serveur
```
Ctrl + C
```

### Build de production
```bash
npm run build
```
Les fichiers sont générés dans le dossier `dist/`

### Prévisualiser le build
```bash
npm run preview
```

### Installer/Mettre à jour les dépendances
```bash
# Installer les dépendances
npm install

# Mettre à jour toutes les dépendances
npm update

# Installer une nouvelle dépendance
npm install <package-name>

# Installer une dépendance de développement
npm install -D <package-name>
```

## 🔧 Git

### Voir le statut
```bash
git status
```

### Ajouter des fichiers
```bash
# Ajouter tous les fichiers modifiés
git add .

# Ajouter un fichier spécifique
git add <fichier>
```

### Créer un commit
```bash
git commit -m "Description du commit"
```

### Pousser vers GitHub
```bash
# Première fois ou nouvelle branche
git push -u origin main

# Ensuite
git push
```

### Récupérer les dernières modifications
```bash
git pull
```

### Voir l'historique
```bash
git log --oneline
```

### Créer une nouvelle branche
```bash
# Créer et basculer sur la nouvelle branche
git checkout -b nom-de-la-branche

# Pousser la nouvelle branche
git push -u origin nom-de-la-branche
```

### Revenir à main
```bash
git checkout main
```

## 📦 Gestion des packages

### Vérifier les vulnérabilités
```bash
npm audit
```

### Corriger les vulnérabilités
```bash
npm audit fix
```

### Nettoyer node_modules et réinstaller
```bash
rm -rf node_modules package-lock.json
npm install
```

## 🌐 WSL

### Accéder au dossier depuis Windows
```
\\wsl$\Ubuntu\home\oa\projects\geneaverse-3d-v32
```

### Copier des fichiers Windows → WSL
```bash
cp "/mnt/c/Users/User/chemin/fichier" ~/projects/geneaverse-3d-v32/
```

### Copier des fichiers WSL → Windows
```bash
cp ~/projects/geneaverse-3d-v32/fichier "/mnt/c/Users/User/chemin/"
```

### Ouvrir l'explorateur Windows depuis WSL
```bash
explorer.exe .
```

## 🧹 Nettoyage

### Nettoyer le cache npm
```bash
npm cache clean --force
```

### Nettoyer le build
```bash
rm -rf dist
```

### Nettoyer tout (node_modules + build)
```bash
rm -rf node_modules dist package-lock.json
npm install
```

## 🐛 Debugging

### Voir les logs détaillés de Vite
```bash
npm run dev -- --debug
```

### Vérifier les erreurs TypeScript
```bash
npx tsc --noEmit
```

### Linter (si configuré)
```bash
npm run lint
```

## 📊 Informations système

### Version de Node.js
```bash
node --version
```

### Version de npm
```bash
npm --version
```

### Lister les dépendances installées
```bash
npm list --depth=0
```

### Voir les versions obsolètes
```bash
npm outdated
```

## 🔗 Liens utiles

- **Repository GitHub** : https://github.com/OAuber/Arbre
- **Application locale** : http://localhost:5173/
- **Documentation Three.js** : https://threejs.org/docs/
- **Documentation React Three Fiber** : https://docs.pmnd.rs/react-three-fiber
- **Documentation Vite** : https://vitejs.dev/

## 💡 Raccourcis Cursor/VS Code

- `Ctrl + P` : Recherche rapide de fichiers
- `Ctrl + Shift + F` : Recherche dans tous les fichiers
- `Ctrl + B` : Afficher/masquer la barre latérale
- `Ctrl + J` : Afficher/masquer le terminal intégré
- `Ctrl + K Ctrl + O` : Ouvrir un dossier
- `F5` : Démarrer le débogage

## 🚨 Dépannage courant

### Port 5173 déjà utilisé
```bash
# Trouver le processus
lsof -i :5173

# Tuer le processus (remplacer PID par le numéro)
kill -9 <PID>
```

### Problèmes de permissions WSL
```bash
# Réparer les permissions
chmod -R 755 ~/projects/geneaverse-3d-v32
```

### Problèmes de cache
```bash
# Supprimer les caches
rm -rf node_modules/.vite
npm cache clean --force
rm -rf node_modules
npm install
```

---

**Dernière mise à jour** : 14 février 2026
