#!/bin/bash
# Script pour créer les fichiers de configuration Tailwind dans WSL

cd ~/projects/geneaverse-3d-v32

echo "Création de tailwind.config.js..."
cat > tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./index.tsx",
    "./App.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./services/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
EOF

echo "Création de postcss.config.js..."
cat > postcss.config.js << 'EOF'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
EOF

echo "Création de src/index.css..."
mkdir -p src
cat > src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF

echo "✅ Fichiers Tailwind créés avec succès !"
ls -la tailwind.config.js postcss.config.js src/index.css
