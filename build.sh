#!/bin/bash
set -e

echo "🔧 Instalando dependencias de Node.js..."
npm install

echo "🌐 Instalando Chrome via Puppeteer..."
echo "📍 Working directory: $(pwd)"
echo "📍 Cache directory: $(pwd)/.cache/puppeteer"

npx puppeteer browsers install chrome

echo "🔍 Verificando instalación de Chrome..."
if [ -d ".cache/puppeteer/chrome" ]; then
  echo "✅ Directorio .cache/puppeteer/chrome existe"
  echo "📂 Contenido:"
  ls -la .cache/puppeteer/chrome/
else
  echo "❌ Directorio .cache/puppeteer/chrome NO existe"
fi

echo "✅ Build completado exitosamente"
