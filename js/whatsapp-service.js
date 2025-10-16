const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const PostgresAuthStrategy = require('./postgres-auth-strategy');

// Configuración del negocio
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP; // Número del admin

let whatsappReady = false;
let qrGenerated = false;
let qrAttempts = 0;
const MAX_QR_ATTEMPTS = 15; // Aumentar límite para PostgreSQL

console.log('📱 Configurando WhatsApp Business...');

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

const whatsappClient = new Client({
  authStrategy: authStrategy,
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
      '--max-memory-usage=128',
      '--aggressive-cache-discard',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
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
  }
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
  whatsappClient.on('remote_session_saved', () => {
    console.log('💾 ✅ Sesión guardada en PostgreSQL exitosamente');
    console.log('🕐 Timestamp:', new Date().toISOString());
  });
  
  whatsappClient.on('remote_session_loaded', () => {
    console.log('📥 ✅ Sesión cargada desde PostgreSQL exitosamente');
    console.log('🕐 Timestamp:', new Date().toISOString());
  });
  
  // Eventos adicionales de RemoteAuth
  whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ Fallo de autenticación RemoteAuth:', msg);
  });
  
  whatsappClient.on('disconnected', (reason) => {
    console.warn(`⚠️ WhatsApp desconectado: ${reason}`);
    console.log('🔄 RemoteAuth debería intentar reconectar automáticamente...');
  });
} else {
  console.log('ℹ️ Usando LocalAuth - No hay eventos de sesión remota');
}

whatsappClient.on('ready', async () => {
  const timestamp = new Date().toLocaleString('es-AR');
  whatsappReady = true;
  
  // Verificar estado real
  try {
    const state = await whatsappClient.getState();
    const authInfo = usePostgresAuth ? 'PostgreSQL (Persistente)' : 'Local (Temporal)';
    
    console.log('\n🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉');
    console.log(`✅ WHATSAPP BUSINESS CONECTADO! [${timestamp}]`);
    console.log(`📱 Negocio: ${BUSINESS_NAME}`);
    console.log(`📞 Admin: ${ADMIN_WHATSAPP}`);
    console.log(`🔗 Estado del cliente: ${state}`);
    console.log(`�️ Autenticación: ${authInfo}`);
    console.log('🛍️ ¡Los clientes ya pueden contactarte por WhatsApp!');
    console.log('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
    
    if (usePostgresAuth) {
      console.log('✅ SESIÓN PERSISTENTE ACTIVADA - No necesitarás escanear QR en próximos deploys');
      
      // 🔥 GUARDADO AUTOMÁTICO DE SESIÓN EN POSTGRESQL 🔥
      console.log('💾 Guardando sesión automáticamente en PostgreSQL...');
      try {
        // Usar RemoteAuth para triggear el guardado inmediato
        if (authStrategy && authStrategy.store) {
          // RemoteAuth internamente maneja los datos de sesión
          // Forzamos una sincronización inmediata en lugar de esperar el intervalo
          const sessionBackup = await authStrategy.store.save({ 
            session: JSON.stringify({
              timestamp: new Date().toISOString(),
              ready_at: timestamp,
              client_state: state,
              auto_saved: true
            })
          });
          
          if (sessionBackup) {
            console.log('✅ SESIÓN GUARDADA AUTOMÁTICAMENTE EN POSTGRESQL');
            console.log('🔄 Próximos reinicios recuperarán esta sesión sin QR');
          } else {
            console.log('⚠️ Error al guardar sesión automáticamente');
          }
        }
      } catch (autoSaveError) {
        console.error('❌ Error en guardado automático:', autoSaveError.message);
        console.log('🔄 RemoteAuth seguirá intentando cada 5 minutos automáticamente');
      }
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
  
  // NUEVO: Intentar reconexión automática después de 30 segundos
  console.log(`[${timestamp}] 🔄 Programando reconexión automática en 30 segundos...`);
  setTimeout(async () => {
    try {
      console.log(`[${new Date().toISOString()}] 🔄 Intentando reconexión automática...`);
      
      // Verificar si la carpeta de sesión existe
      const fs = require('fs');
      const path = require('path');
      const authPath = process.env.RENDER ? '/tmp/.wwebjs_auth' : path.join(__dirname, '..', '.wwebjs_auth');
      
      if (fs.existsSync(authPath)) {
        console.log(`[${new Date().toISOString()}] ✅ Sesión guardada existe, intentando reconectar...`);
        await whatsappClient.initialize();
      } else {
        console.log(`[${new Date().toISOString()}] ❌ No hay sesión guardada, se necesitará QR`);
      }
    } catch (reconnectError) {
      console.error(`[${new Date().toISOString()}] ❌ Error en reconexión automática:`, reconnectError.message);
    }
  }, 30000);
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
    }
    
    const isReady = whatsappReady && clientState === 'CONNECTED';
    
    console.log(`[DEBUG] Estado calculado:`, {
      whatsappReady,
      clientState,
      isReady,
      hasStateError: !!stateError
    });
    
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
    
    console.log(`[${timestamp}] 🔄 Cliente conectado, forzando guardado via RemoteAuth...`);
    
    try {
      // Para RemoteAuth, podemos forzar el guardado llamando el método interno
      // Esto debería triggear el guardado inmediatamente sin esperar el intervalo
      if (authStrategy && authStrategy.store) {
        // Obtener información de sesión del cliente (esto varía según la versión)
        let sessionData;
        
        try {
          // Método 1: Intentar obtener session info del cliente
          const info = await whatsappClient.info;
          sessionData = {
            wid: info.wid,
            phone: info.wid?.user,
            timestamp: new Date().toISOString(),
            platform: info.platform || 'unknown'
          };
        } catch (infoError) {
          console.log(`[${timestamp}] ⚠️ No se pudo obtener info, usando datos básicos`);
          // Datos mínimos de sesión
          sessionData = {
            connected: true,
            timestamp: new Date().toISOString(),
            state: state
          };
        }
        
        console.log(`[${timestamp}] 📦 Guardando datos de sesión en PostgreSQL:`, sessionData);
        
        // Guardar usando el store directamente
        const saveResult = await authStrategy.store.save({ 
          session: JSON.stringify(sessionData) 
        });
        
        if (saveResult) {
          console.log(`[${timestamp}] ✅ Sesión guardada exitosamente en PostgreSQL`);
          return { 
            success: true, 
            message: 'Sesión guardada manualmente en PostgreSQL',
            client_id: authStrategy.clientId,
            state: state,
            session_data: sessionData
          };
        } else {
          return { success: false, error: 'Error al guardar en PostgreSQL store' };
        }
      } else {
        return { success: false, error: 'Store no disponible en authStrategy' };
      }
      
    } catch (storeError) {
      console.error(`[${timestamp}] ❌ Error accediendo al store: ${storeError.message}`);
      return { success: false, error: `Error del store: ${storeError.message}` };
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error forzando guardado de sesión: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = {
  whatsappClient,
  inicializarWhatsApp,
  enviarWhatsApp,
  getWhatsAppStatus,
  forzarReconexion,
  limpiarSesionCorrupta,
  limpiarSesionPostgreSQL,
  resetearContadorQR,
  sincronizarEstadoWhatsApp,
  forzarGuardadoSesion,
  whatsappReady,
  ADMIN_WHATSAPP,
  BUSINESS_NAME
};