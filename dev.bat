@echo off
REM Script pour demarrer le serveur de developpement
wsl.exe -d Ubuntu -e bash -c "cd ~/projects/geneaverse-3d-v32 && npm run dev"
