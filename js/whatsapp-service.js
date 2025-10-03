const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// ===============================
// CONFIGURACIÓN DE WHATSAPP BUSINESS
// ===============================
let whatsappClient = null;
let whatsappReady = false;

const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || '5493487456789';
const BUSINESS_NAME = 'Capri Store';

console.log('📱 Configurando WhatsApp Business...');

// Configurar cliente WhatsApp
whatsappClient = new Client({
  authStrategy: new LocalAuth({
    name: 'capri-store-session'
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
      '--disable-gpu'
    ]
  }
});

// Eventos de WhatsApp
whatsappClient.on('qr', (qr) => {
  console.log('📱 Escanea este código QR con WhatsApp:');
  qrcode.generate(qr, { small: true });
  console.log('ℹ️  1. Abre WhatsApp en tu teléfono');
  console.log('ℹ️  2. Ve a Configuración > Dispositivos vinculados');
  console.log('ℹ️  3. Toca "Vincular un dispositivo"');
  console.log('ℹ️  4. Escanea el código QR de arriba');
});

whatsappClient.on('ready', () => {
  console.log('✅ WhatsApp Business conectado exitosamente!');
  whatsappReady = true;
});

whatsappClient.on('authenticated', () => {
  console.log('🔐 WhatsApp autenticado correctamente');
});

whatsappClient.on('auth_failure', (msg) => {
  console.error('❌ Fallo de autenticación WhatsApp:', msg);
  whatsappReady = false;
});

whatsappClient.on('disconnected', (reason) => {
  console.log('📱 WhatsApp desconectado:', reason);
  whatsappReady = false;
});

// Función para enviar mensajes WhatsApp
const enviarWhatsApp = async (numero, mensaje) => {
  try {
    if (!whatsappReady) {
      console.warn('⚠️ WhatsApp no está listo - mensaje no enviado');
      return { success: false, error: 'WhatsApp no conectado' };
    }
    
    // Formatear número (quitar espacios, guiones, etc.)
    const numeroLimpio = numero.replace(/[^0-9]/g, '');
    const numeroFormateado = numeroLimpio.startsWith('54') ? `${numeroLimpio}@c.us` : `54${numeroLimpio}@c.us`;
    
    console.log(`📱 Enviando WhatsApp a: ${numeroFormateado}`);
    
    await whatsappClient.sendMessage(numeroFormateado, mensaje);
    console.log('✅ Mensaje WhatsApp enviado exitosamente');
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error enviando WhatsApp:', error.message);
    return { success: false, error: error.message };
  }
};

// Inicializar WhatsApp
const inicializarWhatsApp = () => {
  try {
    whatsappClient.initialize();
    console.log('🚀 Inicializando WhatsApp Business...');
  } catch (error) {
    console.error('❌ Error inicializando WhatsApp:', error.message);
  }
};

// Función para obtener estado
const getWhatsAppStatus = () => {
  return {
    whatsapp_ready: whatsappReady,
    client_initialized: !!whatsappClient,
    admin_number: ADMIN_WHATSAPP ? `+${ADMIN_WHATSAPP.substring(0, 5)}****${ADMIN_WHATSAPP.slice(-4)}` : 'NO CONFIGURADO',
    business_name: BUSINESS_NAME
  };
};

module.exports = {
  enviarWhatsApp,
  inicializarWhatsApp,
  getWhatsAppStatus,
  whatsappClient,
  get whatsappReady() { return whatsappReady; },
  ADMIN_WHATSAPP,
  BUSINESS_NAME
};