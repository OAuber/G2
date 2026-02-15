@echo off
REM Script pour builder l'application
wsl.exe -d Ubuntu -e bash -c "cd ~/projects/geneaverse-3d-v32 && npm run build"
