#!/bin/bash
set -e

echo "🔧 Instalando dependencias de Node.js..."
npm install

echo "🌐 Instalando Chrome via Puppeteer..."
npx puppeteer browsers install chrome

echo "✅ Build completado exitosamente"
