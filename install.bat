@echo off
REM Script pour installer les dependances
wsl.exe -d Ubuntu -e bash -c "cd ~/projects/geneaverse-3d-v32 && npm install"
