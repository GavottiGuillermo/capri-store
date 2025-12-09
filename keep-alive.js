/**
 * Keep-Alive Script para Render Free Tier
 * Mantiene el servicio activo y verifica WhatsApp periódicamente
 */

const https = require('https');

// Configuración
const SERVICE_URL = 'https://capri-store.onrender.com';
const PING_INTERVAL = 14 * 60 * 1000; // 14 minutos (Render duerme después de 15 min)
const WHATSAPP_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos (más reactivo)
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos

console.log('🔄 Keep-Alive iniciado para Capri Store');
console.log(`📡 URL del servicio: ${SERVICE_URL}`);
console.log(`⏰ Ping cada: ${PING_INTERVAL / 1000 / 60} minutos`);

// Función para hacer requests HTTP
function makeRequest(path, description, method = 'GET') {
  return new Promise((resolve, reject) => {
    const url = `${SERVICE_URL}${path}`;
    const startTime = Date.now();
    
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = https.request(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        const timestamp = new Date().toISOString();
        
        console.log(`[${timestamp}] ✅ ${description}`);
        console.log(`   Status: ${res.statusCode} | Tiempo: ${responseTime}ms | Método: ${method}`);
        
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (e) {
          resolve({ status: 'ok', response_time: responseTime });
        }
      });
      
    });
    
    req.on('error', (err) => {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] ❌ Error en ${description}:`, err.message);
      reject(err);
    });
    
    req.end();
  });
}

// Ping básico para mantener despierto
async function keepAlive() {
  try {
    await makeRequest('/ping', 'Keep-alive ping (mantiene Render activo)');
  } catch (error) {
    console.error('❌ Keep-alive falló:', error.message);
  }
}

// Verificar estado del servicio sin consumir BBDD
async function healthCheck() {
  try {
    const health = await makeRequest('/ping', 'Health check del servicio');
    const timestamp = new Date().toISOString();
    
    console.log(`\n[${timestamp}] 📊 REPORTE DE ESTADO:`);
    console.log(`   🖥️  Servicio Render: ✅ ACTIVO`);
    console.log(`   ⏱️  Uptime: ${health.uptime || 0} segundos`);
    
    if (health.whatsapp_ready) {
      console.log('   📱 WhatsApp: ✅ CONECTADO y listo');
    } else {
      console.log('   📱 WhatsApp: ⚠️ NO CONECTADO');
      console.log('   💡 Para conectar: Accede a /whatsapp-status y escanea el QR');
    }
    
    console.log('   💾 Base de datos: NO SE CONSULTA (ahorro de recursos Neon)');
    console.log('   ✅ Keep-alive cumplió su función\n');
    
  } catch (error) {
    console.error('❌ Health check falló:', error.message);
  }
}

// Función simplificada que SOLO muestra estado sin intervenir
async function checkWhatsAppStatus() {
  try {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] 📱 VERIFICACIÓN WHATSAPP (solo lectura):`);
    
    const status = await makeRequest('/whatsapp-status', 'Estado WhatsApp');
    
    if (status.whatsapp_ready || status.client_ready) {
      console.log('   ✅ WhatsApp: FUNCIONANDO correctamente');
      console.log('   📞 Estado: Listo para enviar mensajes');
    } else if (status.qr_generated) {
      console.log('   ⏳ WhatsApp: QR generado, esperando escaneo');
      console.log('   💡 Acción: Escanea el QR desde /whatsapp-status');
    } else if (status.state === 'NOT_INITIALIZED') {
      console.log('   💤 WhatsApp: No inicializado (modo ahorro)');
      console.log('   💡 Se inicializará automáticamente cuando llegue una venta');
    } else {
      console.log('   ⚠️ WhatsApp: Requiere atención manual');
      console.log('   💡 Accede a /whatsapp-status para ver detalles');
    }
    
    console.log('   ℹ️  Keep-alive NO hace cambios automáticos\n');
    
  } catch (error) {
    console.error('❌ Verificación WhatsApp falló:', error.message);
  }
}

// Iniciar keep-alive
console.log('🚀 Iniciando rutinas de monitoreo...');
console.log('💡 IMPORTANTE: Keep-alive NO consume base de datos Neon');
console.log('💡 Solo mantiene Render activo y muestra estado del servicio\n');

// Ping cada 14 minutos para evitar que Render duerma el servicio
setInterval(keepAlive, PING_INTERVAL);

// Health check cada 2 horas (solo lectura, no consume BBDD)
const HEALTH_INTERVAL = 2 * 60 * 60 * 1000; // 2 horas
setInterval(healthCheck, HEALTH_INTERVAL);

// Verificación de estado WhatsApp cada 2 horas (solo lectura)
const STATUS_CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 2 horas
setInterval(checkWhatsAppStatus, STATUS_CHECK_INTERVAL);

// Ejecutar checks iniciales
setTimeout(async () => {
  console.log('🔄 Ejecutando check inicial...');
  await healthCheck();
  await checkWhatsAppStatus();
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