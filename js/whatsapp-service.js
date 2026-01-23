const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Obtener el ejecutable de Chrome/Chromium (desde puppeteer o sistema)
let chromiumPath;

function findChromiumExecutable() {
  const possiblePaths = [];
  
  // 1. Intentar obtener de puppeteer
  try {
    const puppeteer = require('puppeteer');
    const execPath = puppeteer.executablePath();
    possiblePaths.push(execPath);
    
    // Verificar si el archivo existe
    if (fs.existsSync(execPath)) {
      console.log(`✅ Chromium de Puppeteer encontrado: ${execPath}`);
      return execPath;
    } else {
      console.warn(`⚠️ Puppeteer retornó path pero no existe: ${execPath}`);
    }
  } catch (error) {
    console.warn(`⚠️ No se pudo obtener executablePath de puppeteer: ${error.message}`);
  }
  
  // 2. Buscar en cache de puppeteer manualmente
  const cacheDir = path.join(__dirname, '..', '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(cacheDir)) {
    console.log(`🔍 Buscando Chrome en cache: ${cacheDir}`);
    try {
      const versions = fs.readdirSync(cacheDir);
      if (versions.length > 0) {
        // Usar la versión más reciente
        const latestVersion = versions.sort().reverse()[0];
        const chromePath = path.join(cacheDir, latestVersion, 'chrome-linux64', 'chrome');
        if (fs.existsSync(chromePath)) {
          console.log(`✅ Chrome encontrado en cache: ${chromePath}`);
          return chromePath;
        }
      }
    } catch (err) {
      console.warn(`⚠️ Error explorando cache: ${err.message}`);
    }
  }
  
  // 3. Paths del sistema (Linux)
  const os = require('os');
  if (os.platform() === 'linux') {
    const systemPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    
    for (const sysPath of systemPaths) {
      if (sysPath && fs.existsSync(sysPath)) {
        console.log(`✅ Chrome del sistema encontrado: ${sysPath}`);
        return sysPath;
      }
    }
  }
  
  console.error('❌ No se encontró ningún ejecutable de Chrome/Chromium');
  console.error('📋 Paths verificados:', possiblePaths);
  return null;
}

chromiumPath = findChromiumExecutable();

if (!chromiumPath) {
  console.error('');
  console.error('🚨 ERROR CRÍTICO: No se puede inicializar WhatsApp sin Chrome');
  console.error('');
  console.error('Soluciones posibles:');
  console.error('1. Asegúrate que el Build Command incluya: npx puppeteer browsers install chrome');
  console.error('2. Verifica que puppeteer esté en package.json');
  console.error('3. En Render, revisa los logs del build para errores de descarga');
  console.error('');
}


// Configuración del negocio
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP; // Número del admin

let whatsappReady = false;
let qrGenerated = false;
let qrAttempts = 0;
const MAX_QR_ATTEMPTS = 5;
let sessionIsOld = false; // Bandera para sesiones >24h
let isConnecting = false; // 🔒 Flag para bloquear otros procesos durante conexión
let readyEventCount = 0; // 🔍 Contador para detectar eventos ready duplicados

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

// Función para forzar el estado de whatsappReady (útil para correcciones automáticas)
function setWhatsAppReady(value) {
  whatsappReady = value;
  console.log(`🔧 FORZADO whatsappReady = ${whatsappReady}`);
  return whatsappReady;
}

// 🔒 Funciones para gestionar el estado de conexión
function setIsConnecting(value) {
  isConnecting = value;
  console.log(`🔒 Estado isConnecting establecido a: ${value}`);
}

function getIsConnecting() {
  return isConnecting;
}



console.log('📱 Configurando WhatsApp Business... [v4 - Simplificado sin Instance Lock]');




const { LocalAuth } = require('whatsapp-web.js');
const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : './.wwebjs_auth/';

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

// Cambiar a let para permitir recreación del cliente en regeneración de QR
let whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: 'capri-store-session',
    dataPath: authPath
  }),
  puppeteer: {
    headless: true,
    args: puppeteerArgs,
    timeout: 180000, // ⏰ 3 minutos - Render Free necesita más tiempo
    executablePath: chromiumPath, // Usar el path detectado
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  qrMaxRetries: 3,
  authTimeoutMs: 180000, // ⏰ 3 minutos para autenticación en Render Free
  takeoverOnConflict: true,
  takeoverTimeoutMs: 120000 // ⏰ 2 minutos para takeover
});

// ===============================
// FUNCIÓN PARA REGISTRAR EVENTOS
// ===============================
// Esta función registra todos los eventos del cliente WhatsApp
// Se llama al crear el cliente inicial y cuando se recrea
function registrarEventosWhatsApp(client) {
  console.log('🔧 Registrando eventos de WhatsApp en el cliente...');
  
  // IMPORTANTE: Remover listeners antiguos para evitar duplicados
  console.log('🧹 Removiendo listeners antiguos para evitar duplicados...');
  client.removeAllListeners('qr');
  client.removeAllListeners('ready');
  client.removeAllListeners('authenticated');
  client.removeAllListeners('auth_failure');
  client.removeAllListeners('disconnected');
  client.removeAllListeners('loading_screen');
  console.log('✅ Listeners antiguos removidos');
  
  // 🔒 Evento QR - MARCAR INICIO DE PROCESO DE CONEXIÓN
  client.on('qr', (qr) => {
    setIsConnecting(true); // 🔒 Bloquear otros procesos durante conexión
    qrAttempts++;
    
    if (qrAttempts > MAX_QR_ATTEMPTS) {
      console.error(`\n${'='.repeat(70)}`);
      console.error(`❌ LÍMITE DE QRs ALCANZADO (${qrAttempts}/${MAX_QR_ATTEMPTS})`);
      console.error(`${'='.repeat(70)}`);
      console.error('🛑 Se detuvo la generación de QRs para evitar bucle infinito');
      console.error('');
      console.error('📋 PASOS PARA SOLUCIONAR:');
      console.error('');
      console.error('1️⃣  Verificar que WhatsApp esté abierto en el teléfono');
      console.error('2️⃣  Verificar conexión a Internet estable');
      console.error('3️⃣  Esperar 5 minutos antes de reintentar');
      console.error('4️⃣  Ejecutar nuevamente:');
      console.error('    GET https://capri-store.onrender.com/whatsapp-regenerar-qr');
      console.error('');
      console.error('💡 El contador se reseteará automáticamente al conectar exitosamente');
      console.error(`${'='.repeat(70)}\n`);
      
      // 🔓 CRÍTICO: Resetear isConnecting para permitir reintentos posteriores
      setIsConnecting(false);
      console.error('🔓 isConnecting reseteado - puedes reintentar con /whatsapp-regenerar-qr');
      
      return;
    }
    
    if (qrGenerated) {
      console.log(`\n⚠️ QR anterior expiró, generando nuevo código (intento ${qrAttempts}/${MAX_QR_ATTEMPTS})...\n`);
    }
    
  
    console.log('\n🔐 Autenticación: Local (temporal)\n');
    
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
  client.on('ready', async () => {
    readyEventCount++; // Incrementar contador
    const timestamp = new Date().toLocaleString('es-AR');
    
    if (readyEventCount > 1) {
      console.warn(`⚠️⚠️⚠️ EVENTO READY DUPLICADO #${readyEventCount} - IGNORANDO para evitar problemas`);
      return; // Ignorar eventos ready duplicados
    }
    
    console.log('🎉 EVENTO READY DISPARADO - WhatsApp completamente listo');
    whatsappReady = true;
    
    // RESETEAR CONTADOR DE QR cuando se conecta exitosamente
    qrAttempts = 0;
    console.log('✅ Contador de QR reseteado - conexión exitosa');
    
    // ✅ ENVIAR MENSAJE AL ADMINISTRADOR con delay para que WhatsApp termine de cargar
    if (ADMIN_WHATSAPP) {
      console.log('⏳ Esperando 30 segundos para que WhatsApp termine de cargar antes de enviar mensaje...');
      setTimeout(async () => {
        const adminNumber = ADMIN_WHATSAPP.includes('@c.us') ? ADMIN_WHATSAPP : `${ADMIN_WHATSAPP}@c.us`;
        const mensajeConexion = `🎉 *WHATSAPP CONECTADO EXITOSAMENTE*\n\n` +
          `✅ ${BUSINESS_NAME} está online\n` +
          `🕐 ${new Date().toLocaleString('es-AR')}\n` +
          `📱 Sistema operativo\n\n` +
          `Los clientes ya pueden contactarte por WhatsApp! 🛍️\n\n` +
          `_El sistema enviará mensajes cada 2 min para mantener la sesión activa_`;
        
        // Intentar enviar con reintentos
        for (let intento = 1; intento <= 3; intento++) {
          try {
            console.log(`📱 Enviando mensaje de confirmación al admin (intento ${intento}/3)...`);
            
            // 🔧 SOLUCIÓN: Obtener el número como contacto primero
            console.log(`🔍 Verificando número de contacto: ${adminNumber}`);
            const numberId = await client.getNumberId(ADMIN_WHATSAPP);
            
            if (!numberId) {
              console.error(`❌ Número ${ADMIN_WHATSAPP} no es válido o no está en WhatsApp`);
              break;
            }
            
            console.log(`✅ Número válido encontrado: ${numberId._serialized}`);
            
            // Enviar mensaje usando el ID verificado
            await client.sendMessage(numberId._serialized, mensajeConexion);
            console.log(`✅ Mensaje de confirmación enviado al administrador exitosamente`);
            break; // Salir del loop si fue exitoso
          } catch (mensajeError) {
            console.error(`❌ Error enviando mensaje al admin (intento ${intento}/3):`, mensajeError.message);
            if (intento < 3) {
              console.log(`⏳ Esperando 10 segundos antes del siguiente intento...`);
              await new Promise(resolve => setTimeout(resolve, 10000));
            }
          }
        }
      }, 30000); // Esperar 30 segundos
    } else {
      console.warn('⚠️ ADMIN_WHATSAPP no configurado - no se envió mensaje de confirmación');
    }
    
    /* DESHABILITADO: Guardado de sesión y mensaje inmediato
    // ⏳ ESPERA DINÁMICA: Verificar cada 2s si la sesión se guardó (máx 120s)
    // Razón: RemoteAuth tarda ~77s en guardar (observado en logs)
    console.log('⏳ Iniciando espera dinámica para confirmación de guardado de sesión...');
    console.log('⏰ Timeout aumentado a 120s para cubrir tiempo real de guardado');
    
    esperarGuardadoSesion(120000).then(async (sesionGuardada) => {
      if (sesionGuardada) {
        console.log('✅ Proceso de conexión completado - Sesión guardada y verificada en PostgreSQL');
        
        // ⏳ ESPERAR 10s para que WhatsApp se estabilice completamente
        console.log('⏳ Esperando 10s adicionales para estabilización de WhatsApp...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        console.log('✅ WhatsApp estabilizado - procediendo a enviar mensaje');
        
        // 📱 ENVIAR MENSAJE AL ADMIN - Modo simplificado
        try {
          if (ADMIN_WHATSAPP && whatsappReady) {
            const adminNumber = ADMIN_WHATSAPP.includes('@c.us') ? ADMIN_WHATSAPP : `${ADMIN_WHATSAPP}@c.us`;
            const mensajeAdmin = `🎉 *WHATSAPP BUSINESS CONECTADO*\n\n` +
              `✅ Capri Store está online\n` +
              `🕐 ${new Date().toLocaleString('es-AR')}\n` +
              `📊 Sistema operativo (modo simplificado)\n\n` +
              `Los clientes ya pueden contactarte por WhatsApp! 🛍️`;
            
            console.log(`📱 Enviando mensaje de confirmación al admin (${ADMIN_WHATSAPP})...`);
            await client.sendMessage(adminNumber, mensajeAdmin);
            console.log(`✅ Mensaje de confirmación enviado al admin exitosamente`);
          } else if (!ADMIN_WHATSAPP) {
            console.warn('⚠️ ADMIN_WHATSAPP no configurado - no se envió mensaje de confirmación');
          } else if (!whatsappReady) {
            console.warn('⚠️ whatsappReady=false - no se puede enviar mensaje');
          }
        } catch (mensajeError) {
          console.error(`❌ Error enviando mensaje al admin:`, mensajeError.message);
        }
      }
    */
    
    /* DESHABILITADO: Continuación de espera de guardado
      } else {
        console.error('❌ Timeout alcanzado (120s) - sesión NO se guardó en PostgreSQL');
        console.error('⚠️ NO se enviará mensaje al admin (sesión no persistente)');
        console.error('💡 Esto puede indicar un problema con RemoteAuth o permisos de escritura');
      }
      
      setIsConnecting(false); // 🔓 Desbloquear sistema
      console.log('🔓 Sistema desbloqueado para otras operaciones');
    });
    */
    
    setIsConnecting(false); // 🔓 Desbloquear inmediatamente
    console.log('🔓 Sistema desbloqueado para otras operaciones');
    
    // Marcar conexión exitosa para verificación de disponibilidad
    console.log('🎯 PRINCIPAL: Marcando conexión desde evento ready');
    marcarConexionExitosa();
    
    // Procesar notificaciones pendientes en background
    if (onWhatsAppReadyCallback) {
      console.log('🔄 Ejecutando callback para notificaciones pendientes (WhatsApp ready confirmado)...');
      setImmediate(async () => {
        try {
          await onWhatsAppReadyCallback();
          lastCallbackExecution = Date.now();
        } catch (error) {
          console.error('❌ Error en callback de notificaciones pendientes:', error);
        }
      });
    }
    
    // Verificar estado real y mostrar info
    try {
      const state = await client.getState();
      const authInfo = 'Local (Temporal)';
      
      console.log('\n🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
      console.log(`✅ WHATSAPP BUSINESS CONECTADO! [${timestamp}]`);
      console.log(`📱 Negocio: ${BUSINESS_NAME}`);
      console.log(`📞 Admin: ${ADMIN_WHATSAPP}`);
      console.log(`🔗 Estado del cliente: ${state}`);
      console.log(`🗄️ Autenticación: ${authInfo}`);
      console.log('🛍️ ¡Los clientes ya pueden contactarte por WhatsApp!');
      console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
    } catch (infoError) {
      console.log('⚠️ No se pudo obtener info del estado');
    }
  });
  
  // Evento authenticated - Solo para logging, el evento 'ready' es el definitivo
  client.on('authenticated', async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 🔐 WhatsApp autenticado correctamente`);
    console.log(`[${timestamp}] ⏳ Esperando evento ready para confirmar conexión completa...`);
    console.log(`[${timestamp}] ℹ️ Esto puede tomar 1-2 minutos en Render Free (recursos limitados)`);
    console.log(`[${timestamp}] 🔄 WhatsApp está cargando la interfaz web...`);
    
    // Asegurarse de que isConnecting esté en true
    if (!isConnecting) {
      setIsConnecting(true);
      console.log(`[${timestamp}] 🔒 isConnecting establecido a true`);
    }
    
    // 🛟 BACKUP: Si después de 2 minutos no hay evento ready, verificar manualmente
    setTimeout(async () => {
      if (!whatsappReady) {
        const ts = new Date().toISOString();
        console.log(`[${ts}] ⚠️ Han pasado 2 minutos desde authenticated y no hay evento ready`);
        console.log(`[${ts}] 🔍 Verificando estado del cliente manualmente...`);
        
        try {
          const state = await client.getState();
          console.log(`[${ts}] 📊 Estado del cliente: ${state}`);
          
          if (state === 'CONNECTED') {
            console.log(`[${ts}] ✅ Cliente CONECTADO - forzando activación manual`);
            whatsappReady = true;
            qrAttempts = 0;
            setIsConnecting(false);
            marcarConexionExitosa();
            
            // Enviar mensaje al admin
            if (ADMIN_WHATSAPP) {
              try {
                console.log(`[${ts}] 📱 Enviando mensaje al admin tras activación manual...`);
                const numberId = await client.getNumberId(ADMIN_WHATSAPP);
                
                if (numberId) {
                  const mensaje = `🎉 *WHATSAPP CONECTADO* (activación manual)\n\n✅ ${BUSINESS_NAME} está online\n🕐 ${new Date().toLocaleString('es-AR')}\n\n_Conexión detectada manualmente después del timeout_`;
                  await client.sendMessage(numberId._serialized, mensaje);
                  console.log(`[${ts}] ✅ Mensaje de confirmación enviado al admin`);
                } else {
                  console.error(`[${ts}] ❌ Número admin no válido: ${ADMIN_WHATSAPP}`);
                }
              } catch (err) {
                console.error(`[${ts}] ❌ Error enviando mensaje:`, err.message);
              }
            }
            
            // Ejecutar callback de notificaciones pendientes
            if (onWhatsAppReadyCallback) {
              console.log(`[${ts}] 🔄 Ejecutando callback de notificaciones pendientes...`);
              setImmediate(async () => {
                try {
                  await onWhatsAppReadyCallback();
                } catch (error) {
                  console.error(`[${ts}] ❌ Error en callback:`, error);
                }
              });
            }
          } else {
            console.log(`[${ts}] ⚠️ Estado no es CONNECTED: ${state} - esperando más tiempo...`);
          }
        } catch (error) {
          console.error(`[${ts}] ❌ Error verificando estado:`, error.message);
        }
      } else {
        console.log(`[${new Date().toISOString()}] ✅ Evento ready ya se disparó correctamente`);
      }
    }, 120000); // 2 minutos
  });
  
  // Evento disconnected
  client.on('disconnected', (reason) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ⚠️ WhatsApp desconectado - Razón: ${reason}`);
    console.log(`[${timestamp}] 🔄 Marcando como no listo y reseteando flags...`);
    whatsappReady = false;
    qrGenerated = false;
    setIsConnecting(false); // 🔓 Desbloquear si se desconecta
    
    console.log('\n========================================');
    console.log('⚠️  WHATSAPP DESCONECTADO');
    console.log('========================================');
    console.log('');
    console.log('Para volver a conectar, sigue estos pasos:');
    console.log('');
    console.log('1. Ve a: https://capri-store.onrender.com/whatsapp-regenerar-qr');
    console.log('2. Escanea el código QR con tu WhatsApp Business');
    console.log('3. El sistema se reconectará automáticamente');
    console.log('');
    console.log('========================================\n');
    
    // Si la desconexión es por sesión inválida, avisar
    if (reason === 'NAVIGATION' || reason === 'LOGOUT') {
      console.log(`[${timestamp}] ⚠️ Sesión perdida - Se necesitará escanear QR nuevamente`);
      return;
    }
    
    // Si es por QR timeout, no hacer reconexión automática inmediata
    if (reason === 'Max qrcode retries reached') {
      console.log(`[${timestamp}] ⚠️ QR timeout - Esperando intervención manual o keep-alive`);
      console.log(`[${timestamp}] 💡 El sistema keep-alive detectará esto y generará nuevo QR`);
      return;
    }
  });
  
  // Evento loading_screen
  client.on('loading_screen', (percent, message) => {
    console.log('📱 Cargando WhatsApp:', percent + '%', message);
  });

  
  console.log('✅ Eventos de WhatsApp registrados correctamente');
}

// ===============================
// REGISTRAR EVENTOS EN CLIENTE INICIAL
// ===============================
registrarEventosWhatsApp(whatsappClient);


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
    if (whatsappClient && typeof whatsappClient.destroy === 'function') {
      await whatsappClient.destroy();
      console.log('✅ WhatsApp cerrado');
    } else {
      console.log('ℹ️ No hay cliente WhatsApp para cerrar');
    }
  } catch (error) {
    console.error('⚠️ Error cerrando WhatsApp:', error.message);
  }
  
  console.log('✅ Cleanup completado');
}

// ===============================
// FUNCIÓN DE INICIALIZACIÓN SIMPLIFICADA
// ===============================

// Función para inicializar WhatsApp (simplificada - NO destroy)
async function inicializarWhatsApp() {
  console.log('🔵 inicializarWhatsApp() LLAMADA');
  console.log('📍 Stack trace:');
  console.trace();
  
  try {
    // SOLO REINICIALIZAR - NO DESTRUIR
    // El destroy() causa "Could not find expected browser" porque elimina Puppeteer
    
    if (!whatsappClient) {
      console.log('🆕 Creando nuevo cliente WhatsApp (primera vez)...');
      
      whatsappClient = new Client({
        authStrategy: new LocalAuth({
          clientId: 'capri-store-session',
          dataPath: authPath
        }),
        puppeteer: {
          headless: true,
          args: puppeteerArgs,
          timeout: 180000, // ⏰ 3 minutos - Render Free necesita más tiempo
          executablePath: chromiumPath, // Usar el path detectado
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false
        },
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        },
        qrMaxRetries: 3,
        authTimeoutMs: 180000, // ⏰ 3 minutos para autenticación en Render Free
        takeoverOnConflict: true,
        takeoverTimeoutMs: 120000 // ⏰ 2 minutos para takeover
      });
      
      // Registrar eventos
      registrarEventosWhatsApp(whatsappClient);
      console.log('✅ Cliente creado y eventos registrados');
    } else {
      console.log('🔄 Cliente existente - reinicializando sin destruir...');
      // El cliente ya existe, solo reinicializar
    }
    
    console.log('🚀 Inicializando WhatsApp Business...');
    console.log('📱 Inicializando cliente WhatsApp (LocalAuth stateless)...');
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
    
    // No hay limpieza de sesión en base de datos en modo stateless/local
    
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
    
    const cleanType = 'local';
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

// (Removed PostgreSQL-specific cleanup - stateless/local only)

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

// (Removed force-save session function - not applicable in stateless/local mode)

// (Removed comprehensive cleanup that included PostgreSQL-specific logic)

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

// ===============================
// FUNCIÓN PARA VERIFICAR CONEXIÓN COMPLETA
// ===============================
// Esta función verifica que TODAS las variables de estado sean true
// antes de considerar WhatsApp como completamente conectado
async function verificarConexionCompleta() {
  try {
    // Obtener estado actual
    const status = await getWhatsAppStatus();
    
    // Verificar TODAS las condiciones necesarias
    const todasLasCondicionesOK = 
      status.whatsapp_ready === true &&
      status.client_ready === true &&
      (status.client_state === 'CONNECTED' || status.state === 'CONNECTED') &&
      status.authenticated === true;
    
    return {
      conectado: todasLasCondicionesOK,
      detalles: {
        whatsapp_ready: status.whatsapp_ready,
        client_ready: status.client_ready,
        client_state: status.client_state || status.state,
        authenticated: status.authenticated
      },
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    return {
      conectado: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Función para obtener el estado actual de whatsappReady (siempre actualizado)
function getWhatsAppReady() {
  return whatsappReady;
}

function getIsConnecting() {
  return isConnecting;
}

module.exports = {
  whatsappClient,
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
  getIsConnecting,
  setIsConnecting,
  setOnWhatsAppReadyCallback,
  limpiarMemoriaProactiva,
  ultimaConexionExitosa,
  sessionIsOld,
  ADMIN_WHATSAPP,
  BUSINESS_NAME
};


