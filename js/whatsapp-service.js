const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Configuración del negocio
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || '5493487456789'; // Número del admin

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

whatsappClient.on('ready', () => {
  const timestamp = new Date().toLocaleString('es-AR');
  console.log('\n🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
  console.log(`✅ WHATSAPP BUSINESS CONECTADO! [${timestamp}]`);
  console.log(`📱 Negocio: ${BUSINESS_NAME}`);
  console.log(`📞 Admin: ${ADMIN_WHATSAPP}`);
  console.log('🛍️ ¡Los clientes ya pueden contactarte por WhatsApp!');
  console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
  whatsappReady = true;
  qrGenerated = false;
});

whatsappClient.on('authenticated', () => {
  console.log('🔐 WhatsApp autenticado correctamente');
});

whatsappClient.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación WhatsApp:', msg);
  console.log('🔄 Solucion: Elimina la carpeta .wwebjs_auth y reinicia');
  whatsappReady = false;
  qrGenerated = false;
});

whatsappClient.on('disconnected', (reason) => {
  console.log('⚠️ WhatsApp desconectado:', reason);
  whatsappReady = false;
  qrGenerated = false;
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
  try {
    if (!whatsappReady) {
      return { 
        success: false, 
        error: 'WhatsApp no está listo. Verifica la conexión.' 
      };
    }

    // Formatear número (agregar @c.us si no lo tiene)
    const numeroFormateado = numero.includes('@') ? numero : `${numero}@c.us`;
    
    // Enviar mensaje
    const chat = await whatsappClient.getChatById(numeroFormateado);
    await chat.sendMessage(mensaje);
    
    return { 
      success: true, 
      message: 'Mensaje enviado correctamente' 
    };
    
  } catch (error) {
    console.error('❌ Error enviando WhatsApp:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Función para obtener estado
function getWhatsAppStatus() {
  return {
    whatsapp_ready: whatsappReady,
    business_name: BUSINESS_NAME,
    admin_whatsapp: ADMIN_WHATSAPP,
    timestamp: new Date().toISOString()
  };
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