/**
 * Keep-Alive Script para Render Free Tier
 * Mantiene el servicio activo y verifica WhatsApp periódicamente
 */

const https = require('https');

// Configuración
const SERVICE_URL = 'https://capri-store.onrender.com';
const PING_INTERVAL = 14 * 60 * 1000; // 14 minutos (Render duerme después de 15 min)
const WHATSAPP_CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutos
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos

console.log('🔄 Keep-Alive iniciado para Capri Store');
console.log(`📡 URL del servicio: ${SERVICE_URL}`);
console.log(`⏰ Ping cada: ${PING_INTERVAL / 1000 / 60} minutos`);

// Función para hacer requests HTTP
function makeRequest(path, description) {
  return new Promise((resolve, reject) => {
    const url = `${SERVICE_URL}${path}`;
    const startTime = Date.now();
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        const timestamp = new Date().toISOString();
        
        console.log(`[${timestamp}] ✅ ${description}`);
        console.log(`   Status: ${res.statusCode} | Tiempo: ${responseTime}ms`);
        
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (e) {
          resolve({ status: 'ok', response_time: responseTime });
        }
      });
      
    }).on('error', (err) => {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] ❌ Error en ${description}:`, err.message);
      reject(err);
    });
  });
}

// Ping básico para mantener despierto
async function keepAlive() {
  try {
    await makeRequest('/', 'Keep-alive ping');
  } catch (error) {
    console.error('❌ Keep-alive falló:', error.message);
  }
}

// Verificar salud del sistema
async function healthCheck() {
  try {
    const health = await makeRequest('/health', 'Health check');
    
    if (health.whatsapp_ready) {
      console.log('   📱 WhatsApp: ✅ CONECTADO');
    } else {
      console.log('   📱 WhatsApp: ⚠️ NO CONECTADO');
      
      // Si WhatsApp no está conectado, intentar obtener estado detallado
      try {
        const status = await makeRequest('/whatsapp-status', 'WhatsApp status check');
        
        if (status.qr_generated) {
          console.log('   📱 Estado: QR generado - necesita escaneo');
        } else if (status.auth_folder && status.auth_folder.exists) {
          console.log('   📱 Estado: Sesión existe pero no conectada - posible expiración');
        } else {
          console.log('   📱 Estado: No hay sesión - necesita configuración inicial');
        }
      } catch (statusError) {
        console.error('   ❌ Error obteniendo estado WhatsApp:', statusError.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Health check falló:', error.message);
  }
}

// Verificar y mantener WhatsApp activo
async function whatsappMaintenance() {
  try {
    console.log('🔧 Ejecutando mantenimiento de WhatsApp...');
    
    const status = await makeRequest('/whatsapp-status', 'WhatsApp maintenance check');
    
    if (!status.whatsapp_ready) {
      console.log('⚠️ WhatsApp no está listo - verificando causa...');
      
      // Si hay sesión pero no está conectado, puede ser expiración
      if (status.auth_folder && status.auth_folder.exists && !status.qr_generated) {
        console.log('🔄 Posible sesión expirada - intentando reconexión...');
        
        try {
          await makeRequest('/whatsapp-reconnect', 'Forzar reconexión');
          console.log('✅ Reconexión iniciada');
        } catch (reconnectError) {
          console.error('❌ Error en reconexión:', reconnectError.message);
        }
      }
    } else {
      console.log('✅ WhatsApp funcionando correctamente');
    }
    
  } catch (error) {
    console.error('❌ Mantenimiento WhatsApp falló:', error.message);
  }
}

// Iniciar keep-alive
console.log('🚀 Iniciando rutinas de mantenimiento...');

// Ping cada 14 minutos para evitar que Render duerma el servicio
setInterval(keepAlive, PING_INTERVAL);

// Health check cada 5 minutos
setInterval(healthCheck, HEALTH_CHECK_INTERVAL);

// Mantenimiento de WhatsApp cada 30 minutos
setInterval(whatsappMaintenance, WHATSAPP_CHECK_INTERVAL);

// Ejecutar checks iniciales
setTimeout(async () => {
  console.log('🔄 Ejecutando checks iniciales...');
  await healthCheck();
  await whatsappMaintenance();
}, 5000);

// Mantener el script corriendo
console.log('✅ Keep-alive script configurado correctamente');
console.log('💡 Para usar desde tu computadora local:');
console.log('   node keep-alive.js');
console.log('💡 Para usar desde un servidor externo (recomendado):');
console.log('   - Deployar en Railway, Vercel, o GitHub Actions');
console.log('   - Configurar como cron job en un VPS');

// Manejo de señales para cierre graceful
process.on('SIGINT', () => {
  console.log('\n🛑 Keep-alive detenido por usuario');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Keep-alive detenido por sistema');
  process.exit(0);
});