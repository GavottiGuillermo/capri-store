/**
 * WhatsApp Service - Conexión efímera via QR
 * ============================================
 * Basado en la versión de octubre 2025 que funcionaba correctamente.
 * 
 * Características clave:
 * - LocalAuth con clientId específico ('capri-store-session')
 * - Directorio de autenticación: .wwebjs_auth (limpiado en cada inicio)
 * - Delay de 15s después de ready para estabilización
 * - Lock de promesa para evitar inicializaciones concurrentes
 * - Contador de eventos ready para evitar duplicados
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// 🧹 LIMPIAR SESIONES AL CARGAR EL MÓDULO (lo primero de todo)
const authPath = path.join(__dirname, '..', '.wwebjs_auth');
if (fs.existsSync(authPath)) {
  console.log('🧹 Limpiando sesiones antiguas al cargar módulo...');
  try {
    fs.rmSync(authPath, { recursive: true, force: true });
    console.log('✅ Sesiones WhatsApp eliminadas - inicializaciones serán frescas');
  } catch (cleanError) {
    console.warn('⚠️ Error limpiando sesiones:', cleanError.message);
  }
} else {
  console.log('ℹ️ No hay sesiones WhatsApp antiguas para limpiar');
}

// ===============================
// DETECCIÓN DE CHROMIUM
// ===============================
let chromiumPath = null;

function findChromiumExecutable() {
  console.log('🔍 Buscando ejecutable de Chrome/Chromium...');
  
  // 1. Desde puppeteer executablePath() - MÉTODO PREFERIDO
  try {
    const puppeteer = require('puppeteer');
    const execPath = puppeteer.executablePath();
    console.log(`  - Puppeteer path: ${execPath}`);
    if (execPath && fs.existsSync(execPath)) {
      console.log(`✅ Chromium encontrado (puppeteer): ${execPath}`);
      return execPath;
    } else if (execPath) {
      console.warn(`  ⚠️ Puppeteer retornó path pero no existe en disco`);
    }
  } catch (err) {
    console.log(`  - Puppeteer no disponible: ${err.message}`);
  }

  // 2. Cache manual de puppeteer
  const cacheDir = path.join(__dirname, '..', '.cache', 'puppeteer', 'chrome');
  console.log(`  - Verificando cache: ${cacheDir}`);
  if (fs.existsSync(cacheDir)) {
    try {
      const versions = fs.readdirSync(cacheDir).sort().reverse();
      console.log(`  - Versiones encontradas en cache: ${versions.join(', ')}`);
      for (const ver of versions) {
        const chromePath = path.join(cacheDir, ver, 'chrome-linux64', 'chrome');
        console.log(`    Verificando: ${chromePath}`);
        const exists = fs.existsSync(chromePath);
        console.log(`    Existe: ${exists ? '✅ SÍ' : '❌ NO'}`);
        if (exists) {
          console.log(`✅ Chromium encontrado (cache): ${chromePath}`);
          return chromePath;
        }
        // Listar contenido del directorio de la versión para debugging
        try {
          const versionDir = path.join(cacheDir, ver);
          const contents = fs.readdirSync(versionDir);
          console.log(`    Contenido de ${ver}: ${contents.join(', ')}`);
        } catch (listErr) {
          console.log(`    Error listando contenido: ${listErr.message}`);
        }
      }
    } catch (err) {
      console.log(`  - Error leyendo cache: ${err.message}`);
    }
  } else {
    console.log(`  - Cache directory no existe: ${cacheDir}`);
  }

  // 3. Paths del sistema (Linux / Render)
  const os = require('os');
  console.log(`  - Plataforma: ${os.platform()}`);
  if (os.platform() === 'linux') {
    const systemPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    console.log(`  - Verificando paths del sistema: ${systemPaths.filter(p => p).join(', ')}`);
    for (const p of systemPaths) {
      if (p) {
        const exists = fs.existsSync(p);
        console.log(`    ${p}: ${exists ? '✅ EXISTE' : '❌ no existe'}`);
        if (exists) {
          console.log(`✅ Chromium encontrado (sistema): ${p}`);
          return p;
        }
      }
    }
  }

  console.error('❌ No se encontró ningún ejecutable de Chrome/Chromium en ninguna ubicación');
  return null;
}

chromiumPath = findChromiumExecutable();

if (!chromiumPath) {
  console.error('🚨 ERROR CRÍTICO: No se puede inicializar WhatsApp sin Chrome');
  console.error('💡 Soluciones posibles:');
  console.error('   1. Verificar que render.yaml tenga: apt-get install -y google-chrome-stable');
  console.error('   2. O agregar al Build Command: npx puppeteer browsers install chrome');
  console.error('   3. Revisar los logs del build en Render para errores de instalación');
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
let initializationPromise = null; // 🔒 Promesa de inicialización para evitar llamadas concurrentes
let qrAttempts = 0;
const MAX_QR_ATTEMPTS = 5;
let readyEventCount = 0;     // 🔍 Contador para detectar eventos ready duplicados

// Callback que server.js configura para procesar pendientes on ready
let onWhatsAppReadyCallback = null;
const PENDING_AFTER_READY_DELAY_MS = 15000; // 15 segundos para que WhatsApp se estabilice completamente

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
// CREAR CLIENTE NUEVO (LocalAuth temporal)
// ===============================
function crearClienteWhatsApp() {
  console.log('📱 Creando nuevo cliente WhatsApp (LocalAuth con clientId específico)...');

  // Directorio estándar de autenticación (como en octubre 2025)
  const authPath = path.join(__dirname, '..', '.wwebjs_auth');
  
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'capri-store-session',
      dataPath: authPath
    }),
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

  // --- QR ---
  client.on('qr', (qr) => {
    qrAttempts++;

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
    console.log('🔐 WhatsApp autenticado correctamente');
    console.log('⏳ Esperando que WhatsApp termine de cargar (evento ready)...');
  });

  // --- AUTH FAILURE ---
  client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
    whatsappReady = false;
    isConnecting = false;
  });

  // --- LOADING SCREEN ---
  client.on('loading_screen', (percent, message) => {
    if (!whatsappReady) {
      console.log(`📱 Cargando WhatsApp: ${percent}% - ${message}`);
    }
  });

  // --- READY (espera extra, cierre tardío) ---
  client.on('ready', async () => {
    readyEventCount++; // Incrementar contador
    const timestamp = new Date().toISOString();

    if (readyEventCount > 1) {
      console.warn(`⚠️ EVENTO READY DUPLICADO #${readyEventCount} - IGNORANDO`);
      return; // Ignorar eventos ready duplicados
    }

    console.log(`[${timestamp}] 🎉 EVENTO READY DISPARADO - WhatsApp completamente listo`);
    console.log('ℹ️ Se omite la espera de sincronización de chats para evitar bloqueos');
    
    whatsappReady = true;
    isConnecting = false;
    
    // RESETEAR CONTADOR DE QR cuando se conecta exitosamente
    qrAttempts = 0;
    console.log('✅ Contador de QR reseteado - conexión exitosa');

    // Mostrar info de conexión
    try {
      const state = await client.getState();
      const info = client.info;
      console.log(`✅ Estado: ${state}`);
      console.log(`📱 Negocio: ${BUSINESS_NAME}`);
      console.log(`📞 Admin: ${ADMIN_WHATSAPP || 'No configurado'}`);
      if (info) {
        console.log(`ℹ️ Client info: ${JSON.stringify(info)}`);
      }
    } catch (_) {
      console.log('✅ Conectado (no se pudo leer estado detallado)');
    }

    // Procesar notificaciones pendientes DESPUÉS de dar tiempo a WhatsApp para estabilizarse
    if (onWhatsAppReadyCallback) {
      console.log(`🔄 WhatsApp ready - esperando ${PENDING_AFTER_READY_DELAY_MS / 1000}s para estabilización antes de procesar pendientes...`);
      setTimeout(async () => {
        console.log('🚀 Tiempo de estabilización completado - procesando notificaciones pendientes...');
        try {
          await onWhatsAppReadyCallback();
        } catch (error) {
          console.error(`[${timestamp}] ❌ Error en callback de notificaciones pendientes:`, error);
        }
      }, PENDING_AFTER_READY_DELAY_MS);
    } else {
      console.log('ℹ️ No hay callback de pendientes configurado.');
    }
  });

  // --- DISCONNECTED ---
  client.on('disconnected', (reason) => {
    console.log(`⚠️ WhatsApp desconectado: ${reason}`);
    whatsappReady = false;
    isConnecting = false;
    readyEventCount = 0; // Reset contador de ready events

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

  // 🔒 Si ya hay una inicialización en progreso, esperar a que termine
  if (initializationPromise && !force) {
    console.log('🔒 Inicialización ya en progreso - esperando...');
    return initializationPromise;
  }

  if (isConnecting && !force) {
    console.log('🔒 Ya se está conectando - omitiendo');
    return { success: false, skipped: true, reason: 'connecting' };
  }

  if (whatsappClient && whatsappReady && !force) {
    console.log('✅ WhatsApp ya está listo y cliente activo - omitiendo reconexión');
    return { success: true, skipped: true, reason: 'already_ready' };
  }

  // 🔒 Crear promesa de inicialización para evitar llamadas concurrentes
  initializationPromise = (async () => {
    try {
      isConnecting = true;
      qrAttempts = 0;
      readyEventCount = 0; // Reset contador de ready events

      // Si hay un cliente anterior, destruirlo primero
      if (whatsappClient) {
        console.log('🧹 Destruyendo cliente anterior...');
        try {
          await whatsappClient.destroy();
        } catch (_) { /* ignorar errores de destroy */ }
        whatsappClient = null;
      }

      // Crear nuevo cliente limpio (sesión ya fue limpiada al cargar el módulo)
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
    } finally {
      initializationPromise = null; // Limpiar promesa al finalizar
    }
  })();

  return initializationPromise;
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
  const maxAttempts = options.maxAttempts || 30;
  const retryDelay = options.retryDelay || 1200;

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
      // Log de estado antes de cada intento
      try {
        const state = await whatsappClient.getState();
        const info = whatsappClient.info;
        console.log(`[${ts}] ℹ️ Estado antes de enviar: ${state}`);
        if (info) {
          console.log(`[${ts}] ℹ️ Info antes de enviar: ${JSON.stringify(info)}`);
        }
      } catch (e) {
        console.log(`[${ts}] ⚠️ No se pudo obtener estado/info: ${e.message}`);
      }

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

console.log('📱 WhatsApp Service cargado [v6 - LocalAuth con limpieza de sesiones]');


