const { Client, RemoteAuth } = require('whatsapp-web.js');
const { Pool } = require('pg');
const fs = require('fs-extra');
const qrcode = require('qrcode-terminal');

// ===============================
// CONFIGURACIÓN POSTGRESQL
// ===============================
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Store para RemoteAuth
const store = {
  async sessionExists(options) {
    const { session } = options;
    try {
      const result = await dbPool.query(
        'SELECT id FROM whatsapp_sessions WHERE id = $1',
        [session]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Error verificando sesión:', error.message);
      return false;
    }
  },

  async save(options) {
    const { session } = options;
    try {
      const sessionPath = `${session}.zip`;
      const data = await fs.readFile(sessionPath);
      const base64Data = data.toString('base64');
      
      await dbPool.query(
        `INSERT INTO whatsapp_sessions (id, session_data, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (id) 
         DO UPDATE SET session_data = $2, updated_at = NOW()`,
        [session, base64Data]
      );
      console.log(`✅ Sesión guardada en PostgreSQL`);
    } catch (error) {
      console.error('❌ Error guardando sesión:', error.message);
    }
  },

  async extract(options) {
    const { session, path } = options;
    try {
      const result = await dbPool.query(
        'SELECT session_data FROM whatsapp_sessions WHERE id = $1',
        [session]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Sesión no encontrada');
      }
      
      const buffer = Buffer.from(result.rows[0].session_data, 'base64');
      await fs.writeFile(path, buffer);
      console.log(`✅ Sesión extraída de PostgreSQL`);
    } catch (error) {
      console.error('❌ Error extrayendo sesión:', error.message);
      throw error;
    }
  },

  async delete(options) {
    const { session } = options;
    try {
      await dbPool.query('DELETE FROM whatsapp_sessions WHERE id = $1', [session]);
      console.log(`✅ Sesión eliminada de PostgreSQL`);
    } catch (error) {
      console.error('❌ Error eliminando sesión:', error.message);
    }
  }
};

// ===============================
// VARIABLES DE ESTADO
// ===============================
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP;

let whatsappReady = false;
let whatsappClient = null;
let onWhatsAppReadyCallback = null;
let isConnecting = false;
let ultimaConexionExitosa = null; // Timestamp de última conexión exitosa

// ===============================
// CONFIGURACIÓN DE PUPPETEER
// ===============================
const puppeteerArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--single-process',
  '--no-zygote'
];

// ===============================
// INICIALIZAR WHATSAPP
// ===============================
async function inicializarWhatsApp() {
  console.log('🚀 Inicializando WhatsApp...');
  
  whatsappClient = new Client({
    authStrategy: new RemoteAuth({
      clientId: 'capri-store-session',
      store: store,
      backupSyncIntervalMs: 300000  // 5 minutos
    }),
    puppeteer: {
      headless: true,
      args: puppeteerArgs,
      timeout: 60000
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
  });

  // Evento QR
  whatsappClient.on('qr', (qr) => {
    console.log('\n' + '='.repeat(70));
    console.log('📱 ESCANEA ESTE QR CON WHATSAPP');
    console.log('='.repeat(70) + '\n');
    qrcode.generate(qr, { small: true });
    console.log('\n⏰ Tienes 60 segundos');
    console.log('📲 WhatsApp > Dispositivos vinculados > Vincular');
    console.log('='.repeat(70) + '\n');
  });

  // Evento Ready
  whatsappClient.on('ready', async () => {
    whatsappReady = true;
    ultimaConexionExitosa = new Date(); // Marcar timestamp de conexión
    const timestamp = new Date().toLocaleString('es-AR');
    
    console.log('\n' + '🎉'.repeat(35));
    console.log(`✅ WHATSAPP CONECTADO [${timestamp}]`);
    console.log(`📱 Negocio: ${BUSINESS_NAME}`);
    console.log(`🎯 Conexión exitosa marcada: ${ultimaConexionExitosa.toISOString()}`);
    console.log('🎉'.repeat(35) + '\n');

    // Enviar mensaje al admin
    if (ADMIN_WHATSAPP) {
      try {
        const adminNumber = ADMIN_WHATSAPP.includes('@c.us') 
          ? ADMIN_WHATSAPP 
          : `${ADMIN_WHATSAPP}@c.us`;
        
        await whatsappClient.sendMessage(adminNumber, 
          `✅ WhatsApp conectado - ${timestamp}`);
        console.log('✅ Mensaje enviado al admin');
      } catch (error) {
        console.error('❌ Error enviando mensaje al admin:', error.message);
      }
    }

    // Procesar notificaciones pendientes
    if (onWhatsAppReadyCallback) {
      try {
        console.log('🔄 Procesando notificaciones pendientes...');
        await onWhatsAppReadyCallback();
      } catch (error) {
        console.error('❌ Error procesando pendientes:', error.message);
      }
    }
  });

  // Evento Disconnected
  whatsappClient.on('disconnected', async (reason) => {
    whatsappReady = false;
    ultimaConexionExitosa = null; // Resetear timestamp
    console.log('\n' + '⚠️'.repeat(35));
    console.log(`🔴 WHATSAPP DESCONECTADO - Razón: ${reason}`);
    console.log('⚠️'.repeat(35) + '\n');
    
    // Limpiar sesión si fue LOGOUT
    if (reason === 'LOGOUT') {
      try {
        await store.delete({ session: 'capri-store-session' });
      } catch (error) {
        console.error('❌ Error limpiando sesión');
      }
    }
  });

  // Inicializar
  try {
    await whatsappClient.initialize();
    console.log('✅ Cliente inicializado');
  } catch (error) {
    console.error('❌ Error inicializando:', error.message);
    whatsappReady = false;
  }
}

// ===============================
// REGENERAR QR (MANUAL)
// ===============================
async function regenerarQR() {
  console.log('🔄 Regenerando QR...');
  
  isConnecting = false; // Resetear estado
  
  // Destruir cliente actual
  if (whatsappClient) {
    try {
      await whatsappClient.destroy();
    } catch (error) {
      console.error('Error destruyendo cliente');
    }
  }
  
  // Limpiar sesión
  try {
    await store.delete({ session: 'capri-store-session' });
  } catch (error) {
    console.error('Error limpiando sesión');
  }
  
  whatsappReady = false;
  whatsappClient = null;
  
  // Reinicializar
  await inicializarWhatsApp();
}

// ===============================
// ENVIAR MENSAJE
// ===============================
async function enviarMensajeWhatsApp(numero, mensaje) {
  if (!whatsappReady || !whatsappClient) {
    throw new Error('WhatsApp no está conectado');
  }

  try {
    const numeroFormateado = numero.includes('@c.us') 
      ? numero 
      : `${numero}@c.us`;
    
    await whatsappClient.sendMessage(numeroFormateado, mensaje);
    console.log(`✅ Mensaje enviado a ${numero}`);
    return true;
  } catch (error) {
    console.error(`❌ Error enviando mensaje: ${error.message}`);
    throw error;
  }
}

// ===============================
// ESTADO
// ===============================
function getEstadoWhatsApp() {
  return {
    conectado: whatsappReady,
    clienteDisponible: whatsappClient !== null,
    estado: whatsappReady ? 'CONNECTED' : 'DISCONNECTED'
  };
}

function estaWhatsAppListo() {
  return whatsappReady;
}

function getWhatsAppReady() {
  return whatsappReady;
}

// ===============================
// CALLBACK
// ===============================
function setOnWhatsAppReadyCallback(callback) {
  onWhatsAppReadyCallback = callback;
}

// ===============================
// KEEP-ALIVE (no hace nada, solo retorna estado)
// ===============================
function keepAlive() {
  return {
    ejecutado: true,
    conectado: whatsappReady,
    mensaje: whatsappReady ? 'WhatsApp conectado' : 'WhatsApp desconectado'
  };
}

// ===============================
// FUNCIONES DE COMPATIBILIDAD (STUBS)
// ===============================
function getIsConnecting() {
  return isConnecting;
}

function setIsConnecting(value) {
  isConnecting = value;
  return isConnecting;
}

function getWhatsAppStatus() {
  return getEstadoWhatsApp();
}

function verificarConexionCompleta() {
  return whatsappReady;
}

function forzarReconexion() {
  return { mensaje: 'Auto-reconexión deshabilitada - usar /whatsapp-regenerar-qr' };
}

function resetearContadorQR() {
  return { mensaje: 'Contadores eliminados en versión simplificada' };
}

function sincronizarEstadoWhatsApp() {
  return getEstadoWhatsApp();
}

function marcarConexionExitosa() {
  ultimaConexionExitosa = new Date();
  whatsappReady = true;
  console.log(`🎯 MARCA CONEXIÓN EXITOSA: ${ultimaConexionExitosa.toISOString()}`);
  console.log(`🎯 Estado whatsappReady: ${whatsappReady}`);
}

function setWhatsAppReady(value) {
  whatsappReady = value;
  console.log(`🔧 FORZADO whatsappReady = ${whatsappReady}`);
  return whatsappReady;
}

// ===============================
// EXPORTS
// ===============================
module.exports = {
  inicializarWhatsApp,
  regenerarQR,
  enviarMensajeWhatsApp,
  getEstadoWhatsApp,
  estaWhatsAppListo,
  getWhatsAppReady,
  keepAlive,
  setOnWhatsAppReadyCallback,
  getWhatsAppClient: () => whatsappClient,
  whatsappClient,
  // Funciones de compatibilidad
  getIsConnecting,
  setIsConnecting,
  getWhatsAppStatus,
  verificarConexionCompleta,
  forzarReconexion,
  resetearContadorQR,
  sincronizarEstadoWhatsApp,
  marcarConexionExitosa,
  setWhatsAppReady,
  enviarWhatsApp: enviarMensajeWhatsApp, // Alias
  // Constantes
  ADMIN_WHATSAPP,
  BUSINESS_NAME,
  ultimaConexionExitosa,
  dbPool
};

console.log('📱 Servicio WhatsApp simplificado configurado');
