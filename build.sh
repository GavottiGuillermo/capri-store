#!/bin/bash
set -e

echo "🔧 Instalando dependencias de Node.js..."
npm install

echo "🌐 Instalando Chrome via @puppeteer/browsers..."
echo "📍 Working directory: $(pwd)"

# Instalar @puppeteer/browsers globalmente si no está
npm install -g @puppeteer/browsers || true

# Instalar Chrome en cache persistente
npx @puppeteer/browsers install chrome@stable --path ./.local-browsers

echo "🔍 Verificando instalación de Chrome..."
if [ -d ".local-browsers/chrome" ]; then
  echo "✅ Directorio .local-browsers/chrome existe"
  echo "📂 Contenido:"
  ls -la .local-browsers/chrome/
  
  # Buscar el ejecutable
  CHROME_PATH=$(find .local-browsers/chrome -name chrome -type f 2>/dev/null | head -1)
  if [ -n "$CHROME_PATH" ]; then
    echo "✅ Chrome encontrado en: $CHROME_PATH"
    chmod +x "$CHROME_PATH"
    echo "✅ Permisos de ejecución configurados"
  else
    echo "❌ Chrome no encontrado en .local-browsers"
  fi
else
  echo "❌ Directorio .local-browsers/chrome NO existe"
fi

echo "✅ Build completado exitosamente"
