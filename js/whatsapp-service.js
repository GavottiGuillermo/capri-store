const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const PostgresAuthStrategy = require('./postgres-auth-strategy');

// Configuración del negocio
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP; // Número del admin

let whatsappReady = false;
let qrGenerated = false;
let qrAttempts = 0;
const MAX_QR_ATTEMPTS = 5;
let sessionIsOld = false; // Bandera para sesiones >24h // Resetear a límite normal después de fix

// Variables para tracking de conexión (evitar dependencia circular)
let ultimaConexionExitosa = null;

// Callback para procesar notificaciones pendientes cuando WhatsApp se conecta
let onWhatsAppReadyCallback = null;
let lastCallbackExecution = 0;
const CALLBACK_DEBOUNCE_MS = 30000; // 30 segundos entre ejecuciones

// Función para configurar el callback
function setOnWhatsAppReadyCallback(callback) {
  onWhatsAppReadyCallback = callback;
}

// Función para marcar conexión exitosa (local para evitar dependencia circular)
function marcarConexionExitosa() {
  ultimaConexionExitosa = new Date();
  whatsappReady = true;
  console.log(`🎯 MARCA CONEXIÓN EXITOSA: ${ultimaConexionExitosa.toISOString()}`);
  console.log(`🎯 Estado whatsappReady: ${whatsappReady}`);
}

console.log('📱 Configurando WhatsApp Business... [v4 - Simplificado sin Instance Lock]');

// Verificar si tenemos conexión a PostgreSQL
const usePostgresAuth = !!(process.env.DATABASE_URL);
console.log(`🗄️ Estrategia de autenticación: ${usePostgresAuth ? 'PostgreSQL (Persistente)' : 'Local (Temporal)'}`);

// Configurar estrategia de autenticación
let authStrategy;
try {
  if (usePostgresAuth) {
    console.log('🔐 Configurando autenticación PostgreSQL...');
    authStrategy = new PostgresAuthStrategy({
      clientId: 'capri-store-main',
      dataPath: './temp-auth/'
    });
    console.log('✅ PostgresAuthStrategy creado exitosamente');
    // Resetear contador de QR para PostgreSQL
    qrAttempts = 0;
    console.log('🔄 Contador QR reseteado para PostgreSQL');
  } else {
    console.log('⚠️ No se encontró DATABASE_URL, usando autenticación local');
    const { LocalAuth } = require('whatsapp-web.js');
    const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : './.wwebjs_auth/';
    console.log(`📁 Usando directorio de autenticación: ${authPath}`);
    
    authStrategy = new LocalAuth({
      clientId: 'capri-store-session',
      dataPath: authPath
    });
    console.log('✅ LocalAuth creado exitosamente');
  }
} catch (authError) {
  console.error('❌ ERROR creando AuthStrategy:', authError.message);
  console.log('🔄 Fallback a LocalAuth...');
  
  // Fallback a LocalAuth si PostgreSQL falla
  const { LocalAuth } = require('whatsapp-web.js');
  const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : './.wwebjs_auth/';
  console.log(`📁 Fallback - Usando directorio: ${authPath}`);
  
  authStrategy = new LocalAuth({
    clientId: 'capri-store-fallback',
    dataPath: authPath
  });
  console.log('✅ Fallback LocalAuth creado exitosamente');
}

console.log('🔧 Creando cliente WhatsApp...');

// Argumentos de Puppeteer para optimización de memoria
const puppeteerArgs = [
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
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-extensions',
  '--disable-plugins',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--disable-background-networking',
  '--memory-pressure-off',
  '--js-flags="--max-old-space-size=200"',  // Reducido de 256MB a 200MB
  '--max-memory-usage=200',  // Reducido de 256MB a 200MB
  '--aggressive-cache-discard',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  // NUEVAS optimizaciones agresivas de memoria
  '--disable-blink-features=AutomationControlled',
  '--disable-features=TranslateUI',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-mode',
  '--disable-compositor-threaded-scrollbar-scrolling',
  '--disable-hang-monitor',
  '--disable-prompt-on-repost',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-features=AudioServiceOutOfProcess',
  '--renderer-process-limit=1',  // Solo 1 proceso renderer
  '--max-unused-resource-memory-usage-percentage=25',  // Liberar memoria no usada
  '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const whatsappClient = new Client({
  authStrategy: authStrategy,
  puppeteer: {
    headless: true,
    args: puppeteerArgs,
    timeout: 60000,
    // Configuraciones adicionales para reducir memoria
    executablePath: undefined,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  // Configuraciones adicionales para optimizar memoria
  qrMaxRetries: 3,  // Limitar reintentos de QR
  authTimeoutMs: 60000,  // Timeout de auth a 60s
  takeoverOnConflict: true,  // Tomar control si hay otra sesión activa
  takeoverTimeoutMs: 60000  // Timeout para takeover
});

console.log('✅ Cliente WhatsApp creado exitosamente');

// Eventos de WhatsApp
whatsappClient.on('qr', (qr) => {
  qrAttempts++;
  
  if (qrAttempts > MAX_QR_ATTEMPTS) {
    console.error(`\n❌ DEMASIADOS INTENTOS DE QR (${qrAttempts}/${MAX_QR_ATTEMPTS})`);
    console.error('🛑 DETENIENDO PARA EVITAR CONSUMO EXCESIVO DE MEMORIA');
    console.error('💡 Solución: Reinicia el servidor o usa /whatsapp-clean-session\n');
    return;
  }
  
  if (qrGenerated) {
    console.log(`\n⚠️ QR anterior expiró, generando nuevo código (intento ${qrAttempts}/${MAX_QR_ATTEMPTS})...\n`);
  }
  
  const authType = usePostgresAuth ? 'PostgreSQL (se guardará permanentemente)' : 'Local (temporal)';
  console.log(`\n🔐 Autenticación: ${authType}\n`);
  
  console.log('\n🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
  console.log(`📱 ¡CÓDIGO QR PARA WHATSAPP BUSINESS! (${qrAttempts}/${MAX_QR_ATTEMPTS}) 📱`);
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

// Eventos para autenticación remota (PostgreSQL)
if (usePostgresAuth) {
  console.log('🔄 Configurando eventos de PostgreSQL RemoteAuth...');
  
  whatsappClient.on('remote_session_saved', () => {
    console.log('💾 ✅ Sesión guardada en PostgreSQL exitosamente');
    console.log('🕐 Timestamp:', new Date().toISOString());
    
    // Forzar limpieza de memoria después de guardar sesión
    if (global.gc) {
      console.log('🧹 Ejecutando garbage collection después de guardar sesión...');
      global.gc();
    }
  });
  
  whatsappClient.on('remote_session_loaded', () => {
    console.log('📥 ✅ Sesión cargada desde PostgreSQL exitosamente');
    console.log('🕐 Timestamp:', new Date().toISOString());
    console.log('🔄 Intentando reconectar automáticamente...');
    
    // Forzar limpieza de memoria después de cargar sesión
    if (global.gc) {
      console.log('🧹 Ejecutando garbage collection después de cargar sesión...');
      global.gc();
    }
  });
  
  // Eventos adicionales de RemoteAuth
  whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ Fallo de autenticación RemoteAuth:', msg);
  });
  
  // Verificar al inicializar si hay sesión guardada
  console.log('🔍 Verificando sesión existente en PostgreSQL al inicializar...');
  
  // DIAGNÓSTICO Y AUTO-INICIALIZACIÓN: Verificar si hay sesión y conectar automáticamente
  (async function diagnosticarYConectarSesion() {
    try {
      console.log('🔍 DIAGNÓSTICO: Verificando existencia de sesión inicial en PostgreSQL...');
      const sessionExists = await authStrategy.store.sessionExists();
      console.log('📊 DIAGNÓSTICO: Sesión existente al iniciar:', sessionExists ? '✅ SÍ' : '❌ NO');
      
      if (sessionExists) {
        console.log('🎉 ¡Hay sesión guardada! Verificando vigencia...');
        
        // Verificar fecha de la sesión
        try {
          const sessionInfo = await authStrategy.store.pool.query(
            'SELECT updated_at, created_at FROM whatsapp_sessions WHERE id = $1',
            [authStrategy.store.clientId]
          );
          
          if (sessionInfo.rows.length > 0) {
            const lastUpdate = new Date(sessionInfo.rows[0].updated_at || sessionInfo.rows[0].created_at);
            const now = new Date();
            const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);
            
            console.log(`📅 Última actualización de sesión: ${lastUpdate.toISOString()}`);
            console.log(`⏰ Horas transcurridas: ${Math.round(hoursSinceUpdate)}h`);
            
            // Si la sesión tiene más de 7 días, no inicializar - probablemente expiró
            if (hoursSinceUpdate > 168) { // 7 días
              console.log('\n❌ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('❌ SESIÓN EXPIRADA (>7 días)');
              console.log('❌ NO se inicializará WhatsApp automáticamente');
              console.log('💡 SOLUCIÓN: Regenerar QR con:');
              console.log('   GET https://capri-store.onrender.com/whatsapp-regenerar-qr');
              console.log('   PowerShell: Invoke-RestMethod -Uri "https://capri-store.onrender.com/whatsapp-regenerar-qr" -Method GET');
              console.log('❌ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
              return; // No continuar con la inicialización
            } else if (hoursSinceUpdate > 24) { // Más de 1 día pero menos de 7
              console.log('\n⚠️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('⚠️ SESIÓN ANTIGUA (>24h)');
              console.log('⚠️ Se intentará conectar pero puede fallar');
              console.log('💡 Si falla, regenera QR con:');
              console.log('   GET https://capri-store.onrender.com/whatsapp-regenerar-qr');
              console.log('⚠️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
              sessionIsOld = true; // Marcar sesión antigua para timeout reducido
            } else {
              console.log('✅ Sesión reciente (<24h) - Inicializando automáticamente...');
              sessionIsOld = false;
            }
          }
        } catch (dateError) {
          console.warn('⚠️ No se pudo verificar fecha de sesión:', dateError.message);
        }
        
        // Extraer información de la sesión
        try {
          console.log('🔍 DIAGNÓSTICO: Intentando extraer sesión...');
          const sessionData = await authStrategy.store.extract();
          console.log('📊 DIAGNÓSTICO: Datos de sesión obtenidos:', !!sessionData);
          console.log('📊 DIAGNÓSTICO: Tipo de dato:', typeof sessionData);
          if (sessionData) {
            const size = JSON.stringify(sessionData).length;
            console.log('📊 DIAGNÓSTICO: Tamaño de datos:', size, 'chars');
            
            if (size > 5000) {
              console.log('✅ Sesión válida encontrada - Inicializando WhatsApp...');
              
              // Inicializar WhatsApp automáticamente
              await whatsappClient.initialize();
              console.log('🔄 WhatsApp inicializado - Esperando conexión automática con sesión guardada');
            } else {
              console.warn('⚠️ Sesión guardada pero muy pequeña - puede estar corrupta');
              console.log('💡 Usa /whatsapp-regenerar-qr para generar nuevo QR');
            }
          }
        } catch (extractError) {
          console.error('❌ Error extrayendo sesión:', extractError.message);
          console.log('💡 Usa /whatsapp-regenerar-qr para generar nuevo QR');
        }
      } else {
        console.log('⚠️ No hay sesión previa guardada');
        console.log('💡 Usa /whatsapp-regenerar-qr cuando necesites generar QR');
      }
    } catch (error) {
      console.error('❌ DIAGNÓSTICO: Error en verificación manual:', error.message);
    }
  })();
  
} else {
  console.log('ℹ️ Usando LocalAuth - No hay eventos de sesión remota');
}

whatsappClient.on('ready', async () => {
  const timestamp = new Date().toLocaleString('es-AR');
  console.log('🎉 EVENTO READY DISPARADO - WhatsApp completamente listo');
  whatsappReady = true;
  
  // Marcar conexión exitosa para verificación de disponibilidad
  console.log('🎯 PRINCIPAL: Marcando conexión desde evento ready');
  marcarConexionExitosa();
  
  // Procesar notificaciones pendientes en background (con debounce)
  if (onWhatsAppReadyCallback) {
    const now = Date.now();
    if (now - lastCallbackExecution > CALLBACK_DEBOUNCE_MS) {
      lastCallbackExecution = now;
      console.log('🔄 Ejecutando callback para notificaciones pendientes...');
      setImmediate(() => {
        try {
          onWhatsAppReadyCallback();
        } catch (error) {
          console.error('❌ Error en callback de notificaciones pendientes:', error);
        }
      });
    } else {
      console.log('⏳ Callback omitido - ejecutado recientemente (debounce)');
    }
  }
  
  // Verificar estado real
  try {
    const state = await whatsappClient.getState();
    const authInfo = usePostgresAuth ? 'PostgreSQL (Persistente)' : 'Local (Temporal)';
    
    console.log('\n🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
    console.log(`✅ WHATSAPP BUSINESS CONECTADO! [${timestamp}]`);
    console.log(`📱 Negocio: ${BUSINESS_NAME}`);
    console.log(`📞 Admin: ${ADMIN_WHATSAPP}`);
    console.log(`🔗 Estado del cliente: ${state}`);
    console.log(`🗄️ Autenticación: ${authInfo}`);
    console.log('🛍️ ¡Los clientes ya pueden contactarte por WhatsApp!');
    console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
    
    if (usePostgresAuth) {
      console.log('✅ SESIÓN PERSISTENTE ACTIVADA - No necesitarás escanear QR en próximos deploys');
      console.log('⏰ RemoteAuth guarda automáticamente cada 2 minutos después del primer guardado');
      console.log('� IMPORTANTE: La sesión se guarda ~2 minutos después de la conexión exitosa');
      console.log('🔄 Próximos reinicios recuperarán esta sesión sin QR');
      
      // Programar verificación de sesión después de 130 segundos (después del guardado automático)
      setTimeout(async () => {
        try {
          console.log('\n⏰ === VERIFICACIÓN POST-GUARDADO (después de 130 seg) ===');
          const exists = await authStrategy.store.sessionExists();
          if (exists) {
            console.log('✅ ¡SESIÓN GUARDADA EXITOSAMENTE EN POSTGRESQL!');
            const sessionData = await authStrategy.store.extract({});
            if (sessionData) {
              const size = sessionData.length;
              console.log(`📊 Tamaño de sesión: ${size} chars`);
              if (size > 5000) {
                console.log('✅✅✅ SESIÓN COMPLETA Y VÁLIDA (>5000 chars)');
                console.log('🎉 Próximo deploy NO necesitará QR!');
              } else {
                console.warn(`⚠️ Sesión guardada pero pequeña (${size} chars)`);
              }
            }
          } else {
            console.warn('⚠️ Sesión aún no guardada - Revisar configuración PostgreSQL');
          }
          console.log('⏰ ======================================\n');
        } catch (error) {
          console.error('❌ Error verificando sesión:', error.message);
        }
      }, 130000); // 130 segundos = 2 min 10 seg
    }
    
    // En Render, programar verificación periódica y limpieza de memoria
    if (process.env.RENDER) {
      console.log('🔄 Render detectado - Programando verificaciones cada 10 min y limpieza de memoria cada 15 min');
      
      // Verificación de estado cada 10 minutos
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
      }, 10 * 60 * 1000);
      
      // Limpieza de memoria agresiva cada 15 minutos
      setInterval(() => {
        try {
          console.log('🧹 Iniciando limpieza de memoria...');
          
          // Forzar garbage collection si está disponible
          if (global.gc) {
            global.gc();
            console.log('✅ Garbage collection ejecutado');
          }
          
          // Log de uso de memoria
          const memUsage = process.memoryUsage();
          const mbUsed = Math.round(memUsage.heapUsed / 1024 / 1024);
          const mbTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
          const mbRss = Math.round(memUsage.rss / 1024 / 1024);
          console.log(`📊 Memoria: ${mbUsed}MB heap de ${mbTotal}MB total, ${mbRss}MB RSS`);
          
          // Si la memoria está muy alta (>200MB), alertar
          if (mbUsed > 200) {
            console.warn(`⚠️ MEMORIA ALTA: ${mbUsed}MB - Cerca del límite de Render (512MB)`);
          }
          
        } catch (error) {
          console.error('❌ Error en limpieza de memoria:', error.message);
        }
      }, 15 * 60 * 1000); // 15 minutos
    }
    
  } catch (error) {
    console.log(`✅ WhatsApp conectado pero error obteniendo estado: ${error.message}`);
  }
});

whatsappClient.on('authenticated', () => {
  console.log('🔐 WhatsApp autenticado correctamente');
  
  // FALLBACK: Marcar conexión exitosa aquí también por si 'ready' no se dispara
  console.log('🎯 FALLBACK: Marcando conexión desde evento authenticated');
  marcarConexionExitosa();
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
    // Si la sesión fue invalidada, no intentar reconexión automática
    return;
  }
  
  // Si es por QR timeout, no hacer reconexión automática inmediata
  if (reason === 'Max qrcode retries reached') {
    console.log(`[${timestamp}] ⚠️ QR timeout - Esperando intervención manual o keep-alive`);
    console.log(`[${timestamp}] 💡 El sistema keep-alive detectará esto y generará nuevo QR`);
    return;
  }
  
  // Reconexión automática solo para otros casos después de 30 segundos
  console.log(`[${timestamp}] 🔄 Programando reconexión automática en 30 segundos...`);
  setTimeout(async () => {
    try {
      console.log(`[${new Date().toISOString()}] 🔄 Intentando reconexión automática...`);
      
      // Verificar sesión según el tipo de autenticación
      let sessionExists = false;
      
      if (usePostgresAuth && authStrategy && authStrategy.store) {
        // Verificar sesión en PostgreSQL
        console.log(`[${new Date().toISOString()}] 🔍 Verificando sesión en PostgreSQL...`);
        try {
          sessionExists = await authStrategy.store.sessionExists();
          console.log(`[${new Date().toISOString()}] 📊 Sesión en PostgreSQL: ${sessionExists ? 'EXISTE' : 'NO EXISTE'}`);
        } catch (sessionError) {
          console.error(`[${new Date().toISOString()}] ❌ Error verificando sesión PostgreSQL:`, sessionError.message);
          sessionExists = false;
        }
      } else {
        // Verificar carpeta local (LocalAuth)
        const fs = require('fs');
        const path = require('path');
        const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : path.join(__dirname, '..', '.wwebjs_auth');
        sessionExists = fs.existsSync(authPath);
        console.log(`[${new Date().toISOString()}] 📊 Carpeta local: ${sessionExists ? 'EXISTE' : 'NO EXISTE'}`);
      }
      
      if (sessionExists) {
        console.log(`[${new Date().toISOString()}] ✅ Sesión guardada existe, intentando reconectar...`);
        await whatsappClient.initialize();
        console.log(`[${new Date().toISOString()}] 🔄 Reinicialización completada`);
      } else {
        console.log(`[${new Date().toISOString()}] ❌ No hay sesión guardada, se necesitará QR`);
        console.log(`[${new Date().toISOString()}] 💡 Reinicia manualmente el servidor para generar nuevo QR`);
      }
    } catch (reconnectError) {
      console.error(`[${new Date().toISOString()}] ❌ Error en reconexión automática:`, reconnectError.message);
    }
  }, 30000);
});

whatsappClient.on('loading_screen', (percent, message) => {
  console.log('📱 Cargando WhatsApp:', percent + '%', message);
});

// Cleanup al cerrar el proceso
process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM recibido - Cerrando gracefully...');
  await cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT recibido - Cerrando gracefully...');
  await cleanup();
  process.exit(0);
});

async function cleanup() {
  console.log('🧹 Iniciando cleanup...');
  
  whatsappReady = false;
  
  try {
    if (whatsappClient) {
      await whatsappClient.destroy();
      console.log('✅ WhatsApp cerrado');
    }
  } catch (error) {
    console.error('⚠️ Error cerrando WhatsApp:', error.message);
  }
  
  console.log('✅ Cleanup completado');
}

// ===============================
// FUNCIÓN DE INICIALIZACIÓN SIMPLIFICADA
// ===============================

// Función para inicializar WhatsApp (simplificada sin Instance Lock)
async function inicializarWhatsApp() {
  try {
    // VALIDACIÓN PREVIA: Verificar si WhatsApp ya está conectado
    if (whatsappReady && whatsappClient) {
      try {
        const state = await whatsappClient.getState();
        if (state === 'CONNECTED') {
          console.log('✅ WhatsApp ya está conectado - Saltando inicialización');
          console.log(`🔗 Estado actual: ${state}`);
          return;
        }
      } catch (stateError) {
        console.log('⚠️ Error verificando estado, continuando con inicialización:', stateError.message);
      }
    }
    
    // VALIDACIÓN DE CONTEXTO: Verificar que no hay errores de contexto destruido previos
    if (whatsappClient && whatsappClient._page) {
      try {
        // Test simple para verificar que el contexto está vivo
        await whatsappClient._page.evaluate(() => window.location.href);
      } catch (contextError) {
        if (contextError.message.includes('Execution context was destroyed')) {
          console.log('⚠️ Contexto de ejecución previamente destruido - Requiere sesión fresca');
          throw new Error('Contexto de ejecución destruido - Sesión incompatible');
        }
      }
    }
    
    console.log('🚀 Inicializando WhatsApp Business...');
    
    console.log('📱 Inicializando cliente WhatsApp con PostgreSQL session persistence...');
    await whatsappClient.initialize();
    
    console.log('✅ WhatsApp Business inicializado correctamente');
    
  } catch (error) {
    console.error('❌ Error inicializando WhatsApp:', error);
    
    // Detectar errores específicos de sesión expirada/corrupta
    const isContextError = error.message && error.message.includes('Execution context was destroyed');
    const isSessionError = error.message && (
      error.message.includes('Protocol error') ||
      error.message.includes('Target closed') ||
      error.message.includes('Session closed') ||
      error.message.includes('Invalid session') ||
      error.message.includes('Authentication failed')
    );
    
    if (isContextError && usePostgresAuth) {
      console.log('⚠️ DETECTADO: Error de contexto destruido (NO es sesión corrupta)');
      console.log('🔄 La sesión en PostgreSQL es válida - Solo reiniciando cliente...');
      console.log('💡 Este error es normal en reinicios de Render');
      
      // NO limpiar la sesión - solo reinicializar con nueva instancia
      console.log('🔄 Reinicializando con sesión existente...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      try {
        // Crear nueva instancia del cliente pero mantener la sesión
        console.log('🔄 Creando nueva instancia del cliente WhatsApp...');
        await whatsappClient.initialize();
        console.log('✅ WhatsApp reinicializado exitosamente - Sesión conservada');
        return;
      } catch (retryError) {
        console.error('❌ Error en segundo intento:', retryError.message);
        // Si falla el retry, entonces sí podría ser sesión corrupta
        console.log('🔄 Segundo intento falló - Ahora sí limpiando sesión...');
      }
    }
    
    if (isSessionError && usePostgresAuth) {
      console.log('🔄 DETECTADO: Error de sesión genuinamente corrupta');
      console.log('🧹 Intentando limpiar sesión automáticamente...');
      
      try {
        // Limpiar sesión de PostgreSQL automáticamente
        if (authStrategy && authStrategy.logout) {
          await authStrategy.logout();
          console.log('✅ Sesión PostgreSQL limpiada automáticamente');
          
          // Esperar 3 segundos y reintentar inicialización
          console.log('⏳ Esperando 3 segundos antes de reintentar...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          console.log('🔄 Reintentando inicialización con sesión limpia...');
          await whatsappClient.initialize();
          
          console.log('✅ WhatsApp reinicializado exitosamente - Se generará nuevo QR');
          return;
        }
      } catch (retryError) {
        console.error('❌ Error en reintento de inicialización:', retryError.message);
      }
    }
    
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
    
    // Verificar si el cliente está inicializado
    if (!whatsappClient) {
      console.log(`[DEBUG] Cliente WhatsApp no inicializado (lazy loading)`);
      console.log(`\n⚠️ ════════════════════════════════════════════════════════════════════════════`);
      console.log(`⚠️  WHATSAPP NO ESTÁ CONECTADO - Cliente no inicializado (lazy loading)`);
      console.log(`⚠️ ════════════════════════════════════════════════════════════════════════════`);
      console.log(`📱 Para inicializar WhatsApp y generar un nuevo código QR, ejecuta:`);
      console.log(``);
      console.log(`   🌐 CURL:`);
      console.log(`   curl https://capri-store.onrender.com/whatsapp-regenerar-qr`);
      console.log(``);
      console.log(`   💻 POWERSHELL:`);
      console.log(`   Invoke-RestMethod -Uri "https://capri-store.onrender.com/whatsapp-regenerar-qr" -Method GET`);
      console.log(``);
      console.log(`⚠️ ════════════════════════════════════════════════════════════════════════════\n`);
      return {
        whatsappReady: false,
        clientState: 'NOT_INITIALIZED',
        isReady: false,
        hasStateError: false,
        serviceReady: false,
        ultimaConexionFromService: ultimaConexionExitosa ? ultimaConexionExitosa.toISOString() : 'null'
      };
    }
    
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
      console.log(`📱 ⚠️ WhatsApp con ERROR - Para reconectar use:`);
      console.log(`   🔗 GET https://capri-store.onrender.com/whatsapp-regenerar-qr`);
    }
    
    const isReady = whatsappReady && clientState === 'CONNECTED';
    
    console.log(`[DEBUG] Estado calculado:`, {
      whatsappReady,
      clientState,
      isReady,
      hasStateError: !!stateError
    });
    
    // Mostrar instrucciones si no está listo
    if (!isReady) {
      console.log(`\n⚠️ ═══════════════════════════════════════════════════════════════`);
      console.log(`⚠️  WHATSAPP NO ESTÁ CONECTADO`);
      console.log(`⚠️  Estado: ${clientState || 'DESCONOCIDO'}`);
      console.log(`⚠️  Ready flag: ${whatsappReady}`);
      console.log(`⚠️ ═══════════════════════════════════════════════════════════════`);
      console.log(`📱 Para generar un nuevo código QR, ejecuta:`);
      console.log(``);
      console.log(`   curl https://capri-store.onrender.com/whatsapp-regenerar-qr`);
      console.log(``);
      console.log(`   O desde PowerShell:`);
      console.log(``);
      console.log(`   Invoke-RestMethod -Uri "https://capri-store.onrender.com/whatsapp-regenerar-qr" -Method GET`);
      console.log(``);
      console.log(`⚠️ ═══════════════════════════════════════════════════════════════\n`);
    }
    
    // Mostrar instrucciones si no está listo
    if (!isReady) {
      console.log(`\n⚠️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`⚠️  WHATSAPP NO ESTÁ CONECTADO`);
      console.log(`⚠️  Estado: ${clientState || 'DESCONOCIDO'}`);
      console.log(`⚠️  Ready flag: ${whatsappReady}`);
      console.log(`⚠️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📱 Para generar un nuevo código QR, ejecuta:`);
      console.log(``);
      console.log(`   curl https://capri-store.onrender.com/whatsapp-regenerar-qr`);
      console.log(``);
      console.log(`   O desde PowerShell:`);
      console.log(``);
      console.log(`   Invoke-RestMethod -Uri "https://capri-store.onrender.com/whatsapp-regenerar-qr" -Method GET`);
      console.log(``);
      console.log(`⚠️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }
    
    // Si no está listo, mostrar cómo regenerar QR
    if (!isReady && clientState !== 'CONNECTED') {
      console.log(`📱 ℹ️ WhatsApp NO READY (${clientState || 'UNKNOWN'}) - Para regenerar QR:`);
      console.log(`   🔗 GET https://capri-store.onrender.com/whatsapp-regenerar-qr`);
    }
    
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
    
    // Si usamos PostgreSQL, limpiar la sesión de la base de datos
    if (usePostgresAuth && authStrategy && authStrategy.logout) {
      console.log(`[${timestamp}] 🗄️ Eliminando sesión de PostgreSQL...`);
      try {
        await authStrategy.logout();
        console.log(`[${timestamp}] ✅ Sesión eliminada de PostgreSQL`);
      } catch (dbError) {
        console.error(`[${timestamp}] ❌ Error eliminando sesión de PostgreSQL:`, dbError.message);
      }
    }
    
    // Eliminar carpeta de autenticación local (por si acaso)
    const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : path.join(__dirname, '..', '.wwebjs_auth');
    
    if (fs.existsSync(authPath)) {
      console.log(`[${timestamp}] 🗑️ Eliminando carpeta de autenticación local...`);
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log(`[${timestamp}] ✅ Carpeta local eliminada`);
    }
    
    // Esperar un poco y reinicializar
    console.log(`[${timestamp}] ⏳ Esperando 5 segundos antes de reinicializar...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log(`[${timestamp}] 🚀 Reinicializando con sesión limpia...`);
    await whatsappClient.initialize();
    
    const cleanType = usePostgresAuth ? 'PostgreSQL y local' : 'local';
    return {
      success: true,
      message: `Sesión limpiada (${cleanType}) y reinicializada - Se necesitará escanear QR`,
      timestamp
    };
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ ERROR limpiando sesión:`, error.message);
    return {
      success: false,
      error: error.message,
      timestamp
    };
  }
}

// Función específica para limpiar solo PostgreSQL
async function limpiarSesionPostgreSQL() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🗄️ LIMPIANDO SOLO SESIÓN DE POSTGRESQL...`);
  
  if (!usePostgresAuth) {
    return {
      success: false,
      error: 'No se está usando autenticación PostgreSQL',
      timestamp
    };
  }
  
  try {
    if (authStrategy && authStrategy.logout) {
      await authStrategy.logout();
      console.log(`[${timestamp}] ✅ Sesión eliminada de PostgreSQL exitosamente`);
      
      return {
        success: true,
        message: 'Sesión eliminada de PostgreSQL - Reinicia el servidor para reconectar',
        timestamp
      };
    } else {
      return {
        success: false,
        error: 'AuthStrategy no disponible',
        timestamp
      };
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ ERROR limpiando PostgreSQL:`, error.message);
    return {
      success: false,
      error: error.message,
      timestamp
    };
  }
}

// Función para resetear contador QR
function resetearContadorQR() {
  const anteriorQrAttempts = qrAttempts;
  qrAttempts = 0;
  console.log(`🔄 Contador QR reseteado: ${anteriorQrAttempts} -> 0`);
  return { success: true, anterior: anteriorQrAttempts, actual: 0 };
}

// Función para sincronizar flag de estado con estado real del cliente
async function sincronizarEstadoWhatsApp() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔄 Sincronizando estado de WhatsApp...`);
  
  try {
    if (!whatsappClient) {
      console.log(`[${timestamp}] ❌ Cliente WhatsApp no disponible`);
      return { success: false, error: 'Cliente no disponible' };
    }
    
    // Obtener estado real del cliente
    const state = await whatsappClient.getState();
    const isConnected = state === 'CONNECTED';
    const flagAnterior = whatsappReady;
    
    console.log(`[${timestamp}] 📊 Estado real cliente: ${state}`);
    console.log(`[${timestamp}] 📊 Flag anterior: ${flagAnterior}`);
    console.log(`[${timestamp}] 📊 ¿Debería estar ready?: ${isConnected}`);
    
    // Actualizar flag si es necesario
    if (isConnected && !whatsappReady) {
      whatsappReady = true;
      console.log(`[${timestamp}] ✅ Flag actualizado: false -> true`);
      
      // Disparar lógica de conexión exitosa
      try {
        const info = await whatsappClient.info;
        console.log(`[${timestamp}] 📱 Información del cliente sincronizada: ${info?.wid?.user || 'N/A'}`);
      } catch (err) {
        console.log(`[${timestamp}] ⚠️ Error obteniendo info del cliente: ${err.message}`);
      }
      
      return { 
        success: true, 
        action: 'flag_updated',
        previous: flagAnterior,
        current: whatsappReady,
        state: state
      };
    } else if (!isConnected && whatsappReady) {
      whatsappReady = false;
      console.log(`[${timestamp}] ❌ Flag actualizado: true -> false`);
      
      return { 
        success: true, 
        action: 'flag_updated',
        previous: flagAnterior,
        current: whatsappReady,
        state: state
      };
    } else {
      console.log(`[${timestamp}] ℹ️ Flag ya está sincronizado`);
      return { 
        success: true, 
        action: 'no_change',
        current: whatsappReady,
        state: state
      };
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error sincronizando estado: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Función para forzar guardado inmediato de sesión PostgreSQL
async function forzarGuardadoSesion() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 💾 Forzando guardado inmediato de sesión...`);
  
  try {
    if (!whatsappClient) {
      return { success: false, error: 'Cliente WhatsApp no disponible' };
    }
    
    if (!usePostgresAuth) {
      return { success: false, error: 'PostgreSQL no está configurado' };
    }
    
    if (!authStrategy) {
      return { success: false, error: 'AuthStrategy no disponible' };
    }
    
    // Verificar que esté conectado
    const state = await whatsappClient.getState();
    if (state !== 'CONNECTED') {
      return { success: false, error: `WhatsApp no conectado. Estado: ${state}` };
    }
    
    console.log(`[${timestamp}] 🔄 RemoteAuth maneja el guardado automáticamente...`);
    
    try {
      // RemoteAuth ya guarda la sesión automáticamente cada 2 minutos
      // y cuando ocurren eventos importantes (authenticated, ready, etc.)
      // NO debemos interferir con el proceso automático guardando manualmente
      
      // Solo retornamos el estado actual
      console.log(`[${timestamp}] ℹ️ RemoteAuth guardará la sesión según su programación interna`);
      console.log(`[${timestamp}] ℹ️ Intervalo de guardado: cada 2 minutos`);
      console.log(`[${timestamp}] ℹ️ La sesión se guarda automáticamente en eventos: authenticated, ready, change_state`);
      
      return { 
        success: true, 
        message: 'RemoteAuth maneja el guardado automáticamente',
        note: 'No se requiere guardado manual - RemoteAuth lo gestiona',
        client_id: authStrategy?.clientId || 'unknown',
        state: state
      };
      
    } catch (error) {
      console.error(`[${timestamp}] ❌ Error en forzarGuardadoSesion: ${error.message}`);
      return { success: false, error: error.message };
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error forzando guardado de sesión: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Función para configurar eventos básicos del cliente WhatsApp
function configurarEventosBasicos() {
  // Evento QR
  whatsappClient.on('qr', (qr) => {
    qrAttempts++;
    
    if (qrAttempts > MAX_QR_ATTEMPTS) {
      console.error(`\n❌ DEMASIADOS INTENTOS DE QR (${qrAttempts}/${MAX_QR_ATTEMPTS})`);
      console.error('🛑 DETENIENDO PARA EVITAR CONSUMO EXCESIVO DE MEMORIA');
      console.error('💡 Solución: Reinicia el servidor o usa /whatsapp-clean-session\n');
      return;
    }
    
    if (qrGenerated) {
      console.log(`\n⚠️ QR anterior expiró, generando nuevo código (intento ${qrAttempts}/${MAX_QR_ATTEMPTS})...\n`);
    }
    
    const authType = usePostgresAuth ? 'PostgreSQL (se guardará permanentemente)' : 'Local (temporal)';
    console.log(`\n🔐 Autenticación: ${authType}\n`);
    
    console.log('\n🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
    console.log(`📱 ¡CÓDIGO QR PARA WHATSAPP BUSINESS! (${qrAttempts}/${MAX_QR_ATTEMPTS}) 📱`);
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

  // Evento ready
  whatsappClient.on('ready', async () => {
    whatsappReady = true;
    qrGenerated = false;
    qrAttempts = 0;
    ultimaConexion = new Date().toISOString();
    
    console.log('\n🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢');
    console.log('🚀 WHATSAPP BUSINESS CONECTADO EXITOSAMENTE 🚀');
    console.log('🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢\n');
    
    try {
      const info = whatsappClient.info;
      if (info) {
        console.log(`📱 WhatsApp conectado como: ${info.pushname || 'Sin nombre'}`);
        console.log(`📞 Número: ${info.wid.user || 'No disponible'}`);
        console.log(`🔋 Dispositivo: ${info.platform || 'Desconocido'}`);
      }
    } catch (infoError) {
      console.log('⚠️ No se pudo obtener información del dispositivo');
    }
    
    console.log(`⏰ Conectado a las: ${ultimaConexion}`);
    
    // Limpiar memoria después de la conexión exitosa
    limpiarMemoriaProactiva();
  });

  // Evento authenticated
  whatsappClient.on('authenticated', () => {
    console.log('🔐 WhatsApp autenticado correctamente');
  });

  // Evento auth_failure
  whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación WhatsApp:', msg);
    whatsappReady = false;
  });

  // Evento disconnected
  whatsappClient.on('disconnected', (reason) => {
    console.log(`🔌 WhatsApp desconectado. Razón: ${reason}`);
    whatsappReady = false;
    ultimaConexion = null;
  });

  // Evento loading_screen
  whatsappClient.on('loading_screen', (percent, message) => {
    console.log(`⏳ Cargando WhatsApp... ${percent}% - ${message}`);
  });

  // Eventos específicos para PostgreSQL
  if (usePostgresAuth) {
    whatsappClient.on('remote_session_saved', () => {
      console.log('💾 Sesión guardada en PostgreSQL exitosamente');
    });

    whatsappClient.on('remote_session_loaded', () => {
      console.log('📥 Sesión cargada desde PostgreSQL exitosamente');
    });
  }
}

// Función para limpieza completa (combina PostgreSQL + Local + Reinicialización)
async function limpiarSesionesCompleto() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🧹 LIMPIEZA COMPLETA DE SESIONES INICIADA...`);
  
  try {
    // Resetear flags
    whatsappReady = false;
    qrGenerated = false;
    qrAttempts = 0;
    
    console.log(`[${timestamp}] 1️⃣ Limpiando sesión PostgreSQL...`);
    if (usePostgresAuth && authStrategy) {
      try {
        // Usar clearSessionOnly en lugar de logout para no cerrar el pool
        if (authStrategy.clearSessionOnly) {
          await authStrategy.clearSessionOnly();
        } else if (authStrategy.logout) {
          await authStrategy.logout();
        }
        console.log(`[${timestamp}] ✅ PostgreSQL limpiado`);
      } catch (dbError) {
        console.error(`[${timestamp}] ❌ Error limpiando PostgreSQL: ${dbError.message}`);
      }
    }
    
    console.log(`[${timestamp}] 2️⃣ Destruyendo cliente...`);
    try {
      await whatsappClient.destroy();
    } catch (destroyError) {
      console.log(`[${timestamp}] ⚠️ Error destruyendo cliente: ${destroyError.message}`);
    }
    
    console.log(`[${timestamp}] 3️⃣ Limpiando carpeta local...`);
    const fs = require('fs');
    const path = require('path');
    const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : path.join(__dirname, '..', '.wwebjs_auth');
    
    if (fs.existsSync(authPath)) {
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log(`[${timestamp}] ✅ Carpeta local eliminada`);
      } catch (fsError) {
        console.error(`[${timestamp}] ❌ Error eliminando carpeta: ${fsError.message}`);
      }
    }
    
    console.log(`[${timestamp}] 4️⃣ Esperando 5 segundos...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log(`[${timestamp}] 5️⃣ Reinicializando cliente...`);
    
    // El cliente WhatsApp ya fue destruido, ahora lo reinicializamos
    // Esto forzará la generación de un nuevo QR
    await whatsappClient.initialize();
    
    console.log(`[${timestamp}] ✅ Limpieza completa exitosa - QR se generará automáticamente`);
    
    return {
      success: true,
      message: 'Limpieza completa exitosa - Se generará nuevo QR automáticamente',
      actions_completed: [
        'Cliente destruido',
        'PostgreSQL limpiado',
        'Carpeta local eliminada',
        'Cliente reinicializado'
      ],
      timestamp
    };
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ ERROR en limpieza completa: ${error.message}`);
    return {
      success: false,
      error: error.message,
      timestamp
    };
  }
}

// Función de limpieza proactiva de memoria
function limpiarMemoriaProactiva() {
  const timestamp = new Date().toISOString();
  
  try {
    // Obtener uso de memoria antes
    const memBefore = process.memoryUsage();
    const usedMB = Math.round(memBefore.heapUsed / 1024 / 1024);
    
    console.log(`[${timestamp}] 🧹 Limpieza proactiva de memoria iniciada - Uso actual: ${usedMB}MB`);
    
    // Forzar garbage collection si está disponible
    if (global.gc) {
      global.gc();
      
      // Obtener uso después
      const memAfter = process.memoryUsage();
      const usedAfterMB = Math.round(memAfter.heapUsed / 1024 / 1024);
      const liberadoMB = usedMB - usedAfterMB;
      
      console.log(`[${timestamp}] ✅ Memoria liberada: ${liberadoMB}MB (${usedAfterMB}MB restante)`);
    } else {
      console.log(`[${timestamp}] ⚠️ Garbage collection no disponible (use --expose-gc)`);
    }
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en limpieza de memoria:`, error.message);
  }
}

// Configurar limpieza periódica de memoria (cada 10 minutos)
if (process.env.RENDER) {
  console.log('🧹 Configurando limpieza automática de memoria para Render...');
  setInterval(() => {
    limpiarMemoriaProactiva();
  }, 10 * 60 * 1000); // 10 minutos
}

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
  sessionIsOld, // Para ajustar timeout según antigüedad de sesión
  ADMIN_WHATSAPP,
  BUSINESS_NAME,
  cleanup
};
