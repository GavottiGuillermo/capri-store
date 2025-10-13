const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Configuración del negocio
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP; // Número del admin

let whatsappReady = false;
let qrGenerated = false;

console.log('📱 Configurando WhatsApp Business...');

// Configurar cliente WhatsApp con configuraciones optimizadas
// Usar directorio temporal persistente para Render
const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : './.wwebjs_auth/';
console.log(`📁 Usando directorio de autenticación: ${authPath}`);

const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: 'capri-store-session',
    dataPath: authPath
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
    timeout: 60000 // Timeout más largo para conexiones lentas
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  }
});

// Eventos de WhatsApp
whatsappClient.on('qr', (qr) => {
  if (qrGenerated) {
    console.log('\n⚠️ QR anterior expiró, generando nuevo código...\n');
  }
  
  console.log('\n🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
  console.log('📱 ¡CÓDIGO QR PARA WHATSAPP BUSINESS! 📱');
  console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥\n');
  
  // Generar QR en la terminal
  qrcode.generate(qr, { small: true });
  
  console.log('\n📲 INSTRUCCIONES PARA EVITAR "NO SE PUDO CONECTAR":');
  console.log('1️⃣ Abre WhatsApp en tu teléfono');
  console.log('2️⃣ Asegúrate de tener BUENA conexión WiFi/datos');
  console.log('3️⃣ Ve a Configuración > Dispositivos vinculados');
  console.log('4️⃣ Toca "Vincular un dispositivo"');
  console.log('5️⃣ Escanea LENTAMENTE el QR de arriba ☝️');
  console.log('6️⃣ ¡ESPERA hasta ver "CONECTADO" sin cerrar nada!');
  console.log('\n⚠️ TIPS IMPORTANTES:');
  console.log('• NO cierres WhatsApp mientras escaneas');
  console.log('• NO salgas de la pantalla de escaneo');
  console.log('• Espera 10-15 segundos después de escanear');
  console.log('• Si falla, espera 2 minutos antes de reintentar');
  console.log('\n🖥️ INFORMACIÓN DEL DISPOSITIVO:');
  console.log('• Debería aparecer como "Linux Desktop" o "Chrome Linux"');
  console.log('• Si aparece como "MAC Desktop", la sesión está corrupta');
  console.log('• User Agent corregido para Render/Linux');
  console.log('\n⏰ Tienes 60 segundos para escanearlo');
  console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥\n');
  
  qrGenerated = true;
});

whatsappClient.on('ready', async () => {
  const timestamp = new Date().toLocaleString('es-AR');
  whatsappReady = true;
  
  // Verificar estado real
  try {
    const state = await whatsappClient.getState();
    console.log('\n🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
    console.log(`✅ WHATSAPP BUSINESS CONECTADO! [${timestamp}]`);
    console.log(`📱 Negocio: ${BUSINESS_NAME}`);
    console.log(`📞 Admin: ${ADMIN_WHATSAPP}`);
    console.log(`🔗 Estado del cliente: ${state}`);
    console.log(`📁 Directorio auth: ${authPath}`);
    console.log('🛍️ ¡Los clientes ya pueden contactarte por WhatsApp!');
    console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
    
    // En Render, programar verificación periódica para mantener sesión viva
    if (process.env.RENDER) {
      console.log('🔄 Render detectado - Programando verificaciones de sesión cada 10 minutos');
      setInterval(async () => {
        try {
          const currentState = await whatsappClient.getState();
          console.log(`⏰ Verificación periódica - Estado: ${currentState || 'null'}`);
          if (!currentState || currentState !== 'CONNECTED') {
            console.log('⚠️ Estado perdido - Marcando como no listo');
            whatsappReady = false;
          }
        } catch (error) {
          console.log(`⚠️ Error en verificación periódica: ${error.message}`);
          whatsappReady = false;
        }
      }, 10 * 60 * 1000); // 10 minutos
    }
    
  } catch (error) {
    console.log(`✅ WhatsApp conectado pero error obteniendo estado: ${error.message}`);
  }
});

whatsappClient.on('authenticated', () => {
  console.log('🔐 WhatsApp autenticado correctamente');
});

whatsappClient.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación WhatsApp:', msg);
  console.log('🔄 La sesión guardada puede estar corrupta');
  console.log('💡 Solución: Elimina la carpeta .wwebjs_auth/ y reinicia el servidor');
  console.log('📱 Después tendrás que escanear el QR una vez más');
  whatsappReady = false;
  qrGenerated = false;
});

whatsappClient.on('disconnected', (reason) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ⚠️ WhatsApp desconectado - Razón: ${reason}`);
  console.log(`[${timestamp}] 🔄 Marcando como no listo y reseteando flags...`);
  whatsappReady = false;
  qrGenerated = false;
  
  // Si la desconexión es por sesión inválida, avisar
  if (reason === 'NAVIGATION' || reason === 'LOGOUT') {
    console.log(`[${timestamp}] ⚠️ Sesión perdida - Se necesitará escanear QR nuevamente`);
  }
  
  // NUEVO: Intentar reconexión automática después de 30 segundos
  console.log(`[${timestamp}] 🔄 Programando reconexión automática en 30 segundos...`);
  setTimeout(async () => {
    try {
      console.log(`[${new Date().toISOString()}] 🔄 Intentando reconexión automática...`);
      
      // Verificar si la carpeta de sesión existe
      const fs = require('fs');
      const path = require('path');
      const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : path.join(__dirname, '..', '.wwebjs_auth');
      
      if (fs.existsSync(authPath)) {
        console.log(`[${new Date().toISOString()}] ✅ Sesión guardada existe, intentando reconectar...`);
        await whatsappClient.initialize();
      } else {
        console.log(`[${new Date().toISOString()}] ❌ No hay sesión guardada, se necesitará QR`);
      }
    } catch (reconnectError) {
      console.error(`[${new Date().toISOString()}] ❌ Error en reconexión automática:`, reconnectError.message);
    }
  }, 30000);
});

whatsappClient.on('loading_screen', (percent, message) => {
  console.log('📱 Cargando WhatsApp:', percent + '%', message);
});

// Función para inicializar WhatsApp
async function inicializarWhatsApp() {
  try {
    console.log('🚀 Inicializando WhatsApp Business...');
    await whatsappClient.initialize();
  } catch (error) {
    console.error('❌ Error inicializando WhatsApp:', error);
    throw error;
  }
}

// Función para enviar mensajes
async function enviarWhatsApp(numero, mensaje) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📤 INICIANDO ENVÍO DE WHATSAPP`);
  console.log(`[${timestamp}] 📱 Número destino: ${numero}`);
  console.log(`[${timestamp}] 📝 Mensaje (primeros 100 chars): ${mensaje.substring(0, 100)}...`);
  
  try {
    // Verificar múltiples condiciones de estado
    console.log(`[${timestamp}] 🔍 Verificando estado de WhatsApp...`);
    console.log(`[${timestamp}] - whatsappReady flag: ${whatsappReady}`);
    
    let clientState;
    try {
      clientState = await whatsappClient.getState();
      console.log(`[${timestamp}] - clientState: ${clientState}`);
    } catch (stateError) {
      console.error(`[${timestamp}] ❌ Error obteniendo estado del client:`, stateError.message);
      clientState = 'ERROR_GETTING_STATE';
    }
    
    const isReady = whatsappReady && clientState === 'CONNECTED';
    console.log(`[${timestamp}] - isReady calculado: ${isReady}`);
    
    if (!isReady) {
      console.error(`[${timestamp}] ❌ WhatsApp no listo para envío:`, { 
        whatsappReady, 
        clientState,
        isReady,
        timestamp
      });
      return { 
        success: false, 
        error: `WhatsApp no está listo. Estado: ${clientState || 'UNKNOWN'}, Flag: ${whatsappReady}` 
      };
    }

    // Validar número de destino
    if (!numero || numero.trim() === '') {
      console.error(`[${timestamp}] ❌ Número de destino vacío o inválido`);
      return { 
        success: false, 
        error: 'Número de destino no válido' 
      };
    }

    // Formatear número (agregar @c.us si no lo tiene)
    const numeroFormateado = numero.includes('@') ? numero : `${numero}@c.us`;
    console.log(`[${timestamp}] 📱 Número formateado: ${numeroFormateado}`);
    
    // Enviar mensaje
    console.log(`[${timestamp}] 🚀 Obteniendo chat y enviando mensaje...`);
    const chat = await whatsappClient.getChatById(numeroFormateado);
    console.log(`[${timestamp}] ✅ Chat obtenido, enviando mensaje...`);
    
    const messageResult = await chat.sendMessage(mensaje);
    console.log(`[${timestamp}] ✅ Mensaje enviado exitosamente!`);
    
    // Mejorar el logging del messageId para evitar [object Object]
    let messageIdStr = 'N/A';
    if (messageResult && messageResult.id) {
      if (typeof messageResult.id === 'string') {
        messageIdStr = messageResult.id;
      } else if (typeof messageResult.id === 'object') {
        messageIdStr = messageResult.id._serialized || JSON.stringify(messageResult.id);
      }
    }
    console.log(`[${timestamp}] 📨 Message ID: ${messageIdStr}`);
    
    return { 
      success: true, 
      message: 'Mensaje enviado correctamente',
      messageId: messageResult.id,
      timestamp
    };
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ ERROR CRÍTICO enviando WhatsApp:`, error.message);
    console.error(`[${timestamp}] Stack trace:`, error.stack);
    return { 
      success: false, 
      error: error.message,
      stack: error.stack,
      timestamp
    };
  }
}

// Función para obtener estado
async function getWhatsAppStatus() {
  const fs = require('fs');
  const path = require('path');
  
  try {
    let clientState;
    let stateError = null;
    let clientInfo = null;
    
    try {
      clientState = await whatsappClient.getState();
      console.log(`[DEBUG] getState() devolvió: ${clientState}`);
      
      // Intentar obtener info del cliente también
      try {
        clientInfo = whatsappClient.info;
        console.log(`[DEBUG] client.info:`, clientInfo ? 'Disponible' : 'null');
      } catch (infoError) {
        console.log(`[DEBUG] Error obteniendo client.info:`, infoError.message);
      }
      
    } catch (error) {
      stateError = error.message;
      clientState = null;
      console.error(`[DEBUG] Error en getState():`, error.message);
    }
    
    const isReady = whatsappReady && clientState === 'CONNECTED';
    
    console.log(`[DEBUG] Estado calculado:`, {
      whatsappReady,
      clientState,
      isReady,
      hasStateError: !!stateError
    });
    
    // Verificar si existe la carpeta de autenticación
    const authDirPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : path.join(__dirname, '..', '.wwebjs_auth');
    let authFolderExists = false;
    let authFolderContents = [];
    
    try {
      authFolderExists = fs.existsSync(authDirPath);
      if (authFolderExists) {
        authFolderContents = fs.readdirSync(authDirPath);
      }
    } catch (fsError) {
      console.error('Error verificando carpeta auth:', fsError.message);
    }
    
    return {
      whatsapp_ready: isReady,
      client_state: clientState,
      flag_ready: whatsappReady,
      qr_generated: qrGenerated,
      business_name: BUSINESS_NAME,
      admin_whatsapp: ADMIN_WHATSAPP ? `${ADMIN_WHATSAPP.substring(0, 4)}****` : 'NO CONFIGURADO',
      client_info: clientInfo ? {
        platform: clientInfo.platform,
        phone: clientInfo.wid ? clientInfo.wid.user : 'unknown'
      } : null,
      auth_folder: {
        exists: authFolderExists,
        path: authDirPath,
        contents_count: authFolderContents.length,
        has_session: authFolderContents.some(file => file.includes('session')),
        files: authFolderContents
      },
      diagnostics: {
        should_show_qr: !isReady && !authFolderExists,
        session_should_persist: authFolderExists && authFolderContents.length > 0,
        needs_rescan: authFolderExists && !isReady && qrGenerated,
        state_error: stateError,
        problem_identified: clientState === null && authFolderExists && authFolderContents.length > 0,
        suggested_action: clientState === null && authFolderExists ? 'FORCE_RECONNECT' : 'WAIT_OR_SCAN'
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      whatsapp_ready: false,
      client_state: 'ERROR',
      flag_ready: whatsappReady,
      qr_generated: qrGenerated,
      error: error.message,
      business_name: BUSINESS_NAME,
      admin_whatsapp: ADMIN_WHATSAPP ? `${ADMIN_WHATSAPP.substring(0, 4)}****` : 'NO CONFIGURADO',
      diagnostics: {
        problem_identified: true,
        suggested_action: 'CHECK_SERVER_LOGS',
        state_error: error.message
      },
      timestamp: new Date().toISOString()
    };
  }
}

// Función para forzar reconexión
async function forzarReconexion() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔄 FORZANDO RECONEXIÓN de WhatsApp...`);
  
  try {
    // Resetear flags
    whatsappReady = false;
    qrGenerated = false;
    
    console.log(`[${timestamp}] 1️⃣ Destruyendo cliente actual...`);
    await whatsappClient.destroy();
    
    console.log(`[${timestamp}] 2️⃣ Esperando 3 segundos...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log(`[${timestamp}] 3️⃣ Reinicializando cliente...`);
    await whatsappClient.initialize();
    
    console.log(`[${timestamp}] ✅ Reconexión iniciada correctamente`);
    return {
      success: true,
      message: 'Reconexión forzada iniciada',
      timestamp
    };
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en reconexión forzada:`, error.message);
    return {
      success: false,
      error: error.message,
      timestamp
    };
  }
}

// Función para limpiar sesión corrupta
async function limpiarSesionCorrupta() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🧹 LIMPIANDO SESIÓN CORRUPTA...`);
  
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Destruir cliente primero
    whatsappReady = false;
    qrGenerated = false;
    
    try {
      await whatsappClient.destroy();
    } catch (destroyError) {
      console.log(`[${timestamp}] ⚠️ Error destruyendo cliente:`, destroyError.message);
    }
    
    // Eliminar carpeta de autenticación
    const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : path.join(__dirname, '..', '.wwebjs_auth');
    
    if (fs.existsSync(authPath)) {
      console.log(`[${timestamp}] 🗑️ Eliminando carpeta de autenticación...`);
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log(`[${timestamp}] ✅ Carpeta eliminada`);
    }
    
    // Esperar un poco y reinicializar
    console.log(`[${timestamp}] ⏳ Esperando 5 segundos antes de reinicializar...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log(`[${timestamp}] 🚀 Reinicializando con sesión limpia...`);
    await whatsappClient.initialize();
    
    return {
      success: true,
      message: 'Sesión limpiada y reinicializada - Se necesitará escanear QR',
      timestamp
    };
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error limpiando sesión:`, error.message);
    return {
      success: false,
      error: error.message,
      timestamp
    };
  }
}

module.exports = {
  whatsappClient,
  inicializarWhatsApp,
  enviarWhatsApp,
  getWhatsAppStatus,
  forzarReconexion,
  limpiarSesionCorrupta,
  whatsappReady,
  ADMIN_WHATSAPP,
  BUSINESS_NAME
};