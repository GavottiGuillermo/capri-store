/**
 * WhatsApp Service - Conexión efímera via QR
 * ============================================
 * Flujo simple basado en la guía oficial de wwebjs.dev:
 *   1. Se inicializa el cliente (NoAuth = sin persistencia de sesión)
 *   2. Se genera un QR, el usuario lo escanea
 *   3. Se dispara `authenticated` y luego `ready`
 *   4. En `ready` se ejecuta el callback para enviar pendientes
 *   5. Después de enviar, la sesión se destruye automáticamente
 *
 * Usa NoAuth para evitar problemas de sesión corrupta / Store no hidratado.
 * Cada conexión es limpia y de un solo uso.
 */

const { Client, NoAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// ===============================
// DETECCIÓN DE CHROMIUM
// ===============================
let chromiumPath = null;

function findChromiumExecutable() {
  // 1. Desde puppeteer
  try {
    const puppeteer = require('puppeteer');
    const execPath = puppeteer.executablePath();
    if (execPath && fs.existsSync(execPath)) {
      console.log(`✅ Chromium encontrado (puppeteer): ${execPath}`);
      return execPath;
    }
  } catch (_) { /* no-op */ }

  // 2. Cache manual de puppeteer
  const cacheDir = path.join(__dirname, '..', '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(cacheDir)) {
    try {
      const versions = fs.readdirSync(cacheDir).sort().reverse();
      for (const ver of versions) {
        const chromePath = path.join(cacheDir, ver, 'chrome-linux64', 'chrome');
        if (fs.existsSync(chromePath)) {
          console.log(`✅ Chromium encontrado (cache): ${chromePath}`);
          return chromePath;
        }
      }
    } catch (_) { /* no-op */ }
  }

  // 3. Paths del sistema (Linux / Render)
  const os = require('os');
  if (os.platform() === 'linux') {
    const systemPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    for (const p of systemPaths) {
      if (p && fs.existsSync(p)) {
        console.log(`✅ Chromium encontrado (sistema): ${p}`);
        return p;
      }
    }
  }

  console.error('❌ No se encontró ningún ejecutable de Chrome/Chromium');
  return null;
}

chromiumPath = findChromiumExecutable();

if (!chromiumPath) {
  console.error('🚨 ERROR CRÍTICO: No se puede inicializar WhatsApp sin Chrome');
  console.error('Solución: Asegurar que el Build Command incluya "npx puppeteer browsers install chrome"');
}

// ===============================
// CONFIGURACIÓN
// ===============================
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP;

// Args de Puppeteer optimizados para Render Free (poca RAM)
const puppeteerArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--single-process',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-plugins',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=VizDisplayCompositor,IsolateOrigins,site-per-process,TranslateUI,AudioServiceOutOfProcess',
  '--disable-site-isolation-trials',
  '--disable-hang-monitor',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--renderer-process-limit=1',
  '--memory-pressure-off',
  '--js-flags=--max-old-space-size=200',
  '--aggressive-cache-discard',
  '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// ===============================
// ESTADO
// ===============================
let whatsappClient = null;   // Instancia actual del Client
let whatsappReady = false;   // true cuando el evento `ready` se disparó
let isConnecting = false;    // true mientras se está inicializando/esperando QR
let qrAttempts = 0;
const MAX_QR_ATTEMPTS = 5;

// Callback que server.js configura para procesar pendientes on ready
let onWhatsAppReadyCallback = null;

function setOnWhatsAppReadyCallback(callback) {
  onWhatsAppReadyCallback = callback;
}

// ===============================
// HELPERS
// ===============================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getWhatsAppReady() {
  return whatsappReady;
}

function setWhatsAppReady(value) {
  whatsappReady = value;
  return whatsappReady;
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

// ===============================
// NORMALIZACIÓN DE TELÉFONO
// ===============================
function formatearNumeroParaEnvio(numero) {
  // Limpiar todo lo que no sea dígito
  const limpio = String(numero || '').replace(/\D/g, '');
  if (!limpio) return null;
  return `${limpio}@c.us`;
}

// ===============================
// CREAR CLIENTE NUEVO (NoAuth)
// ===============================
function crearClienteWhatsApp() {
  console.log('📱 Creando nuevo cliente WhatsApp (NoAuth - sesión efímera)...');

  const client = new Client({
    authStrategy: new NoAuth(),
    puppeteer: {
      headless: true,
      args: puppeteerArgs,
      timeout: 120000,
      executablePath: chromiumPath,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/ArmandoIMD/ArmandoIMD/refs/heads/main/ArmandoIMD/2.3000.1017484782-alpha.html'
    },
    qrMaxRetries: 3,
    authTimeoutMs: 120000,
    takeoverOnConflict: false
  });

  return client;
}

// ===============================
// REGISTRAR EVENTOS
// ===============================
function registrarEventos(client) {
  // Limpiar listeners anteriores por seguridad
  client.removeAllListeners();

  // Guard contra eventos duplicados
  let readyHandled = false;
  let authenticatedLogged = false;
  let authenticated = false;

  // --- QR ---
  client.on('qr', (qr) => {
    if (authenticated) return; // No mostrar QR si ya está autenticado
    qrAttempts++;
    readyHandled = false;
    authenticatedLogged = false;

    if (qrAttempts > MAX_QR_ATTEMPTS) {
      console.error(`\n❌ LÍMITE DE QRs ALCANZADO (${qrAttempts}/${MAX_QR_ATTEMPTS})`);
      console.error('Ejecutá GET /whatsapp-regenerar-qr para reintentar.\n');
      isConnecting = false;
      return;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📱 CÓDIGO QR PARA WHATSAPP (${qrAttempts}/${MAX_QR_ATTEMPTS})`);
    console.log(`${'='.repeat(60)}\n`);
    qrcode.generate(qr, { small: true });
    console.log('\n📲 Escaneá el QR desde WhatsApp > Dispositivos vinculados > Vincular');
    console.log(`⏰ Tenés 60 segundos. Se regenera automáticamente.\n`);
  });

  // --- AUTHENTICATED ---
  client.on('authenticated', () => {
    if (authenticatedLogged) {
      console.log('🔐 (authenticated duplicado - ignorado)');
      return;
    }
    authenticatedLogged = true;
    authenticated = true;
    console.log('🔐 WhatsApp autenticado correctamente');
    console.log('⏳ Esperando que WhatsApp termine de cargar (evento ready)...');
  });

  // --- AUTH FAILURE ---
  client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
    whatsappReady = false;
    isConnecting = false;
    authenticated = false;
  });

  // --- LOADING SCREEN ---
  client.on('loading_screen', (percent, message) => {
    if (!whatsappReady) {
      console.log(`📱 Cargando WhatsApp: ${percent}% - ${message}`);
    }
  });

  // --- READY (flujo clásico, mínimo indispensable) ---
  client.on('ready', async () => {
    if (readyHandled) {
      console.log('🎉 (ready duplicado - ignorado)');
      return;
    }
    readyHandled = true;
    authenticated = true;

    console.log('\n🎉 ¡WhatsApp CONECTADO y LISTO!');
    whatsappReady = true;
    isConnecting = false;
    qrAttempts = 0;

    // Mostrar info de conexión (opcional)
    try {
      const state = await client.getState();
      console.log(`✅ Estado: ${state}`);
      console.log(`📱 Negocio: ${BUSINESS_NAME}`);
      console.log(`📞 Admin: ${ADMIN_WHATSAPP || 'No configurado'}`);
    } catch (_) {
      console.log('✅ Conectado (no se pudo leer estado detallado)');
    }

    // Ejecutar callback para enviar pendientes
    if (onWhatsAppReadyCallback) {
      console.log('🚀 Procesando notificaciones pendientes...');
      try {
        await onWhatsAppReadyCallback();
      } catch (error) {
        console.error('❌ Error procesando pendientes:', error.message);
      }

      // Una vez enviados los pendientes, destruir la sesión
      console.log('📴 Pendientes procesados. Cerrando sesión WhatsApp...');
      await destruirCliente('pendientes-enviados');
    } else {
      console.log('ℹ️ No hay callback de pendientes configurado.');
    }
  });

  // --- DISCONNECTED ---
  client.on('disconnected', (reason) => {
    console.log(`⚠️ WhatsApp desconectado: ${reason}`);
    whatsappReady = false;
    isConnecting = false;
    authenticated = false;

    console.log('\n========================================');
    console.log('⚠️  WHATSAPP DESCONECTADO');
    console.log('========================================');
    console.log('Para reconectar: GET /whatsapp-regenerar-qr');
    console.log('========================================\n');
  });
}

// ===============================
// DESTRUIR CLIENTE (limpieza post-envío)
// ===============================
async function destruirCliente(reason = 'manual') {
  const ts = new Date().toISOString();
  console.log(`[${ts}] 📴 Destruyendo cliente WhatsApp (${reason})...`);
  whatsappReady = false;
  isConnecting = false;

  if (!whatsappClient) {
    console.log(`[${ts}] ℹ️ No hay cliente activo para destruir`);
    return { success: true, skipped: true };
  }

  try {
    await whatsappClient.destroy();
    console.log(`[${ts}] ✅ Cliente destruido correctamente`);
  } catch (error) {
    // Errores de "Target closed" son esperables al destruir
    console.log(`[${ts}] ⚠️ Error al destruir (esperable): ${error.message}`);
  }

  whatsappClient = null;
  return { success: true };
}

// ===============================
// INICIALIZAR WHATSAPP (genera QR)
// ===============================
async function inicializarWhatsApp(options = {}) {
  const { force = false, reason = 'manual' } = options;
  console.log(`🔵 inicializarWhatsApp() - motivo: ${reason}`);

  if (isConnecting && !force) {
    console.log('🔒 Ya se está conectando - omitiendo');
    return { success: false, skipped: true, reason: 'connecting' };
  }

  if (whatsappReady && !force) {
    console.log('✅ WhatsApp ya está listo');
    return { success: true, skipped: true, reason: 'already_ready' };
  }

  try {
    isConnecting = true;
    qrAttempts = 0;

    // Si hay un cliente anterior, destruirlo primero
    if (whatsappClient) {
      console.log('🧹 Destruyendo cliente anterior...');
      try {
        await whatsappClient.destroy();
      } catch (_) { /* ignorar errores de destroy */ }
      whatsappClient = null;
    }

    // Crear nuevo cliente limpio
    whatsappClient = crearClienteWhatsApp();
    registrarEventos(whatsappClient);

    // Inicializar = lanza Puppeteer y genera QR
    console.log('🚀 Inicializando cliente WhatsApp...');
    await whatsappClient.initialize();
    console.log('✅ Cliente inicializado - esperando escaneo de QR...');

    return { success: true };
  } catch (error) {
    console.error('❌ Error inicializando WhatsApp:', error.message);
    isConnecting = false;
    whatsappClient = null;
    return { success: false, error: error.message };
  }
}

// ===============================
// ENVIAR MENSAJE DE WHATSAPP
// ===============================
/**
 * Envía un mensaje por WhatsApp con reintentos inteligentes.
 *
 * El problema clave en Render Free es que cuando `ready` se dispara,
 * el Store interno de WhatsApp Web todavía no está 100% cargado.
 * Por eso usamos un loop de reintentos con espera corta (300ms)
 * que le da tiempo al Store a hidratarse antes de LOGOUT (~5-10s).
 */
async function enviarWhatsApp(numero, mensaje, options = {}) {
  const ts = new Date().toISOString();
  const maxAttempts = options.maxAttempts || 15;
  const retryDelay = options.retryDelay || 400;

  console.log(`[${ts}] 📤 Enviando WhatsApp a ${numero}`);
  console.log(`[${ts}] 📝 Mensaje: ${mensaje.substring(0, 80)}...`);

  if (!whatsappClient) {
    return { success: false, error: 'No hay cliente WhatsApp activo' };
  }

  if (!whatsappReady) {
    return { success: false, error: 'WhatsApp no está listo (ready=false)' };
  }

  const destino = formatearNumeroParaEnvio(numero);
  if (!destino) {
    return { success: false, error: `Número inválido: ${numero}` };
  }

  console.log(`[${ts}] 📱 Destino formateado: ${destino}`);

  // Loop de reintentos - le da tiempo al Store interno a cargarse
  for (let intento = 1; intento <= maxAttempts; intento++) {
    try {
      console.log(`[${ts}] 🚀 Intento ${intento}/${maxAttempts}...`);

      // Intentar envío directo con client.sendMessage (más robusto)
      const result = await whatsappClient.sendMessage(destino, mensaje);

      // Éxito
      let messageIdStr = 'N/A';
      if (result && result.id) {
        messageIdStr = typeof result.id === 'string'
          ? result.id
          : (result.id._serialized || JSON.stringify(result.id));
      }
      console.log(`[${ts}] ✅ Mensaje enviado exitosamente! (intento ${intento}/${maxAttempts})`);
      console.log(`[${ts}] 📨 Message ID: ${messageIdStr}`);

      return {
        success: true,
        message: 'Mensaje enviado correctamente',
        messageId: result?.id,
        timestamp: ts,
        intentos: intento
      };

    } catch (error) {
      const errorMsg = String(error?.message || error || '').toLowerCase();
      const isStoreNotReady =
        errorMsg.includes('evaluation failed') ||
        errorMsg.includes('getchat') ||
        errorMsg.includes('getstorage') ||
        errorMsg.includes('executioncontext') ||
        errorMsg.includes('target closed') ||
        errorMsg.includes('sendiq') ||
        errorMsg.includes('startcomms') ||
        errorMsg.includes('cannot read properties');

      if (isStoreNotReady && intento < maxAttempts) {
        console.log(`[${ts}] ⏳ Store aún cargando (intento ${intento}/${maxAttempts}), reintentando en ${retryDelay}ms...`);
        await sleep(retryDelay);
        continue;
      }

      // Error final o no transitorio
      console.error(`[${ts}] ❌ Error enviando (intento ${intento}/${maxAttempts}): ${error.message}`);
      return {
        success: false,
        error: error.message,
        timestamp: ts,
        intentos: intento
      };
    }
  }

  return { success: false, error: 'Reintentos agotados', timestamp: ts, intentos: maxAttempts };
}

// ===============================
// OBTENER ESTADO
// ===============================
async function getWhatsAppStatus() {
  if (!whatsappClient) {
    return {
      whatsapp_ready: false,
      client_state: 'NOT_INITIALIZED',
      isReady: false,
      hasStateError: false,
      business_name: BUSINESS_NAME,
      admin_whatsapp: ADMIN_WHATSAPP ? `${ADMIN_WHATSAPP.substring(0, 4)}****` : 'NO CONFIGURADO',
      timestamp: new Date().toISOString()
    };
  }

  let clientState = null;
  let stateError = null;
  let clientInfo = null;

  try {
    clientState = await whatsappClient.getState();
  } catch (error) {
    stateError = error.message;
  }

  try {
    clientInfo = whatsappClient.info;
  } catch (_) { /* no-op */ }

  const isReady = whatsappReady && clientState === 'CONNECTED';

  return {
    whatsapp_ready: isReady,
    client_state: clientState,
    flag_ready: whatsappReady,
    business_name: BUSINESS_NAME,
    admin_whatsapp: ADMIN_WHATSAPP ? `${ADMIN_WHATSAPP.substring(0, 4)}****` : 'NO CONFIGURADO',
    client_info: clientInfo ? {
      platform: clientInfo.platform,
      phone: clientInfo.wid ? clientInfo.wid.user : 'unknown'
    } : null,
    diagnostics: {
      state_error: stateError,
      suggested_action: !isReady ? 'SCAN_QR' : 'NONE'
    },
    timestamp: new Date().toISOString()
  };
}

// ===============================
// FUNCIONES DE RECONEXIÓN / LIMPIEZA
// ===============================
async function forzarReconexion() {
  console.log('🔄 Forzando reconexión...');
  return inicializarWhatsApp({ force: true, reason: 'force-reconnect' });
}

async function limpiarSesionCorrupta() {
  console.log('🧹 Limpieza de sesión (NoAuth = no hay sesión persistente)');
  return inicializarWhatsApp({ force: true, reason: 'clean-session' });
}

function resetearContadorQR() {
  const anterior = qrAttempts;
  qrAttempts = 0;
  console.log(`🔄 Contador QR reseteado: ${anterior} → 0`);
  return { success: true, anterior, actual: 0 };
}

async function sincronizarEstadoWhatsApp() {
  if (!whatsappClient) {
    return { success: false, error: 'No hay cliente' };
  }
  try {
    const state = await whatsappClient.getState();
    const wasReady = whatsappReady;
    whatsappReady = state === 'CONNECTED';
    return { success: true, previous: wasReady, current: whatsappReady, state };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verificarConexionCompleta() {
  const status = await getWhatsAppStatus();
  return {
    conectado: status.whatsapp_ready === true,
    detalles: status,
    timestamp: new Date().toISOString()
  };
}

function marcarConexionExitosa() {
  whatsappReady = true;
  console.log('🎯 Conexión marcada como exitosa');
}

function limpiarMemoriaProactiva() {
  const usedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  if (global.gc) {
    global.gc();
    const afterMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`🧹 Memoria: ${usedMB}MB → ${afterMB}MB`);
  }
}

// Limpieza periódica de memoria en Render
if (process.env.RENDER) {
  setInterval(limpiarMemoriaProactiva, 10 * 60 * 1000);
}

// ===============================
// CLEANUP AL CERRAR PROCESO
// ===============================
async function cleanup() {
  whatsappReady = false;
  if (whatsappClient) {
    try {
      await whatsappClient.destroy();
    } catch (_) { /* no-op */ }
  }
  console.log('✅ WhatsApp cleanup completado');
}

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM recibido');
  await cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT recibido');
  await cleanup();
  process.exit(0);
});

// ===============================
// EXPORTS
// ===============================
module.exports = {
  whatsappClient: null, // se accede via getWhatsAppClient()
  inicializarWhatsApp,
  enviarWhatsApp,
  getWhatsAppStatus,
  verificarConexionCompleta,
  forzarReconexion,
  limpiarSesionCorrupta,
  resetearContadorQR,
  sincronizarEstadoWhatsApp,
  marcarConexionExitosa,
  setWhatsAppReady,
  getWhatsAppReady,
  getWhatsAppClient,
  getIsConnecting,
  setIsConnecting,
  setOnWhatsAppReadyCallback,
  cerrarSesionEfimera: destruirCliente,
  limpiarMemoriaProactiva,
  ultimaConexionExitosa: null,
  sessionIsOld: false,
  ADMIN_WHATSAPP,
  BUSINESS_NAME
};

console.log('📱 WhatsApp Service cargado [v5 - NoAuth efímero]');


