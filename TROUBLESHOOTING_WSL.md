# Troubleshooting: Cursor + WSL sur Windows

## 🐛 Problème identifié

Erreur lors de l'exécution de commandes depuis Cursor vers WSL:
```
error: "spawn C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe ENOENT"
```

## ✅ Solutions implémentées

### Solution 1: Configuration du Terminal par défaut

Un fichier `.vscode/settings.json` a été créé pour configurer WSL comme terminal par défaut dans Cursor.

**Pour appliquer la configuration:**
1. Fermez tous les terminaux ouverts dans Cursor (`Ctrl + J`)
2. Ouvrez un nouveau terminal (`Ctrl + ù` ou `` Ctrl + ` ``)
3. Le terminal devrait maintenant utiliser WSL Ubuntu par défaut

**Pour vérifier:**
- Ouvrez un terminal dans Cursor
- Vous devriez voir un prompt Linux (ex: `oa@MACHINE:~/projects/geneaverse-3d-v32$`)
- Testez: `which npm` (devrait afficher le chemin npm dans WSL)

### Solution 2: Scripts Batch Windows

Des scripts `.bat` ont été créés pour exécuter les commandes courantes:

| Script | Commande | Description |
|--------|----------|-------------|
| `dev.bat` | Double-clic ou `.\dev.bat` | Lance le serveur de développement |
| `build.bat` | `.\build.bat` | Build de production |
| `install.bat` | `.\install.bat` | Installe les dépendances |

**Utilisation depuis Windows:**
- **Explorateur de fichiers**: Double-cliquez sur `dev.bat`
- **PowerShell Windows**: `.\dev.bat` (dans le dossier du projet)
- **CMD**: `dev.bat`

### Solution 3: Terminal WSL externe (Backup)

Si les solutions 1 et 2 ne fonctionnent pas:

1. **Windows Terminal** (recommandé):
   - Ouvrez Windows Terminal
   - Sélectionnez l'onglet "Ubuntu"
   - Naviguez: `cd ~/projects/geneaverse-3d-v32`
   - Lancez: `npm run dev`

2. **Ubuntu depuis le Menu Démarrer**:
   - Recherchez "Ubuntu" dans le menu Démarrer
   - Ouvrez l'application
   - Même navigation que ci-dessus

## 🔍 Diagnostic supplémentaire

Si le problème persiste après avoir appliqué la Solution 1:

### Vérifier l'installation de WSL
```powershell
wsl --list --verbose
```
Devrait afficher "Ubuntu" comme distribution installée.

### Vérifier que wsl.exe est accessible
```powershell
where.exe wsl
```
Devrait afficher: `C:\Windows\System32\wsl.exe`

### Tester la connexion WSL
```powershell
wsl.exe -d Ubuntu -e whoami
```
Devrait afficher votre nom d'utilisateur WSL (ex: `oa`)

## 🎯 Configuration recommandée pour Cursor

Dans **Settings** de Cursor (`Ctrl + ,`):

1. Recherchez: `terminal.integrated.defaultProfile.windows`
2. Sélectionnez: **Ubuntu (WSL)**

3. Recherchez: `terminal.integrated.cwd`
4. Assurez-vous que c'est: `${workspaceFolder}`

## 📝 Commandes utiles en attendant

Depuis le terminal WSL (une fois ouvert manuellement):

```bash
# Naviguer vers le projet
cd ~/projects/geneaverse-3d-v32

# Lancer le dev
npm run dev

# Build
npm run build

# Installer une nouvelle dépendance
npm install <package-name>

# Vérifier le statut Git
git status
```

## 🚀 Après la correction

Une fois le terminal configuré correctement, vous devriez pouvoir:
- Ouvrir des terminaux directement dans Cursor (avec WSL)
- Exécuter des commandes npm sans problème
- Utiliser tous les outils de développement normalement

## 📞 Si rien ne fonctionne

Alternative temporaire: **Ouvrir le projet directement depuis WSL**

Depuis un terminal Ubuntu/WSL:
```bash
cd ~/projects/geneaverse-3d-v32
cursor .
# ou
code .
```

Cela lancera Cursor/VSCode en mode "Remote WSL", évitant complètement le problème Windows/PowerShell.

---

**Créé le**: 14 février 2026  
**Dernière mise à jour**: 14 février 2026
