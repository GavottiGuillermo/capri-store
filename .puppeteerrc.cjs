/**
 * Configuración de Puppeteer para Render
 * Este archivo asegura que Puppeteer descargue Chromium durante npm install
 */
const { join } = require('path');

module.exports = {
  // Asegurar que Chromium se descargue
  skipDownload: false,
  
  // Cachear en el directorio del proyecto para persistencia en Render
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  
  // Usar Chrome en lugar de Chromium si está disponible
  // Esto permite usar el binario del sistema si existe
  preferredRevision: '131.0.6778.204'
};
