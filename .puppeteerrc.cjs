/**
 * Configuración de Puppeteer para Render
 * Este archivo asegura que Puppeteer descargue Chromium durante npm install
 */
const { join } = require('path');

module.exports = {
  // No saltar la descarga de Chromium
  skipDownload: false,
  
  // Cachear en el directorio del proyecto
  cacheDirectory: join(__dirname, '.cache', 'puppeteer')
};
