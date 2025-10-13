const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Configuración del negocio
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP; // Número del admin

let whatsappReady = false;
let qrGenerated = false;

console.log('📱 Configurando WhatsApp Business...');

// Configurar cliente WhatsApp con configuraciones optimizadas
const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: 'capri-store-session',
    dataPath: './.wwebjs_auth/'
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
      '--disable-features=VizDisplayCompositor'
    ],
    timeout: 60000 // Timeout más largo para conexiones lentas
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
    console.log('🛍️ ¡Los clientes ya pueden contactarte por WhatsApp!');
    console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
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
    console.log(`[${timestamp}] 📨 Message ID: ${messageResult.id || 'N/A'}`);
    
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
    try {
      clientState = await whatsappClient.getState();
    } catch (stateError) {
      clientState = `ERROR: ${stateError.message}`;
    }
    
    const isReady = whatsappReady && clientState === 'CONNECTED';
    
    // Verificar si existe la carpeta de autenticación
    const authPath = path.join(__dirname, '..', '.wwebjs_auth');
    let authFolderExists = false;
    let authFolderContents = [];
    
    try {
      authFolderExists = fs.existsSync(authPath);
      if (authFolderExists) {
        authFolderContents = fs.readdirSync(authPath);
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
      auth_folder: {
        exists: authFolderExists,
        path: authPath,
        contents_count: authFolderContents.length,
        has_session: authFolderContents.some(file => file.includes('session'))
      },
      diagnostics: {
        should_show_qr: !isReady && !authFolderExists,
        session_should_persist: authFolderExists && authFolderContents.length > 0,
        needs_rescan: authFolderExists && !isReady && qrGenerated
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
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  whatsappClient,
  inicializarWhatsApp,
  enviarWhatsApp,
  getWhatsAppStatus,
  whatsappReady,
  ADMIN_WHATSAPP,
  BUSINESS_NAME
};