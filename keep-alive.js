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
    await makeRequest('/ping', 'Keep-alive ping silencioso');
  } catch (error) {
    console.error('❌ Keep-alive falló:', error.message);
  }
}

// Verificar salud del sistema
async function healthCheck() {
  try {
    const health = await makeRequest('/ping', 'Health check silencioso');
    
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
    
    if (!status.whatsapp_ready && !status.client_ready) {
      console.log('⚠️ WhatsApp no está listo - verificando causa...');
      
      // Verificar si es problema de QR timeout o sesión expirada
      if (status.state && (status.state.includes('UNPAIRED') || status.state.includes('TIMEOUT'))) {
        console.log('🔄 Detectado QR timeout o sesión expirada - iniciando limpieza automática...');
        
        try {
          const cleanResult = await makeRequest('/limpiar-sesiones-whatsapp', 'Auto-regeneración QR', 'POST');
          
          if (cleanResult.success) {
            console.log('✅ Regeneración automática de QR iniciada exitosamente');
            console.log('📱 Se generará nuevo QR en ~10-15 segundos');
          } else {
            console.error('❌ Error en regeneración automática:', cleanResult.error);
            
            // Fallback: intentar endpoint de forzado completo
            console.log('🔄 Intentando reinicio completo como fallback...');
            await makeRequest('/whatsapp-force-restart', 'Forzar reinicio completo', 'POST');
          }
        } catch (regenerationError) {
          console.error('❌ Error en regeneración automática:', regenerationError.message);
        }
      }
      // Si hay sesión pero no está conectado, puede ser expiración
      else if (status.auth_folder && status.auth_folder.exists && !status.qr_generated) {
        console.log('🔄 Posible sesión expirada - intentando limpieza completa...');
        
        try {
          await makeRequest('/limpiar-sesiones-whatsapp', 'Limpiar sesión expirada', 'POST');
          console.log('✅ Limpieza de sesión expirada iniciada');
        } catch (cleanError) {
          console.error('❌ Error en limpieza de sesión:', cleanError.message);
        }
      }
      else {
        console.log('ℹ️ WhatsApp requiere configuración inicial o escaneo manual de QR');
      }
    } else if (status.whatsapp_ready || status.client_ready) {
      console.log('✅ WhatsApp funcionando correctamente');
    } else {
      console.log('⚠️ Estado WhatsApp indeterminado - no se requiere acción automática');
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