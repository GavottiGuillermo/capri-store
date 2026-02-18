const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const PostgresAuthStrategy = require('./postgres-auth-strategy');

// Configuración del negocio
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP;

let whatsappReady = false;
let qrGenerated = false;
let qrAttempts = 0;
const MAX_QR_ATTEMPTS = 5;
let ultimaConexionExitosa = null;

// Callback para procesar notificaciones pendientes cuando WhatsApp se conecta
let onWhatsAppReadyCallback = null;
let lastCallbackExecution = 0;
const CALLBACK_DEBOUNCE_MS = 30000;

// Función para configurar el callback
function setOnWhatsAppReadyCallback(callback) {
  onWhatsAppReadyCallback = callback;
}

// Función para marcar conexión exitosa
function marcarConexionExitosa() {
  ultimaConexionExitosa = new Date();
  whatsappReady = true;
  console.log(`🎯 MARCA CONEXIÓN EXITOSA: ${ultimaConexionExitosa.toISOString()}`);
}

console.log('📱 Configurando WhatsApp Business... [v4 - PostgresAuth]');

// Verificar si tenemos conexión a PostgreSQL
const usePostgresAuth = !!(process.env.DATABASE_URL);
console.log(`🗄️ Estrategia: ${usePostgresAuth ? 'PostgreSQL (Persistente)' : 'Local (Temporal)'}`);

// Configurar estrategia de autenticación
let authStrategy;
try {
  if (usePostgresAuth) {
    console.log('🔐 Configurando autenticación PostgreSQL...');
    authStrategy = new PostgresAuthStrategy({
      clientId: 'capri-store-main',
      dataPath: './temp-auth/'
    });
    console.log('✅ PostgresAuthStrategy creado');
    qrAttempts = 0;
  } else {
    console.log('⚠️ No se encontró DATABASE_URL, usando LocalAuth');
    const { LocalAuth } = require('whatsapp-web.js');
    const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : './.wwebjs_auth/';
    
    authStrategy = new LocalAuth({
      clientId: 'capri-store-session',
      dataPath: authPath
    });
    console.log('✅ LocalAuth creado');
  }
} catch (authError) {
  console.error('❌ ERROR creando AuthStrategy:', authError.message);
  const { LocalAuth } = require('whatsapp-web.js');
  const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : './.wwebjs_auth/';
  
  authStrategy = new LocalAuth({
    clientId: 'capri-store-fallback',
    dataPath: authPath
  });
  console.log('✅ Fallback LocalAuth creado');
}

console.log('🔧 Creando cliente WhatsApp...');

// Argumentos de Puppeteer
const puppeteerArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--renderer-process-limit=1',
  '--max-unused-resource-memory-usage-percentage=25',
  '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// ============================================
// CLIENTE ÚNICO - CREADO UNA SOLA VEZ
// ============================================
const whatsappClient = new Client({
  authStrategy: authStrategy,
  puppeteer: {
    headless: true,
    args: puppeteerArgs,
    timeout: 60000,
    executablePath: undefined,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  qrMaxRetries: 3,
  authTimeoutMs: 60000,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 60000
});

console.log('✅ Cliente WhatsApp creado exitosamente');

// ============================================
// EVENTOS - REGISTRADOS UNA SOLA VEZ
// ============================================
whatsappClient.on('qr', (qr) => {
  qrAttempts++;
  
  if (qrAttempts > MAX_QR_ATTEMPTS) {
    console.error(`\n❌ LÍMITE DE QRs ALCANZADO (${qrAttempts}/${MAX_QR_ATTEMPTS})`);
    console.error('💡 Usa /whatsapp-regenerar-qr para reintentar\n');
    return;
  }
  
  if (qrGenerated) {
    console.log(`\n⚠️ QR expiró, generando nuevo (${qrAttempts}/${MAX_QR_ATTEMPTS})...\n`);
  }
  
  console.log('\n============================================================');
  console.log(`📱 CÓDIGO QR PARA WHATSAPP (${qrAttempts}/${MAX_QR_ATTEMPTS})`);
  console.log('============================================================\n');
  
  qrcode.generate(qr, { small: true });
  
  console.log('\n📲 Escaneá el QR desde WhatsApp > Dispositivos vinculados > Vincular');
  console.log('⏰ Tenés 60 segundos. Se regenera automáticamente.\n');
  
  qrGenerated = true;
});

// Eventos PostgreSQL
if (usePostgresAuth) {
  whatsappClient.on('remote_session_saved', () => {
    console.log('💾 ✅ Sesión guardada en PostgreSQL');
    if (global.gc) global.gc();
  });
  
  whatsappClient.on('remote_session_loaded', () => {
    console.log('📥 ✅ Sesión cargada desde PostgreSQL');
    if (global.gc) global.gc();
  });
  
  whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ Fallo de autenticación:', msg);
  });
  
  // Auto-inicialización si hay sesión
  (async function autoInit() {
    try {
      const sessionExists = await authStrategy.store.sessionExists();
      console.log('📊 Sesión existente:', sessionExists ? '✅ SÍ' : '❌ NO');
      
      if (sessionExists) {
        const sessionData = await authStrategy.store.extract();
        if (sessionData) {
          const size = JSON.stringify(sessionData).length;
          if (size > 5000) {
            console.log('✅ Sesión válida - Inicializando WhatsApp...');
            await whatsappClient.initialize();
          } else {
            console.warn('⚠️ Sesión pequeña - puede estar corrupta');
          }
        }
      } else {
        console.log('💡 Usa /whatsapp-regenerar-qr para generar QR');
      }
    } catch (error) {
      console.error('❌ Error en auto-init:', error.message);
    }
  })();
}

whatsappClient.on('ready', async () => {
  console.log('🎉 EVENTO READY DISPARADO - WhatsApp completamente listo');
  whatsappReady = true;
  marcarConexionExitosa();
  
  // Resetear contador QR
  qrAttempts = 0;
  console.log('✅ Contador de QR reseteado - conexión exitosa');
  
  // Procesar notificaciones pendientes
  if (onWhatsAppReadyCallback) {
    const now = Date.now();
    if (now - lastCallbackExecution > CALLBACK_DEBOUNCE_MS) {
      lastCallbackExecution = now;
      setImmediate(() => {
        try {
          onWhatsAppReadyCallback();
        } catch (error) {
          console.error('❌ Error en callback:', error);
        }
      });
    }
  }
  
  // Info del cliente
  try {
    const state = await whatsappClient.getState();
    console.log('✅ Estado:', state);
    console.log('📱 Negocio:', BUSINESS_NAME);
    console.log('📞 Admin:', ADMIN_WHATSAPP);
    
    const info = whatsappClient.info;
    if (info) {
      console.log('ℹ️ Client info:', JSON.stringify(info));
    }
  } catch (err) {
    console.log('⚠️ No se pudo obtener info del cliente:', err.message);
  }
});

whatsappClient.on('authenticated', () => {
  console.log('🔐 WhatsApp autenticado correctamente');
});

whatsappClient.on('auth_failure', (msg) => {
  console.error('❌ Error de autenticación:', msg);
  whatsappReady = false;
});

whatsappClient.on('loading_screen', (percent, message) => {
  if (!whatsappReady) {
    console.log(`📱 Cargando WhatsApp: ${percent}% - ${message}`);
  }
});

whatsappClient.on('disconnected', (reason) => {
  console.log('⚠️ WhatsApp desconectado:', reason);
  whatsappReady = false;
  console.log('========================================');
  console.log('⚠️  WHATSAPP DESCONECTADO');
  console.log('========================================');
  console.log('Para reconectar: GET /whatsapp-regenerar-qr');
  console.log('========================================');
});

whatsappClient.on('change_state', state => {
  console.log('📊 Cambio de estado WhatsApp:', state);
});

// ============================================
// FUNCIONES PRINCIPALES
// ============================================

async function inicializarWhatsApp() {
  console.log('🔵 inicializarWhatsApp() llamado...');
  
  try {
    const state = await whatsappClient.getState();
    console.log('📊 Estado actual del cliente:', state);
    
    if (state === 'CONNECTED') {
      console.log('✅ Cliente ya conectado - no se requiere inicialización');
      return { success: true, already_connected: true };
    }
  } catch (err) {
    console.log('⚠️ No se pudo obtener estado (esperado si no está inicializado):', err.message);
  }
  
  console.log('🚀 Inicializando WhatsApp...');
  await whatsappClient.initialize();
  
  return { success: true };
}

async function enviarWhatsApp(numero, mensaje, info = {}) {
  const timestamp = new Date().toISOString();
  
  if (!whatsappReady) {
    console.log(`[${timestamp}] ❌ WhatsApp no está listo`);
    return { success: false, error: 'WhatsApp no está listo' };
  }
  
  const numeroFormateado = String(numero || '').replace(/\D/g, '');
  if (!numeroFormateado || numeroFormateado.length < 10) {
    return { success: false, error: 'Número inválido' };
  }
  
  const chatId = `${numeroFormateado}@c.us`;
  
  console.log(`[${timestamp}] 📤 Enviando WhatsApp a ${numero}`);
  
  try {
    await whatsappClient.sendMessage(chatId, mensaje);
    console.log(`[${timestamp}] ✅ Mensaje enviado exitosamente`);
    return { success: true };
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error enviando mensaje:`, error.message);
    return { success: false, error: error.message };
  }
}

async function getWhatsAppStatus() {
  try {
    const state = await whatsappClient.getState();
    return {
      whatsapp_ready: whatsappReady,
      state: state,
      ultima_conexion: ultimaConexionExitosa
    };
  } catch (error) {
    return {
      whatsapp_ready: false,
      state: 'ERROR',
      error: error.message
    };
  }
}

async function resetearContadorQR() {
  qrAttempts = 0;
  console.log('✅ Contador QR reseteado a 0');
  return { success: true };
}

// Funciones adapter para server.js
let isConnecting = false;

function getWhatsAppReady() {
  return whatsappReady;
}

function setWhatsAppReady(value) {
  whatsappReady = value;
}

function getIsConnecting() {
  return isConnecting;
}

function setIsConnecting(value) {
  isConnecting = value;
}

function getWhatsAppClient() {
  return whatsappClient;
}

function verificarConexionCompleta() {
  return whatsappReady && whatsappClient;
}

async function cerrarSesionEfimera() {
  console.log('ℹ️ cerrarSesionEfimera - no-op (sesión persistente)');
  return { success: true };
}

function forzarReconexion() {
  console.log('⚠️ forzarReconexion no implementado en versión PostgreSQL');
  return { success: false };
}

function sincronizarEstadoWhatsApp() {
  return { success: true, state: whatsappReady ? 'ready' : 'not_ready' };
}

async function limpiarSesionCorrupta() {
  console.log('⚠️ limpiarSesionCorrupta no implementado');
  return { success: false };
}

async function limpiarSesionPostgreSQL() {
  if (!usePostgresAuth) {
    return { success: false, error: 'No usando PostgreSQL' };
  }
  
  try {
    await authStrategy.store.delete();
    console.log('✅ Sesión PostgreSQL eliminada');
    return { success: true };
  } catch (error) {
    console.error('❌ Error eliminando sesión:', error.message);
    return { success: false, error: error.message };
  }
}

async function limpiarSesionesCompleto() {
  console.log('🧹 Limpieza completa de sesiones...');
  return await limpiarSesionPostgreSQL();
}

async function forzarGuardadoSesion() {
  console.log('ℹ️ Guardado automático manejado por PostgresAuthStrategy');
  return { success: true };
}

function limpiarMemoriaProactiva() {
  if (global.gc) {
    global.gc();
    console.log('🧹 Memoria liberada');
  }
}

async function cleanup() {
  try {
    if (whatsappClient) {
      await whatsappClient.destroy();
    }
  } catch (err) {
    console.log('⚠️ Error en cleanup:', err.message);
  }
}

console.log('📱 WhatsApp Service cargado [v4 - PostgresAuth con cliente único]');

module.exports = {
  whatsappClient,
  inicializarWhatsApp,
  enviarWhatsApp,
  getWhatsAppStatus,
  forzarReconexion,
  limpiarSesionCorrupta,
  limpiarSesionPostgreSQL,
  limpiarSesionesCompleto,
  resetearContadorQR,
  sincronizarEstadoWhatsApp,
  forzarGuardadoSesion,
  marcarConexionExitosa,
  setOnWhatsAppReadyCallback,
  limpiarMemoriaProactiva,
  ultimaConexionExitosa,
  whatsappReady,
  ADMIN_WHATSAPP,
  BUSINESS_NAME,
  cleanup,
  // Funciones adapter
  getWhatsAppReady,
  setWhatsAppReady,
  getIsConnecting,
  setIsConnecting,
  getWhatsAppClient,
  verificarConexionCompleta,
  cerrarSesionEfimera
};
