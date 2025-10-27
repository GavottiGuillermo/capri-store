#!/usr/bin/env node

/**
 * Script de inicio optimizado para Render
 * Incluye configuraciones de memoria y garbage collection
 */

// Configurar límites de memoria según el entorno
const isRender = process.env.RENDER || process.env.NODE_ENV === 'production';
const memoryLimit = isRender ? 450 : 512; // Dejar margen en Render

console.log('🚀 Iniciando Capri Store con optimizaciones de memoria...');
console.log(`📊 Límite de memoria configurado: ${memoryLimit}MB`);
console.log(`🔧 Entorno: ${isRender ? 'Render (producción)' : 'Local'}`);

// Configurar opciones de Node.js para optimización de memoria
if (isRender) {
  // En producción (Render), usar configuraciones optimizadas
  process.env.NODE_OPTIONS = `--max-old-space-size=${memoryLimit} --expose-gc --optimize-for-size`;
  console.log('⚡ Opciones de Node.js optimizadas para Render');
} else {
  // En desarrollo, configuración más permisiva
  process.env.NODE_OPTIONS = `--max-old-space-size=${memoryLimit} --expose-gc`;
  console.log('⚡ Opciones de Node.js configuradas para desarrollo');
}

// Configurar manejo de memoria baja
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM recibido - cerrando gracefulmente...');
  if (global.gc) {
    console.log('🧹 Ejecutando garbage collection final...');
    global.gc();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT recibido - cerrando gracefulmente...');
  if (global.gc) {
    console.log('🧹 Ejecutando garbage collection final...');
    global.gc();
  }
  process.exit(0);
});

// Monitor de memoria crítica
setInterval(() => {
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  
  // Si el uso de memoria supera el 85%, forzar GC
  if (rssMB > (memoryLimit * 0.85)) {
    console.log(`⚠️ Memoria alta detectada: ${rssMB}MB/${memoryLimit}MB (${Math.round((rssMB/memoryLimit)*100)}%)`);
    
    if (global.gc) {
      console.log('🧹 Ejecutando garbage collection de emergencia...');
      global.gc();
      
      const newMemUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`🧹 Memoria después de GC: ${newMemUsage}MB (liberados ${rssMB - newMemUsage}MB)`);
    }
  }
}, 30000); // Cada 30 segundos

// Verificar que GC esté disponible
setTimeout(() => {
  if (global.gc) {
    console.log('✅ Garbage collection manual disponible');
  } else {
    console.log('⚠️ Garbage collection manual no disponible (usar --expose-gc)');
  }
}, 1000);

// Iniciar la aplicación principal
console.log('🔄 Cargando aplicación principal...');
require('./js/server.js');