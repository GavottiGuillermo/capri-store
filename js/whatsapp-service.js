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
    const timestamp = new Date().toLocaleString('es-AR');
    
    console.log('\n' + '🎉'.repeat(35));
    console.log(`✅ WHATSAPP CONECTADO [${timestamp}]`);
    console.log(`📱 Negocio: ${BUSINESS_NAME}`);
    console.log('🎉'.repeat(35) + '\n');

    // Enviar mensaje al admin
    if (ADMIN_WHATSAPP) {
      try {
        const adminNumber = ADMIN_WHATSAPP.includes('@c.us') 
          ? ADMIN_WHATSAPP 
          : `${ADMIN_WHATSAPP}@c.us`;
        
        await whatsappClient.sendMessage(adminNumber, 
          `✅ WhatsApp conectado - ${timestamp}`);
      } catch (error) {
        console.error('❌ Error enviando mensaje al admin');
      }
    }

    // Procesar notificaciones pendientes
    if (onWhatsAppReadyCallback) {
      try {
        await onWhatsAppReadyCallback();
      } catch (error) {
        console.error('❌ Error procesando pendientes');
      }
    }
  });

  // Evento Disconnected
  whatsappClient.on('disconnected', async (reason) => {
    whatsappReady = false;
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

// ===============================
// CALLBACK
// ===============================
function setOnWhatsAppReadyCallback(callback) {
  onWhatsAppReadyCallback = callback;
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
  setOnWhatsAppReadyCallback,
  getWhatsAppClient: () => whatsappClient,
  dbPool
};

console.log('📱 Servicio WhatsApp simplificado configurado');
