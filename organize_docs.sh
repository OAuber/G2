#!/bin/bash
# Script pour organiser la documentation

cd ~/projects/geneaverse-3d-v32

# Créer le dossier docs
mkdir -p docs

# Déplacer les fichiers de documentation technique
mv project_status.md docs/ 2>/dev/null || echo "project_status.md déjà déplacé"
mv PROPOSAL_OPTIMIZATION_LAYOUT.md docs/ 2>/dev/null || echo "PROPOSAL_OPTIMIZATION_LAYOUT.md déjà déplacé"
mv RECOMMENDATIONS.md docs/ 2>/dev/null || echo "RECOMMENDATIONS.md déjà déplacé"

# Le README.md reste à la racine (convention GitHub)

echo "✅ Documentation organisée dans le dossier docs/"
ls -la docs/
