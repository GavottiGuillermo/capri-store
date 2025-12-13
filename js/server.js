const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');
const cors = require('cors');

// SYSTEM SIMPLIFIED: PostgreSQL session persistence working perfectly - v4.0

// === IMPORTAR WHATSAPP CON MANEJO DE ERRORES ===
let whatsappService = null;
let whatsappAvailable = false;

try {
  whatsappService = require('./whatsapp-service');
  whatsappAvailable = true;
  console.log('📱 Servicio WhatsApp cargado correctamente');
  
  // Configurar callback para procesar notificaciones pendientes cuando WhatsApp se conecte
  whatsappService.setOnWhatsAppReadyCallback(async () => {
    console.log('🔄 WhatsApp conectado - procesando notificaciones pendientes...');
    await procesarNotificacionesPendientes();
  });
  
} catch (error) {
  console.error('⚠️ WhatsApp service no disponible:', error.message);
  console.log('� Modo básico: WhatsApp no estará disponible para notificaciones');
  whatsappAvailable = false;
  
  // Crear funciones dummy para evitar errores
  whatsappService = {
    enviarWhatsApp: () => Promise.resolve({ success: false, error: 'WhatsApp no disponible' }),
    inicializarWhatsApp: () => console.log('WhatsApp no disponible'),
    getWhatsAppStatus: () => ({ whatsapp_ready: false, error: 'No disponible' }),
    whatsappReady: false,
    ADMIN_WHATSAPP: process.env.ADMIN_WHATSAPP,
    BUSINESS_NAME: 'Capri Store'
  };
}

const { enviarWhatsApp, inicializarWhatsApp, getWhatsAppStatus, verificarConexionCompleta, forzarReconexion, limpiarSesionCorrupta, limpiarSesionPostgreSQL, limpiarSesionesCompleto, resetearContadorQR, sincronizarEstadoWhatsApp, forzarGuardadoSesion, getWhatsAppReady, getIsConnecting, setIsConnecting, sessionIsOld, ADMIN_WHATSAPP, BUSINESS_NAME } = whatsappService;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env en la carpeta padre
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ===============================
// MANEJADORES GLOBALES DE ERRORES
// ===============================
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error.message);
  console.error('Stack:', error.stack);
  
  // Si es error de ENOENT en temp-auth, no crashear el servidor
  if (error.code === 'ENOENT' && error.path && error.path.includes('temp-auth')) {
    console.log('⚠️ Error de sesión temporal detectado - servidor continúa funcionando');
    console.log('💡 WhatsApp puede necesitar regenerar QR: /whatsapp-regenerar-qr');
    return;
  }
  
  // Para otros errores críticos, loguear pero intentar continuar
  console.error('⚠️ Error crítico - intentando continuar operación...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION en:', promise);
  console.error('Razón:', reason);
  
  // Si es error de WhatsApp, no crashear
  if (reason && reason.message && (
    reason.message.includes('temp-auth') ||
    reason.message.includes('wwebjs') ||
    reason.message.includes('Session closed')
  )) {
    console.log('⚠️ Error de WhatsApp detectado - servidor continúa funcionando');
    return;
  }
});

// Logging inicial para debugging
console.log('🔧 Variables de entorno cargadas:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- ADMIN_WHATSAPP:', process.env.ADMIN_WHATSAPP ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO');
console.log('- ADMIN_INSTAGRAM:', process.env.ADMIN_INSTAGRAM ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO');

// ===============================
// CONFIGURACIÓN DEL SERVIDOR
// ===============================
console.log('🚀 Capri Store API iniciando...');
console.log('💾 OPTIMIZACIÓN MEMORIA: WhatsApp bajo demanda');
console.log('📊 RAM inicial:', Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB');
console.log('📱 Sistema de comunicación: WhatsApp Business únicamente');

const app = express();

// Almacén en memoria para notificaciones de webhook
const webhookNotifications = new Map();

// ===============================
// CONFIGURACIÓN BÁSICA
// ===============================
const PORT = process.env.PORT || 3000;
let server;

// Configuración de CORS más permisiva para producción
app.use(cors({
  origin: function (origin, callback) {
    // Lista de dominios permitidos
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'http://localhost:10000',
      'https://capri-store.onrender.com',
      'https://capri-store-web.onrender.com',
      'https://www.capristorezte.com.ar',
      'https://capristorezte.com.ar',
      // Permitir Render y otros deployments
      /\.onrender\.com$/,
      /\.herokuapp\.com$/,
      /\.vercel\.app$/,
      /\.netlify\.app$/
    ];
    
    // Permitir requests sin origen (mobile apps, Postman, WhatsApp, etc)
    if (!origin) return callback(null, true);
    
    // Verificar si el origen está permitido
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return allowedOrigin === origin;
      } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS bloqueado para origen: ${origin}`);
      callback(null, true); // Permitir temporalmente para debug
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Middleware para logging de requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip || req.connection.remoteAddress}`);
  
  // Agregar headers de seguridad básicos
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  
// Middleware básico para health check sin autenticación
  if (req.path === '/health' || req.path === '/' || req.path === '/debug' || req.path === '/contact-info' || req.path === '/stock-agotado' || req.path.startsWith('/stock-producto/') || req.path === '/validar-stock-carrito' || req.path === '/crear-preferencia' || req.path === '/webhook' || req.path.startsWith('/numero-pedido/') || req.path === '/limpiar-sesiones-whatsapp') {
    return next();
  }
  
  // Para otros endpoints, continuar normalmente
  next();
});

// Servir archivos estáticos desde la carpeta raíz
app.use(express.static(path.join(__dirname, '..')));

// Endpoint básico de prueba
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Endpoint de texto plano para verificar que el servidor funciona
app.get('/test', (req, res) => {
  res.send('Servidor funcionando correctamente!');
});

// ===============================
// CONFIGURACIÓN DE BASE DE DATOS
// ===============================
let pool;
async function initializeDatabase() {
  try {
    if (process.env.DATABASE_URL) {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
      });
    } else {
      throw new Error('DATABASE_URL no está configurada');
    }

    // Probar la conexión
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();

    // Verificar si existe la columna mp_payment_id
    const client2 = await pool.connect();
    const checkColumn = await client2.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'productos' 
        AND column_name = 'mp_payment_id'
    `);
    client2.release();

    if (checkColumn.rows.length === 0) {
      console.warn('⚠️ Columna mp_payment_id NO existe en tabla productos');
    }

  } catch (error) {
    console.error('❌ Error de conexión a PostgreSQL:', error.message);
    throw error;
  }
}

// ===============================
// CONFIGURACIÓN DE MERCADO PAGO
// ===============================
// Validar token de acceso
if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
  console.error('❌ MERCADOPAGO_ACCESS_TOKEN no configurado - MercadoPago no estará disponible');
  // No terminar el proceso, solo deshabilitar MercadoPago
} else {
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('TEST-') && 
      !process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('APP_USR-')) {
    console.warn('⚠️ Formato de token MercadoPago no reconocido');
  }
}

const client = process.env.MERCADOPAGO_ACCESS_TOKEN ? 
  new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN }) : 
  null;

// ===============================
// MIDDLEWARE DE PARSING
// ===============================
app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ===============================
// FUNCIONES AUXILIARES
// ===============================

// Normalizar números de teléfono para WhatsApp (formato argentino)
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    console.log('🔍 Número inválido:', phone);
    return null;
  }
  
  // Remover todos los caracteres no numéricos
  let cleanNumber = phone.replace(/\D/g, '');
  console.log('🔍 Número limpio:', cleanNumber);
  
  // Si empieza con 54 (Argentina), mantenerlo
  if (cleanNumber.startsWith('54')) {
    // Si tiene 13 dígitos (549xxxxxxxxx), está correcto
    if (cleanNumber.length === 13) {
      console.log('✅ Número argentino completo:', cleanNumber);
      return cleanNumber;
    }
    // Si tiene 12 dígitos (54xxxxxxxxxx), agregar el 9
    if (cleanNumber.length === 12) {
      const normalized = '549' + cleanNumber.substring(2);
      console.log('✅ Número argentino normalizado (agregado 9):', normalized);
      return normalized;
    }
  }
  
  // Si empieza solo con 9 (formato local argentino 9xxxxxxxxxx)
  if (cleanNumber.startsWith('9') && cleanNumber.length === 11) {
    const normalized = '54' + cleanNumber;
    console.log('✅ Número local argentino normalizado:', normalized);
    return normalized;
  }
  
  // Si es número local sin 9 (xxxxxxxxxx - 10 dígitos)
  if (cleanNumber.length === 10) {
    const normalized = '549' + cleanNumber;
    console.log('✅ Número local sin 9 normalizado:', normalized);
    return normalized;
  }
  
  // Si ya tiene 13 dígitos pero no empieza con 54, puede ser otro formato
  if (cleanNumber.length === 13) {
    console.log('⚠️ Número de 13 dígitos no argentino:', cleanNumber);
    return cleanNumber; // Devolver tal como está
  }
  
  console.log('❌ Formato de número no reconocido:', cleanNumber);
  return cleanNumber; // Devolver lo que se pueda
}

// Generar ID único para pedidos
function generateOrderId() {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 8);
  return `CAPRI-${timestamp.slice(-6)}-${random.toUpperCase()}`;
}

// Validar datos de cliente
function validateCustomerData(data) {
  const errors = [];
  
  if (!data.nombre?.trim()) errors.push('Nombre es requerido');
  if (!data.apellido?.trim()) errors.push('Apellido es requerido');
  if (!data.telefono?.trim()) errors.push('Teléfono es requerido');
  
  // Normalizar el teléfono si está presente
  if (data.telefono?.trim()) {
    const normalizedPhone = normalizePhoneNumber(data.telefono);
    if (normalizedPhone) {
      data.telefono = normalizedPhone; // Actualizar el teléfono con el formato normalizado
      console.log(`📱 Teléfono normalizado: ${data.telefono}`);
    } else {
      errors.push('Formato de teléfono inválido');
    }
  }
  
  return errors;
}

// ===============================
// ENDPOINTS BÁSICOS
// ===============================

// ===============================
// ENDPOINTS PRINCIPALES
// ===============================
    

// === ENDPOINT DE SALUD ===
// Variables para control de reconexión automática
let lastReconnectAttempt = 0;
const RECONNECT_INTERVAL = 10 * 60 * 1000; // 10 minutos entre intentos

app.get('/health', async (req, res) => {
  // ⚠️ ENDPOINT SILENCIOSO - Sin logs para evitar spam
  // Usado por Render para health checks automáticos cada 5 min
  // Para WhatsApp keep-alive con mensaje al admin, usar /whatsapp-keep-alive
  
  // NOTA: Render llama a este endpoint cada 5 minutos desde su configuración
  // No se puede cambiar la frecuencia desde código, solo desde el dashboard de Render
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsapp_available: whatsappAvailable,
    whatsapp_ready: whatsappAvailable ? getWhatsAppReady() : false,
    business_name: BUSINESS_NAME,
    env_vars: {
      admin_whatsapp: !!process.env.ADMIN_WHATSAPP,
      admin_instagram: !!process.env.ADMIN_INSTAGRAM,
      mercadopago_token: !!process.env.MERCADOPAGO_ACCESS_TOKEN,
      render_instance_id: process.env.RENDER_INSTANCE_ID || 'local'
    },
    deployment: {
      simplified: true,
      single_instance: true,
      postgresql_sessions: !!process.env.DATABASE_URL
    },
    keep_alive_info: {
      no_db_queries: true,
      auto_reconnect: 'Deshabilitado desde keep-alive para ahorrar recursos Neon',
      reconnect_trigger: 'WhatsApp se reconecta automáticamente en nuevas ventas'
    }
  });
});

// === ENDPOINT DE SALUD SILENCIOSO (para keep-alive) ===
app.get('/ping', async (req, res) => {
  // Health check silencioso sin logs para sistemas automáticos
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    whatsapp_ready: whatsappAvailable ? getWhatsAppReady() : false
  });
});

// ===============================
// ENDPOINT PARA KEEP-ALIVE CON MENSAJE WHATSAPP
// ===============================
app.get('/whatsapp-keep-alive', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 💚 Keep-Alive WhatsApp ejecutándose...`);
  
  let mensajeEnviado = false;
  let whatsappStatus = 'desconectado';
  let accionRealizada = 'ninguna';
  
  try {
    // 🔒 PROTECCIÓN: No hacer nada si está en proceso de conexión
    if (whatsappAvailable && getIsConnecting()) {
      console.log(`[${timestamp}] 🔒 WhatsApp en proceso de conexión - Keep-alive esperando...`);
      return res.json({
        success: true,
        mensaje: 'WhatsApp conectando - esperando finalización',
        timestamp: new Date().toISOString(),
        whatsapp_status: 'conectando',
        accion: 'esperando'
      });
    }
    
    // Paso 1: Verificar si WhatsApp está completamente conectado
    console.log(`[${timestamp}] 🔍 Paso 1: Verificando estado completo de WhatsApp...`);
    
    // Verificar todas las variables de estado
    let todasLasVariablesOK = false;
    let estadoDetallado = {};
    
    if (whatsappAvailable) {
      try {
        const whatsappStatusObj = await getWhatsAppStatus();
        estadoDetallado = whatsappStatusObj;
        
        // CORRECCIÓN AUTOMÁTICA: Si cliente está CONNECTED pero whatsappReady es false, corregir
        if (whatsappStatusObj.client_state === 'CONNECTED' && !whatsappStatusObj.whatsapp_ready) {
          console.log(`[${timestamp}] 🔧 CORRECCIÓN: Cliente CONNECTED pero whatsappReady=false - Forzando corrección...`);
          try {
            // Importar y usar setWhatsAppReady
            const { setWhatsAppReady, marcarConexionExitosa } = require('./whatsapp-service');
            setWhatsAppReady(true);
            await marcarConexionExitosa();
            console.log(`[${timestamp}] ✅ whatsappReady forzado a true`);
            
            // Re-obtener estado actualizado
            const whatsappStatusActualizado = await getWhatsAppStatus();
            estadoDetallado = whatsappStatusActualizado;
            console.log(`[${timestamp}] 📊 Estado actualizado:`, whatsappStatusActualizado);
          } catch (correccionError) {
            console.error(`[${timestamp}] ❌ Error corrigiendo whatsappReady:`, correccionError.message);
          }
        }
        
        // Considerar conectado solo cuando TODAS las variables relevantes sean true
        todasLasVariablesOK = 
          whatsappStatusObj.whatsapp_ready === true &&
          whatsappStatusObj.client_ready === true &&
          (whatsappStatusObj.client_state === 'CONNECTED' || whatsappStatusObj.state === 'CONNECTED');
        
        console.log(`[${timestamp}] 📊 Estado WhatsApp:`, {
          whatsapp_ready: whatsappStatusObj.whatsapp_ready,
          client_ready: whatsappStatusObj.client_ready,
          client_state: whatsappStatusObj.client_state,
          todasLasVariablesOK
        });
        
      } catch (statusError) {
        console.error(`[${timestamp}] ❌ Error obteniendo estado:`, statusError.message);
        todasLasVariablesOK = false;
      }
    }
    
    // FLUJO: SI ESTÁ HABILITADO (todas las variables OK)
    if (todasLasVariablesOK) {
      whatsappStatus = 'conectado';
      console.log(`[${timestamp}] ✅ WhatsApp CONECTADO - Todas las variables OK`);
      
      // 1. Procesar mensajes pendientes
      console.log(`[${timestamp}] 📤 Procesando mensajes pendientes...`);
      try {
        await procesarNotificacionesPendientes();
        accionRealizada = 'procesados_pendientes';
      } catch (procesarError) {
        console.error(`[${timestamp}] ⚠️ Error procesando pendientes:`, procesarError.message);
      }
      
      // 2. Enviar mensaje al administrador (SIEMPRE para mantener sesión activa)
      if (ADMIN_WHATSAPP) {
        const ahora = new Date();
        const horaFormato = ahora.toLocaleString('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit'
        });
        
        const mensaje = `🟢 *Keep-Alive* - ${horaFormato}\n\n` +
          `✅ WhatsApp conectado\n` +
          `⏱️ Uptime: ${Math.floor(process.uptime() / 60)} min\n` +
          `💾 Memoria: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n\n` +
          `_Verificación automática cada 10 min_`;
        
        try {
          const resultado = await enviarWhatsApp(ADMIN_WHATSAPP, mensaje);
          mensajeEnviado = resultado.success;
          
          if (resultado.success) {
            console.log(`[${timestamp}] ✅ Mensaje keep-alive enviado al administrador`);
            accionRealizada = 'procesados_pendientes_y_mensaje_admin';
          } else {
            console.log(`[${timestamp}] ⚠️ No se pudo enviar mensaje keep-alive: ${resultado.error}`);
          }
        } catch (error) {
          console.error(`[${timestamp}] ❌ Error enviando mensaje keep-alive:`, error.message);
        }
      }
      
    } else {
      // FLUJO: SI NO ESTÁ HABILITADO
      console.log(`[${timestamp}] ⚠️ WhatsApp NO CONECTADO - Verificando opciones...`);
      
      // Verificar si hay sesión guardada en PostgreSQL
      let tieneSesionEnBBDD = false;
      let sesionEdadHoras = null;
      
      try {
        const resultSession = await executeQueryWithRetry(
          pool,
          'SELECT updated_at FROM whatsapp_sessions WHERE id = $1 LIMIT 1',
          ['RemoteAuth-capri-store-main'],
          1
        );
        
        if (resultSession && resultSession.rows && resultSession.rows.length > 0) {
          tieneSesionEnBBDD = true;
          const updatedAt = new Date(resultSession.rows[0].updated_at);
          const ahora = new Date();
          sesionEdadHoras = (ahora - updatedAt) / (1000 * 60 * 60);
          
          console.log(`[${timestamp}] 📊 Sesión en BBDD: ${sesionEdadHoras.toFixed(1)} horas`);
        } else {
          console.log(`[${timestamp}] 📊 No hay sesión en BBDD`);
        }
      } catch (dbError) {
        console.error(`[${timestamp}] ❌ Error verificando sesión:`, dbError.message);
      }
      
      // Si hay sesión del mismo día (<24h), intentar conectar
      if (tieneSesionEnBBDD && sesionEdadHoras !== null && sesionEdadHoras < 24) {
        console.log(`[${timestamp}] 🔄 Sesión reciente detectada - Intentando reconectar...`);
        whatsappStatus = 'reconectando';
        accionRealizada = 'intento_reconexion';
        
        try {
          await inicializarWhatsApp();
          console.log(`[${timestamp}] ✅ Reconexión iniciada - WhatsApp se conectará automáticamente`);
          
          // Esperar 10 segundos y verificar si conectó
          await new Promise(resolve => setTimeout(resolve, 10000));
          
          const statusDespuesReconexion = await getWhatsAppStatus();
          if (statusDespuesReconexion.whatsapp_ready && statusDespuesReconexion.client_ready) {
            console.log(`[${timestamp}] ✅ Reconexión exitosa!`);
            whatsappStatus = 'conectado';
            
            // Procesar pendientes después de reconectar
            await procesarNotificacionesPendientes();
          } else {
            console.log(`[${timestamp}] ⚠️ Reconexión en proceso... verificar en próximo keep-alive`);
          }
          
        } catch (reconError) {
          console.error(`[${timestamp}] ❌ Error en reconexión:`, reconError.message);
          accionRealizada = 'fallo_reconexion';
        }
        
      } else {
        // No hay sesión o es muy antigua (>24h) - Mostrar log para operador
        console.log(`\n${'='.repeat(70)}`);
        console.log(`📱 WHATSAPP NO CONECTADO - REQUIERE ACCIÓN DEL OPERADOR`);
        console.log(`${'='.repeat(70)}`);
        
        if (!tieneSesionEnBBDD) {
          console.log(`\n❌ No hay sesión guardada en la base de datos`);
        } else if (sesionEdadHoras >= 24) {
          console.log(`\n❌ Sesión antigua detectada (${sesionEdadHoras.toFixed(1)} horas)`);
          console.log(`⚠️  Solo se reconecta automáticamente con sesiones <24h`);
        }
        
        console.log(`\n📋 PASOS PARA CONECTAR WHATSAPP:\n`);
        console.log(`1️⃣  Ejecutar Query para generar QR:`);
        console.log(`   GET https://capri-store.onrender.com/whatsapp-regenerar-qr\n`);
        console.log(`2️⃣  PowerShell:`);
        console.log(`   Invoke-RestMethod -Uri "https://capri-store.onrender.com/whatsapp-regenerar-qr" -Method GET\n`);
        console.log(`3️⃣  Escanear el QR que aparecerá en los logs`);
        console.log(`4️⃣  Esperar hasta ver "WhatsApp CONECTADO" en próximo keep-alive\n`);
        console.log(`${'='.repeat(70)}\n`);
        
        whatsappStatus = 'desconectado_requiere_operador';
        accionRealizada = 'log_mostrado_para_operador';
      }
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en keep-alive:`, error.message);
    whatsappStatus = 'error';
    accionRealizada = 'error: ' + error.message;
  }
  
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    whatsapp_ready: whatsappStatus === 'conectado' || whatsappStatus === 'enviando',
    whatsapp_status: whatsappStatus,
    mensaje_enviado: mensajeEnviado,
    accion_realizada: accionRealizada
  });
});

// ===============================
// ÚNICO ENDPOINT DE WHATSAPP PARA REGENERAR QR
// ===============================
app.post('/limpiar-sesiones-whatsapp', async (req, res) => {
  try {
    console.log('🧹 REINICIO COMPLETO iniciado...');
    
    // 1. Verificar disponibilidad de servicios
    const usePostgresAuth = !!(process.env.DATABASE_URL);
    
    if (!usePostgresAuth) {
      return res.json({
        success: false,
        error: 'No se está usando autenticación PostgreSQL',
        current_auth: 'LocalAuth',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('🔄 Ejecutando limpieza completa...');
    
    // 2. Limpiar sesiones
    const cleanResult = await limpiarSesionesCompleto();
    
    if (cleanResult.success) {
      console.log('✅ Sesión limpiada, WhatsApp se reiniciará con configuración corregida');
      res.json({
        success: true,
        message: 'Reinicio completo iniciado - Se generará nuevo QR con configuración Linux corregida',
        timestamp: new Date().toISOString(),
        next_steps: [
          '1. Espera 10-15 segundos',
          '2. Verifica /whatsapp-status para ver el nuevo QR',
          '3. El dispositivo debería aparecer como "Linux Desktop" ahora'
        ]
      });
    } else {
      res.status(500).json(cleanResult);
    }
    
  } catch (error) {
    console.error('❌ Error en reinicio completo:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === ESTADO WHATSAPP ===
app.get('/whatsapp-status', async (req, res) => {
  try {
    console.log('📱 Estado WhatsApp solicitado desde API...');
    
    if (!whatsappAvailable) {
      return res.json({
        whatsapp_ready: false,
        error: 'WhatsApp service no disponible',
        timestamp: new Date().toISOString()
      });
    }
    
    const status = await getWhatsAppStatus();
    
    // Detectar si está en modo lazy loading
    const isLazyLoading = status.state === 'NOT_INITIALIZED';
    const isConnecting = getIsConnecting(); // 🔒 Estado de conexión
    
    res.json({
      whatsapp_ready: getWhatsAppReady(),
      client_ready: status.whatsapp_ready || false,
      state: status.state || 'UNKNOWN',
      is_connecting: isConnecting, // 🔒 Indica si está en proceso de conexión
      lazy_loading: isLazyLoading,
      qr_generated: status.qr_code ? true : false,
      auth_folder: {
        exists: status.auth_folder_exists || false
      },
      last_connection: status.last_connection || null,
      error: status.error || null,
      instructions: isLazyLoading ? [
        '💾 WhatsApp está en modo ahorro de memoria',
        '🚀 Usa /whatsapp-regenerar-qr para inicializar',
        '📱 Esto generará el código QR para escanear'
      ] : null,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo estado WhatsApp:', error);
    res.status(500).json({
      whatsapp_ready: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === REGENERAR QR DE WHATSAPP ===
app.get('/whatsapp-regenerar-qr', async (req, res) => {
  console.log('🔄 Solicitud de regeneración de QR desde:', req.ip);
  
  // Parámetro opcional para forzar regeneración
  const force = req.query.force === 'true';
  
  try {
    // 🔒 PROTECCIÓN: No permitir regenerar QR si está en proceso de conexión (a menos que force=true)
    if (whatsappAvailable && getIsConnecting() && !force) {
      console.log('🔒 WhatsApp en proceso de conexión - No se puede regenerar QR');
      const whatsappStatus = await getWhatsAppStatus();
      return res.status(409).json({
        success: false,
        error: 'WhatsApp conectando',
        message: 'El sistema está en proceso de conexión. Espera 30-60 segundos o usa force=true',
        estado: 'conectando',
        client_state: whatsappStatus.client_state || 'UNKNOWN',
        solucion: {
          opcion1: 'Espera 30-60 segundos y reintenta',
          opcion2: 'Usa: GET /whatsapp-regenerar-qr?force=true para forzar',
          curl: 'curl "https://capri-store.onrender.com/whatsapp-regenerar-qr?force=true"',
          powershell: 'Invoke-RestMethod -Uri "https://capri-store.onrender.com/whatsapp-regenerar-qr?force=true" -Method GET'
        }
      });
    }
    
    if (force && getIsConnecting()) {
      console.log('⚠️ FORCE MODE: Forzando regeneración a pesar de isConnecting=true');
      // Forzar reset del flag
      setIsConnecting(false);
      console.log('🔓 isConnecting forzado a false');
    }
    
    if (!whatsappAvailable) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp service no disponible',
        message: 'El módulo WhatsApp no está cargado',
        available: false
      });
    }

    // Verificar que el servicio tenga los métodos necesarios
    if (!whatsappService || typeof whatsappService.limpiarSesionesCompleto !== 'function') {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp service incompleto',
        message: 'El método de limpieza no está disponible',
        service_loaded: !!whatsappService,
        method_available: typeof whatsappService?.limpiarSesionesCompleto
      });
    }

    console.log('🧹 Iniciando proceso de regeneración QR...');
    
    // PASO 1: Verificar estado inicial
    console.log('📱 Paso 1: Verificando estado inicial...');
    
    // PASO 2: Limpiar sesión completa para forzar QR (sin inicialización previa)
    console.log('🧹 Paso 2: Limpiando sesión para generar nuevo QR...');
    const resultado = await whatsappService.limpiarSesionesCompleto();
    
    if (resultado && resultado.success) {
      console.log('✅ Limpieza exitosa - QR se regenerará automáticamente');
      res.json({
        success: true,
        message: 'Sesión limpiada exitosamente - QR se generará automáticamente',
        details: resultado.message,
        instructions: [
          '📱 Busca el código QR en los logs del servidor',
          '🔍 Verifica /whatsapp-status en unos segundos para ver el nuevo QR',
          '📲 Escanéalo con WhatsApp > Dispositivos Vinculados > Vincular'
        ],
        actions_completed: resultado.actions_completed || [],
        timestamp: resultado.timestamp
      });
    } else {
      console.log('❌ Error en limpieza:', resultado?.error || 'Resultado inválido');
      res.status(500).json({
        success: false,
        error: resultado?.error || 'Error desconocido en limpieza',
        message: 'Error al limpiar sesión',
        resultado_completo: resultado,
        timestamp: resultado?.timestamp || new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('❌ Error crítico en regeneración de QR:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      message: 'Error crítico al regenerar QR',
      timestamp: new Date().toISOString()
    });
  }
});

// === MONITOR DE MEMORIA ===
app.get('/memory-status', (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const mbUsed = Math.round(memUsage.heapUsed / 1024 / 1024);
    const mbTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
    const mbRss = Math.round(memUsage.rss / 1024 / 1024);
    const mbExternal = Math.round(memUsage.external / 1024 / 1024);
    
    // Render free tier tiene 512MB de límite
    const renderLimit = 512;
    const usagePercent = Math.round((mbRss / renderLimit) * 100);
    
    // Auto-limpieza si el uso está muy alto
    if (usagePercent >= 85 && whatsappService && whatsappService.limpiarMemoriaProactiva) {
      console.log(`🚨 Uso de memoria alto (${usagePercent}%) - Activando limpieza automática`);
      whatsappService.limpiarMemoriaProactiva();
    }
    
    const status = {
      memory_usage: {
        heap_used_mb: mbUsed,
        heap_total_mb: mbTotal,
        rss_mb: mbRss,
        external_mb: mbExternal,
        usage_percent: usagePercent
      },
      limits: {
        render_limit_mb: renderLimit,
        warning_threshold: 85,  // Reducido de 90 a 85
        critical_threshold: 95
      },
      alerts: {
        memory_warning: usagePercent > 90,
        memory_critical: usagePercent > 95
      },
      timestamp: new Date().toISOString()
    };
    
    // Log si estamos cerca del límite
    if (usagePercent > 80) {
      console.warn(`⚠️ Uso de memoria alto: ${usagePercent}% (${mbRss}MB/${renderLimit}MB)`);
    }
    
    res.json(status);
    
  } catch (error) {
    console.error('❌ Error obteniendo estado de memoria:', error);
    res.status(500).json({
      error: 'Error obteniendo memoria',
      timestamp: new Date().toISOString()
    });
  }
});

// === LIMPIEZA MANUAL DE MEMORIA ===
app.post('/cleanup-memory', (req, res) => {
  try {
    console.log('🧹 Limpieza manual de memoria solicitada desde:', req.ip);
    
    if (whatsappService && whatsappService.limpiarMemoriaProactiva) {
      whatsappService.limpiarMemoriaProactiva();
      
      // Esperar un momento y obtener nueva información de memoria
      setTimeout(() => {
        const memUsage = process.memoryUsage();
        const mbRss = Math.round(memUsage.rss / 1024 / 1024);
        const usagePercent = Math.round((mbRss / 512) * 100);
        
        res.json({
          success: true,
          message: 'Limpieza de memoria ejecutada',
          memory_after_cleanup: {
            rss_mb: mbRss,
            usage_percent: usagePercent
          },
          timestamp: new Date().toISOString()
        });
      }, 1000);
    } else {
      res.status(503).json({
        success: false,
        error: 'Servicio de limpieza no disponible'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// === DEBUG INFO ===
app.get('/debug', (req, res) => {
  res.json({
    app_name: 'Capri Store API',
    version: '4.1 - Memory Optimized',
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    uptime_seconds: Math.floor(process.uptime()),
    memory_usage: {
      heap_used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      heap_total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'
    },
    services: {
      whatsapp_available: whatsappAvailable,
      whatsapp_ready: whatsappAvailable ? getWhatsAppReady() : false,
      database_configured: !!process.env.DATABASE_URL,
      mercadopago_configured: !!process.env.MERCADOPAGO_ACCESS_TOKEN
    },
    env_status: {
      admin_whatsapp: !!process.env.ADMIN_WHATSAPP,
      admin_instagram: !!process.env.ADMIN_INSTAGRAM,
      render_instance: process.env.RENDER_INSTANCE_ID || 'local'
    },
    deployment: {
      type: 'simplified_single_instance',
      feature_lock_removed: true,
      postgresql_sessions: true
    },
    timestamp: new Date().toISOString()
  });
});

// === MONITOR DE MEMORIA ===
app.get('/memory-status', (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const mbUsed = Math.round(memUsage.heapUsed / 1024 / 1024);
    const mbTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
    const mbRss = Math.round(memUsage.rss / 1024 / 1024);
    const mbExternal = Math.round(memUsage.external / 1024 / 1024);
    
    // Render free tier tiene 512MB de límite
    const renderLimit = 512;
    const usagePercent = Math.round((mbRss / renderLimit) * 100);
    
    const status = {
      memory_usage: {
        heap_used_mb: mbUsed,
        heap_total_mb: mbTotal,
        rss_mb: mbRss,
        external_mb: mbExternal
      },
      render_info: {
        limit_mb: renderLimit,
        usage_percent: usagePercent,
        available_mb: renderLimit - mbRss,
        status: usagePercent > 90 ? 'CRITICAL' : usagePercent > 70 ? 'HIGH' : 'OK'
      },
      uptime_seconds: process.uptime(),
      node_version: process.version,
      timestamp: new Date().toISOString()
    };
    
    console.log(`📊 Memoria consultada: ${mbRss}MB/${renderLimit}MB (${usagePercent}%)`);
    
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === ENDPOINT DE DEBUG ===
app.get('/debug', (req, res) => {
  res.json({
    server_status: 'RUNNING',
    node_env: process.env.NODE_ENV,
    port: PORT,
    timestamp: new Date().toISOString(),
    variables_configuradas: {
      ADMIN_WHATSAPP: process.env.ADMIN_WHATSAPP ? 'CONFIGURADO' : 'NO CONFIGURADO',
      ADMIN_INSTAGRAM: process.env.ADMIN_INSTAGRAM ? 'CONFIGURADO' : 'NO CONFIGURADO',
      MERCADOPAGO_ACCESS_TOKEN: process.env.MERCADOPAGO_ACCESS_TOKEN ? 'CONFIGURADO' : 'NO CONFIGURADO',
      DATABASE_URL: process.env.DATABASE_URL ? 'CONFIGURADO' : 'NO CONFIGURADO'
    },
    endpoints_disponibles: [
      '/health',
      '/debug', 
      '/contact-info',
      '/whatsapp-status',
      '/test-whatsapp (POST)',
      '/whatsapp-reconnect (POST)',
      '/whatsapp-clean-session (POST)',
      '/whatsapp-full-reset (POST)',
      '/stock-agotado',
      '/stock-producto/:id',
      '/validar-stock-carrito (POST)',
      '/crear-preferencia (POST)',
      '/webhook (POST)',
      '/numero-pedido/:paymentId',
      '/limpiar-sesiones-whatsapp (POST)',
      '/whatsapp-clean-expired (POST) - Limpiar sesiones expiradas automáticamente'
    ],
    whatsapp_info: {
      service_available: whatsappAvailable,
      client_ready: whatsappAvailable ? getWhatsAppReady() : false,
      admin_configured: !!process.env.ADMIN_WHATSAPP
    }
  });
});

// === INFORMACIÓN DE CONTACTO ===
app.get('/contact-info', (req, res) => {
  try {
    const contactInfo = {
      whatsapp: process.env.ADMIN_WHATSAPP,
      instagram: process.env.ADMIN_INSTAGRAM,
      business_name: BUSINESS_NAME,
      location: 'Zárate, Buenos Aires, Argentina'
    };
    
    // Log para debugging
    console.log('📄 Enviando información de contacto:', {
      whatsapp: contactInfo.whatsapp ? `${contactInfo.whatsapp.substring(0, 4)}****` : 'NO CONFIGURADO',
      instagram: contactInfo.instagram ? 'CONFIGURADO' : 'NO CONFIGURADO'
    });
    
    // Validar que al menos uno de los contactos esté configurado
    if (!contactInfo.whatsapp && !contactInfo.instagram) {
      console.warn('⚠️ Ninguna variable de contacto está configurada');
      return res.status(500).json({
        error: 'No hay información de contacto configurada',
        message: 'Variables de entorno ADMIN_WHATSAPP, ADMIN_INSTAGRAM no están configuradas'
      });
    }
    
    res.json(contactInfo);
  } catch (error) {
    console.error('❌ Error en endpoint /contact-info:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// === STOCK AGOTADO ===
app.get('/stock-agotado', async (req, res) => {
  try {
    console.log('📦 Solicitando stock agotado...');
    
    // Si no hay base de datos, retornar array vacío
    if (!pool) {
      console.warn('⚠️ Base de datos no disponible - retornando stock vacío');
      return res.json({ ids: [] });
    }
    
    // Consultar productos que NO están disponibles
    // Según la estructura de la tabla: estado != 'Disponible' significa agotado/vendido/reservado
    const result = await pool.query(`
      SELECT id_articulo 
      FROM productos 
      WHERE estado IS NULL OR estado != 'Disponible'
      ORDER BY id_articulo
    `);
    
    const ids = result.rows.map(row => row.id_articulo);
    
    console.log(`✅ Stock agotado: ${ids.length} productos no disponibles`);
    
    res.json({ ids });
    
  } catch (error) {
    console.error('❌ Error obteniendo stock agotado:', error.message);
    console.error('Stack trace:', error.stack);
    
    // En caso de error, retornar array vacío en lugar de fallar
    res.json({ ids: [] });
  }
});

// === STOCK DE PRODUCTO ESPECÍFICO ===
app.get('/stock-producto/:id', async (req, res) => {
  try {
    const idArticulo = parseInt(req.params.id, 10);
    console.log(`📦 Consultando stock del producto ID: ${idArticulo}`);
    
    // Validar que el ID sea un número válido
    if (isNaN(idArticulo)) {
      console.error('❌ ID de artículo inválido:', req.params.id);
      return res.status(400).json({ 
        error: 'ID de artículo inválido',
        disponible: false,
        stock: 0 
      });
    }
    
    // Si no hay base de datos, asumir que está disponible (modo degradado)
    if (!pool) {
      console.warn('⚠️ Base de datos no disponible - retornando disponible por defecto');
      return res.json({ 
        disponible: true, 
        stock: 1,
        estado: 'Disponible (sin verificación)'
      });
    }
    
    // Consultar el producto específico
    const result = await pool.query(`
      SELECT id_articulo, estado, publicado_en_web
      FROM productos 
      WHERE id_articulo = $1
    `, [idArticulo]);
    
    if (result.rows.length === 0) {
      console.log(`⚠️ Producto no encontrado en BD: ${idArticulo}`);
      return res.json({ 
        disponible: false, 
        stock: 0,
        estado: 'No encontrado'
      });
    }
    
    const producto = result.rows[0];
    const estadoDisponible = producto.estado === 'Disponible';
    const publicado = producto.publicado_en_web === 'True' || producto.publicado_en_web === true;
    
    // El producto está disponible si su estado es "Disponible"
    const disponible = estadoDisponible && publicado;
    const stock = disponible ? 1 : 0; // Asumimos stock de 1 unidad si está disponible
    
    console.log(`✅ Producto ${idArticulo} - Estado: ${producto.estado}, Publicado: ${publicado}, Disponible: ${disponible}`);
    
    res.json({ 
      disponible, 
      stock,
      estado: producto.estado
    });
    
  } catch (error) {
    console.error('❌ Error consultando stock del producto:', error.message);
    console.error('Stack trace:', error.stack);
    
    // En caso de error, retornar no disponible por seguridad
    res.status(500).json({ 
      disponible: false, 
      stock: 0,
      error: 'Error al consultar stock'
    });
  }
});

// === VALIDAR STOCK DE CARRITO (MÚLTIPLES PRODUCTOS) ===
app.post('/validar-stock-carrito', express.json(), async (req, res) => {
  try {
    const { ids } = req.body;
    console.log(`🛒 Validando stock de carrito para ${ids?.length || 0} productos`);
    
    // Validar que ids sea un array válido
    if (!Array.isArray(ids) || ids.length === 0) {
      console.error('❌ IDs inválidos:', ids);
      return res.json({ 
        ok: false,
        error: 'IDs de productos inválidos',
        faltantes: []
      });
    }
    
    // Si no hay base de datos, asumir que todo está disponible (modo degradado)
    if (!pool) {
      console.warn('⚠️ Base de datos no disponible - asumiendo disponibilidad');
      return res.json({ 
        ok: true, 
        faltantes: [],
        mensaje: 'Validación en modo degradado'
      });
    }
    
    // Consultar productos en la base de datos
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const query = `
      SELECT id_articulo, estado, publicado_en_web
      FROM productos 
      WHERE id_articulo IN (${placeholders})
    `;
    
    const result = await pool.query(query, ids);
    
    // Productos que NO están disponibles
    const productosNoDisponibles = result.rows.filter(p => 
      p.estado !== 'Disponible' || p.publicado_en_web !== 'True'
    );
    
    // IDs de productos en la BD que NO están disponibles
    const idsNoDisponibles = productosNoDisponibles.map(p => p.id_articulo);
    
    // IDs que no se encontraron en la BD (también sin stock)
    const idsEncontrados = result.rows.map(p => p.id_articulo);
    const idsNoEncontrados = ids.filter(id => !idsEncontrados.includes(parseInt(id)));
    
    // Combinar: no disponibles + no encontrados
    const faltantes = [...idsNoDisponibles, ...idsNoEncontrados];
    
    console.log(`✅ Validación de carrito: ${ids.length} solicitados, ${faltantes.length} sin stock`);
    
    res.json({ 
      ok: true, 
      faltantes,
      total_validados: ids.length,
      sin_stock: faltantes.length
    });
    
  } catch (error) {
    console.error('❌ Error validando stock del carrito:', error.message);
    console.error('Stack trace:', error.stack);
    
    // En caso de error, retornar ok pero sin faltantes para no bloquear compras
    res.json({ 
      ok: true,
      faltantes: [],
      error: 'Error al validar stock, asumiendo disponibilidad'
    });
  }
});

// === CREAR PREFERENCIA DE MERCADOPAGO ===
app.post('/crear-preferencia', express.json(), async (req, res) => {
  try {
    const { items, datosComprador } = req.body;
    console.log('💳 Creando preferencia de MercadoPago');
    console.log('Items:', items?.length || 0, 'productos');
    console.log('Comprador:', datosComprador?.nombre, datosComprador?.telefono);
    
    // Validar que haya items
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error('❌ No hay items en la preferencia');
      return res.status(400).json({ 
        error: 'No hay productos en el carrito' 
      });
    }
    
    // Validar que MercadoPago esté configurado
    if (!client) {
      console.error('❌ MercadoPago no está configurado');
      return res.status(500).json({ 
        error: 'Sistema de pagos no disponible' 
      });
    }
    
    // Validar datos del comprador
    if (!datosComprador || !datosComprador.telefono) {
      console.error('❌ Datos del comprador incompletos');
      return res.status(400).json({ 
        error: 'Datos del comprador incompletos - Se requiere teléfono' 
      });
    }
    
    // Normalizar teléfono del comprador y agregar +54 si falta
    let telefonoInput = String(datosComprador.telefono || '').replace(/\D/g, ''); // Solo dígitos
    
    // Agregar 54 (Argentina) si no está presente
    if (!telefonoInput.startsWith('54')) {
      // Si empieza con 9 (WhatsApp), agregar 54 antes
      if (telefonoInput.startsWith('9')) {
        telefonoInput = '54' + telefonoInput;
      } else {
        // Si es número local (ej: 1165031329), agregar 549
        telefonoInput = '549' + telefonoInput;
      }
      console.log('🔄 Teléfono sin código país, agregando 54:', telefonoInput);
    }
    
    const telefonoNormalizado = normalizePhoneNumber(telefonoInput);
    if (!telefonoNormalizado) {
      console.error('❌ Formato de teléfono inválido:', datosComprador.telefono);
      return res.status(400).json({ 
        error: 'Formato de teléfono inválido. Use formato: 549 + código área + número' 
      });
    }
    
    // Actualizar datos del comprador con teléfono normalizado
    datosComprador.telefono = telefonoNormalizado;
    console.log('📱 Teléfono comprador normalizado:', telefonoNormalizado);
    
    // Determinar URLs de retorno según el ambiente
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://capristorezte.com.ar'
      : 'http://localhost:3000';
    
    console.log('🌐 URLs de retorno configuradas para:', baseUrl);
    
    // Crear la preferencia de MercadoPago
    const preference = new Preference(client);
    
    // Función helper para sanitizar strings (remover caracteres que pueden causar problemas con CSP)
    const sanitizeString = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[<>]/g, '') // Remover < >
        .replace(/["'`]/g, '') // Remover comillas
        .replace(/\\/g, '') // Remover backslashes
        .replace(/[():;]/g, '') // Remover paréntesis, dos puntos
        .trim()
        .substring(0, 600); // Limitar longitud
    };

    // Separar código de país del teléfono
    // Formato MercadoPago: area_code='54', number='9 + código área + número'
    // Ejemplo: 5491165031329 -> area_code: '54', number: '91165031329'
    const telefonoStr = String(datosComprador.telefono || '').replace(/\D/g, '');
    let areaCode = '54'; // Código de país Argentina
    let phoneNumber = telefonoStr;
    
    // Si el teléfono ya incluye el código de país 54, separarlo
    if (telefonoStr.startsWith('54')) {
      // Remover solo '54' del inicio, dejar el resto (incluyendo el 9 de WhatsApp)
      phoneNumber = telefonoStr.substring(2); // '5491165031329' -> '91165031329'
    }

    const preferenceData = {
      items: items.map(item => ({
        id: String(item.id || 'producto').substring(0, 50),
        title: sanitizeString(item.title || item.nombre || 'Producto').substring(0, 256),
        quantity: Number(item.quantity || item.cantidad || 1),
        currency_id: 'ARS',
        unit_price: Number(item.unit_price || item.precio || 0)
      })),
      payer: {
        name: sanitizeString(datosComprador.nombre || '').substring(0, 256),
        surname: sanitizeString(datosComprador.apellido || '').substring(0, 256),
        email: datosComprador.email || `cliente${telefonoStr}@mp.com.ar`, // Email real del usuario o fallback
        phone: {
          area_code: areaCode,
          number: phoneNumber.substring(0, 15)
        }
      },
      back_urls: {
        success: `${baseUrl}/success.html`,
        failure: `${baseUrl}/failure.html`,
        pending: `${baseUrl}/pending.html`
      },
      auto_return: 'approved',
      notification_url: `https://capri-store.onrender.com/webhook`,
      // Metadata simplificado para identificación en webhook
      metadata: {
        telefono: String(datosComprador.telefono).replace(/\D/g, '').substring(0, 15)
      },
      // External reference para tracking adicional
      external_reference: `TEL${datosComprador.telefono}_${Date.now()}`
    };
    
    // LOG DETALLADO DE LA PREFERENCIA
    console.log('=== PREFERENCIA PARA MERCADOPAGO ===');
    console.log('📋 Total items:', preferenceData.items.length);
    preferenceData.items.forEach((item, idx) => {
      console.log(`  Item ${idx + 1}:`, JSON.stringify(item));
      // Verificar caracteres problemáticos
      const problematicos = item.title.match(/[^\x00-\x7F]/g);
      if (problematicos) {
        console.warn(`  ⚠️ Caracteres no-ASCII en item ${idx + 1}:`, problematicos);
      }
    });
    console.log('👤 Payer:', JSON.stringify(preferenceData.payer));
    console.log('🔙 Back URLs:', preferenceData.back_urls);
    console.log('📦 Metadata:', JSON.stringify(preferenceData.metadata));
    console.log('🔗 External ref:', preferenceData.external_reference);
    console.log('====================================');
    
    const result = await preference.create({ body: preferenceData });
    
    console.log('✅ Preferencia creada:', result.id);
    console.log('🔗 Init point:', result.init_point);
    
    res.json({ 
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
    
  } catch (error) {
    console.error('❌ Error creando preferencia:', error.message);
    console.error('Stack trace:', error.stack);
    
    res.status(500).json({ 
      error: 'Error al crear preferencia de pago',
      details: error.message
    });
  }
});

// ===============================
// FUNCIONES AUXILIARES PARA BD
// ===============================

// Función para reintentar queries con backoff exponencial
async function executeQueryWithRetry(pool, query, params, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await pool.query(query, params);
    } catch (error) {
      console.error(`❌ Query falló (intento ${attempt}/${maxRetries}):`, error.message);
      if (attempt === maxRetries) throw error;
      // Esperar antes de reintentar (backoff exponencial)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

// ===============================
// ENDPOINTS PRINCIPALES
// ===============================
// FUNCIONES PARA NOTIFICACIONES DE COMPRA
// ===============================

// Función para enviar notificación de compra por WhatsApp
// Variables para tracking de estado WhatsApp
let intentosReconexion = 0;

// Función mejorada para verificar si WhatsApp está realmente disponible
async function verificarEstadoWhatsApp() {
  const ahora = new Date();
  
  // Obtener estado dinámico del whatsapp-service (funciones en lugar de variables)
  let serviceReady = false;
  let ultimaConexion = null;
  let whatsappStatus = null; // Declarar aquí para usarla después
  
  try {
    // Obtener estado real del cliente WhatsApp
    whatsappStatus = await whatsappService.getWhatsAppStatus();
    serviceReady = whatsappStatus.whatsapp_ready || false;
    
    // Usar la variable del servicio si está disponible
    ultimaConexion = whatsappService.ultimaConexionExitosa || null;
    
    console.log(`🔍 DEBUG DETALLADO:`, {
      whatsappAvailable,
      serviceReady,
      clientState: whatsappStatus.client_state,
      isReady: whatsappStatus.isReady,
      ultimaConexionFromService: ultimaConexion ? ultimaConexion.toISOString() : 'null'
    });
    
  } catch (error) {
    console.log(`⚠️ Error obteniendo estado dinámico:`, error.message);
    // Fallback a variables originales
    serviceReady = getWhatsAppReady() || false;
    ultimaConexion = whatsappService.ultimaConexionExitosa || null;
  }
  
  const tiempoDesdeUltimaConexion = ultimaConexion ? (ahora - ultimaConexion) / 1000 : Infinity;
  
  // Criterios para considerar WhatsApp disponible:
  // 1. Módulo cargado (whatsappAvailable = true)
  // 2. Flag listo (whatsappReady = true) O conexión exitosa reciente (< 5 minutos)
  // 3. NO está en estado NOT_INITIALIZED (lazy loading)
  
  const clientState = whatsappStatus?.client_state || whatsappStatus?.state;
  const isNotInitialized = clientState === 'NOT_INITIALIZED';
  
  const disponible = whatsappAvailable && 
                    !isNotInitialized && 
                    (serviceReady || tiempoDesdeUltimaConexion < 300);
  
  // NUEVA VALIDACIÓN: Verificar si existe sesión en PostgreSQL antes de permitir reconexión automática
  let tieneSesionEnBBDD = false;
  let sesionEdadDias = null;
  let sesionEdadHoras = null;
  
  if (!disponible && process.env.DATABASE_URL) {
    try {
      const resultSession = await executeQueryWithRetry(
        pool,
        'SELECT updated_at FROM whatsapp_sessions WHERE id = $1 LIMIT 1',
        ['RemoteAuth-capri-store-main'],
        1
      );
      
      if (resultSession && resultSession.rows && resultSession.rows.length > 0) {
        tieneSesionEnBBDD = true;
        const updatedAt = new Date(resultSession.rows[0].updated_at);
        sesionEdadHoras = (ahora - updatedAt) / (1000 * 60 * 60);
        sesionEdadDias = sesionEdadHoras / 24;
        console.log(`📊 Sesión en BBDD encontrada - Edad: ${sesionEdadHoras.toFixed(1)} horas (${sesionEdadDias.toFixed(1)} días)`);
      } else {
        console.log('📊 No hay sesión guardada en PostgreSQL');
      }
    } catch (dbError) {
      console.log('⚠️ Error verificando sesión en BBDD:', dbError.message);
    }
  }
  
  // sDeterminar si se puede permitir auto-reconexión: SOLO si sesión es del día actual (< 24 horas)
  const permitirAutoReconexion = tieneSesionEnBBDD && sesionEdadHoras !== null && sesionEdadHoras < 24;
  
  return {
    disponible,
    razon: disponible ? 'Disponible' : 
           !whatsappAvailable ? 'Módulo no cargado' :
           isNotInitialized ? 'WhatsApp no inicializado (usa /whatsapp-regenerar-qr)' :
           !serviceReady && tiempoDesdeUltimaConexion >= 300 ? 'No autenticado y sin conexión reciente' :
           'Estado desconocido',
    tiempoDesdeUltimaConexion,
    whatsappAvailable,
    whatsappReady: getWhatsAppReady(),
    permitirAutoReconexion,
    tieneSesionEnBBDD,
    sesionEdadDias
  };
}

// Función para marcar conexión exitosa
// Función para procesar notificaciones pendientes
async function procesarNotificacionesPendientes(reintentos = 0) {
  const timestamp = new Date().toISOString();
  
  try {
    console.log(`[${timestamp}] 🔍 DEBUG procesarNotificacionesPendientes - whatsappAvailable: ${whatsappAvailable}, whatsappReady: ${getWhatsAppReady()}, reintentos: ${reintentos}`);
    
    // OPTIMIZACIÓN: Verificar primero si WhatsApp está disponible SIN consultar BBDD
    // Solo si está disponible, entonces proceder a consultar notificaciones pendientes
    if (!whatsappAvailable || !getWhatsAppReady()) {
      // Si no está listo y es el primer intento, reintentar después de 10 segundos
      if (reintentos === 0) {
        console.log(`[${timestamp}] ⏳ WhatsApp no listo aún - reintentando en 10 segundos...`);
        setTimeout(() => {
          procesarNotificacionesPendientes(1);
        }, 10000);
        return;
      }
      console.log(`[${timestamp}] ⏭️ WhatsApp no disponible después de reintento - whatsappAvailable: ${whatsappAvailable}, whatsappReady: ${getWhatsAppReady()}`);
      return;
    }
    
    console.log(`[${timestamp}] ✅ WhatsApp disponible - verificando estado completo...`);
    
    // Si WhatsApp está disponible, ahora sí verificar estado completo (puede consultar BBDD si es necesario)
    const estadoWhatsApp = await verificarEstadoWhatsApp();
    console.log(`[${timestamp}] 🔍 Estado WhatsApp:`, estadoWhatsApp);
    
    if (!estadoWhatsApp.disponible) {
      console.log(`[${timestamp}] ⏭️ WhatsApp conectado pero no operativo: ${estadoWhatsApp.razon}`);
      return;
    }
    
    console.log(`[${timestamp}] ✅ WhatsApp operativo - buscando notificaciones pendientes...`);
    
    // Buscar productos con notificación pendiente
    const resultPendientes = await executeQueryWithRetry(
      pool,
      `SELECT 
        p.mp_payment_id, 
        p.id_pedido, 
        p.pedido_nombre_cliente, 
        p.pedido_telefono_cliente,
        p.pedido_monto_total,
        p.pedido_fecha,
        p.prenda,
        p.categoria,
        p.color,
        p.talle,
        p.precio_venta_efectivo,
        p.precio_venta_transferencia,
        p.pedido_tipo_entrega
       FROM productos p 
       WHERE p.estado LIKE '%Pendiente%' 
       AND p.whatsapp_notificado = 'False'
       AND p.pedido_fecha >= NOW() - INTERVAL '24 hours'
       ORDER BY p.pedido_fecha ASC, p.mp_payment_id, p.id_articulo 
       LIMIT 20`,
      [],
      2
    );
    
    console.log(`[${timestamp}] 🔍 DEBUG: Query ejecutada para notificaciones pendientes`);
    console.log(`[${timestamp}] 🔍 Resultado query:`, resultPendientes?.rows?.length || 0, 'registros encontrados');
    
    if (!resultPendientes || !resultPendientes.rows || resultPendientes.rows.length === 0) {
      console.log(`[${timestamp}] ✅ No hay notificaciones WhatsApp pendientes (últimas 24h)`);
      return;
    }
    
    console.log(`[${timestamp}] 📬 Procesando ${resultPendientes.rows.length} productos de notificaciones pendientes...`);
    
    // Agrupar productos por mp_payment_id para construir pedidos completos
    const pedidosMap = new Map();
    
    for (const producto of resultPendientes.rows) {
      const paymentId = producto.mp_payment_id;
      
      if (!pedidosMap.has(paymentId)) {
        // Crear nuevo pedido
        pedidosMap.set(paymentId, {
          mp_payment_id: producto.mp_payment_id,
          id_pedido: producto.id_pedido,
          pedido_nombre_cliente: producto.pedido_nombre_cliente,
          pedido_telefono_cliente: producto.pedido_telefono_cliente,
          pedido_monto_total: producto.pedido_monto_total,
          pedido_fecha: producto.pedido_fecha,
          pedido_tipo_entrega: producto.pedido_tipo_entrega,
          productos: []
        });
      }
      
      // Agregar producto al pedido
      pedidosMap.get(paymentId).productos.push({
        nombre: producto.prenda,
        categoria: producto.categoria,
        color: producto.color,
        talle: producto.talle,
        precio_efectivo: producto.precio_venta_efectivo,
        precio_transferencia: producto.precio_venta_transferencia,
        cantidad: 1 // Cada fila es un producto individual
      });
    }
    
    console.log(`[${timestamp}] 📋 Agrupados en ${pedidosMap.size} pedidos únicos`);
    
    // Agrupar productos idénticos y contar cantidad
    for (const pedido of pedidosMap.values()) {
      const productosAgrupados = new Map();
      
      for (const prod of pedido.productos) {
        const key = `${prod.nombre}-${prod.color}-${prod.talle}`;
        
        if (productosAgrupados.has(key)) {
          productosAgrupados.get(key).cantidad++;
        } else {
          productosAgrupados.set(key, { ...prod });
        }
      }
      
      pedido.productos = Array.from(productosAgrupados.values());
    }
    
    // Procesar cada pedido agrupado
    for (const pedido of pedidosMap.values()) {
      try {
        console.log(`[${timestamp}] 🔄 Reintentando notificación para pedido: ${pedido.id_pedido} (${pedido.productos.length} productos únicos)`);
        
        const customerData = {
          first_name: pedido.pedido_nombre_cliente?.split(' ')[0] || 'Cliente',
          last_name: pedido.pedido_nombre_cliente?.split(' ').slice(1).join(' ') || '',
          telefono: pedido.pedido_telefono_cliente, // ✅ Usar directo de BD
          phone: {
            area_code: pedido.pedido_telefono_cliente?.substring(2, 5) || '',
            number: pedido.pedido_telefono_cliente?.substring(5) || ''
          }
        };
        
        const orderData = {
          numeroDisplay: pedido.id_pedido?.slice(-2) || '??',
          idPedidoCompleto: pedido.id_pedido
        };
        
        const paymentInfo = {
          transaction_amount: pedido.pedido_monto_total || 0,
          id: pedido.mp_payment_id,
          additional_info: {
            items: pedido.productos.map(prod => ({
              id: `${prod.categoria}-${prod.nombre}`.replace(/\s+/g, '-').toLowerCase(),
              title: prod.nombre,
              category_id: prod.categoria,
              description: `${prod.nombre} - ${prod.color} - Talle ${prod.talle}`,
              quantity: prod.cantidad,
              unit_price: prod.precio_transferencia || prod.precio_efectivo || 0,
              type: 'product'
            }))
          },
          // Simular estructura de payer para compatibilidad
          payer: {
            first_name: customerData.first_name,
            last_name: customerData.last_name,
            phone: customerData.phone
          }
        };
        
        const resultado = await enviarNotificacionCompra(customerData, orderData, paymentInfo, true);
        
        // Actualizar estado según resultado
        await actualizarEstadoWhatsApp(pedido.mp_payment_id, resultado.success);
        
        if (resultado.success) {
          console.log(`[${timestamp}] ✅ Reintento exitoso para pedido: ${pedido.id_pedido}`);
        } else {
          console.log(`[${timestamp}] ❌ Reintento falló para pedido: ${pedido.id_pedido} - ${resultado.error}`);
        }
        
        // Delay entre envíos para evitar spam
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`[${timestamp}] ❌ Error procesando pedido ${pedido.id_pedido}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en procesarNotificacionesPendientes:`, error.message);
  }
}

// Función para actualizar el estado de notificación WhatsApp
async function actualizarEstadoWhatsApp(paymentId, estado) {
  const timestamp = new Date().toISOString();
  
  if (!paymentId) {
    console.warn(`[${timestamp}] ⚠️ No se puede actualizar estado WhatsApp: paymentId faltante`);
    return;
  }
  
  try {
    const estadoString = estado ? 'True' : 'False';
    
    await executeQueryWithRetry(
      pool,
      `UPDATE productos SET whatsapp_notificado = $1 WHERE mp_payment_id = $2`,
      [estadoString, paymentId],
      2
    );
    
    console.log(`[${timestamp}] ✅ Estado WhatsApp actualizado: ${estadoString} para payment_id: ${paymentId}`);
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error actualizando estado WhatsApp:`, error.message);
  }
}

async function enviarNotificacionCompra(customerData, orderData, paymentInfo, esReintento = false) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔔 === INICIANDO NOTIFICACIÓN DE COMPRA ===`);
  
  try {
    // Validación de parámetros críticos
    if (!customerData || typeof customerData !== 'object') {
      console.error(`[${timestamp}] ❌ customerData inválido:`, customerData);
      return { success: false, error: 'Datos de cliente inválidos' };
    }
    
    if (!orderData || typeof orderData !== 'object') {
      console.error(`[${timestamp}] ❌ orderData inválido:`, orderData);
      return { success: false, error: 'Datos de pedido inválidos' };
    }
    
    if (!paymentInfo || typeof paymentInfo !== 'object') {
      console.error(`[${timestamp}] ❌ paymentInfo inválido:`, paymentInfo);
      return { success: false, error: 'Información de pago inválida' };
    }
  
    // Log de estado de WhatsApp
    console.log(`[${timestamp}] 📱 Estado WhatsApp:`);
    console.log(`[${timestamp}] - whatsappAvailable: ${whatsappAvailable}`);
    console.log(`[${timestamp}] - whatsappReady flag: ${getWhatsAppReady()}`);
    console.log(`[${timestamp}] - ADMIN_WHATSAPP: ${ADMIN_WHATSAPP ? `${ADMIN_WHATSAPP.substring(0, 4)}****` : 'NO CONFIGURADO'}`);
    
    if (!whatsappAvailable) {
      console.error(`[${timestamp}] ❌ WhatsApp service no está disponible (no se pudo cargar el módulo)`);
      return { success: false, error: 'WhatsApp service no disponible' };
    }

  // VERIFICACIÓN MEJORADA: Usar sistema de flags inteligente
  const estadoWhatsApp = await verificarEstadoWhatsApp();
  
  console.log(`[${timestamp}] 🔍 Verificación mejorada en enviarNotificacionCompra:`);
  console.log(`[${timestamp}] - Disponible: ${estadoWhatsApp.disponible}`);
  console.log(`[${timestamp}] - Razón: ${estadoWhatsApp.razon}`);
  console.log(`[${timestamp}] - whatsappAvailable: ${estadoWhatsApp.whatsappAvailable}`);
  console.log(`[${timestamp}] - whatsappReady: ${estadoWhatsApp.whatsappReady}`);
  console.log(`[${timestamp}] - Tiempo desde última conexión: ${estadoWhatsApp.tiempoDesdeUltimaConexion}s`);

  if (!estadoWhatsApp.disponible) {
    console.error(`[${timestamp}] ❌ WhatsApp no está disponible:`);
    console.error(`[${timestamp}] - Razón: ${estadoWhatsApp.razon}`);
    console.error(`[${timestamp}] - whatsappAvailable: ${estadoWhatsApp.whatsappAvailable}`);
    console.error(`[${timestamp}] - whatsappReady: ${estadoWhatsApp.whatsappReady}`);
    return { success: false, error: `WhatsApp no disponible: ${estadoWhatsApp.razon}` };
  }

  if (!ADMIN_WHATSAPP) {
    console.error(`[${timestamp}] ❌ ADMIN_WHATSAPP no está configurado en variables de entorno`);
    return { success: false, error: 'Número de administrador no configurado' };
  }

  console.log(`[${timestamp}] 📋 Datos de la compra:`);
    
  // Extraer datos con valores por defecto seguros
  const { first_name = '', last_name = '', phone } = customerData || {};
  const nombre = first_name;
  const apellido = last_name;
  // CORREGIDO: Usar teléfono completo de la base de datos en lugar de reconstruir
  // El teléfono de la BD ya tiene el formato completo (ej: 5491165031329)
  const telefono = customerData?.telefono || 
    (phone ? 
      (typeof phone === 'string' ? phone : `${phone.area_code}${phone.number}`) : 
      '');
  
  const { numeroDisplay = 'N/A', idPedidoCompleto = 'N/A' } = orderData || {};
  const { transaction_amount = 0, id: paymentId = 'N/A' } = paymentInfo || {};
  
  console.log(`[${timestamp}] - Cliente: ${nombre} ${apellido}`);
  console.log(`[${timestamp}] - Teléfono: ${telefono || 'No proporcionado'}`);
  console.log(`[${timestamp}] - Teléfono RAW:`, phone);
  console.log(`[${timestamp}] - CustomerData completo:`, customerData);
  console.log(`[${timestamp}] - Pedido: ${numeroDisplay} (${idPedidoCompleto})`);
  console.log(`[${timestamp}] - Monto: $${transaction_amount}`);
  console.log(`[${timestamp}] - Payment ID: ${paymentId}`);
    
    const fechaHora = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Obtener productos del payment info con validación robusta
    const items = (paymentInfo && paymentInfo.additional_info && paymentInfo.additional_info.items) 
      ? paymentInfo.additional_info.items 
      : [];
      
    console.log(`[${timestamp}] 📦 Items de la compra: ${items.length} productos`);
    
    let productosTexto = '';
    if (Array.isArray(items) && items.length > 0) {
      if (esReintento) {
        // Para reintentos: solo mostrar nombres de productos
        productosTexto = items.map((item, index) => {
          const title = item?.title || 'Producto sin nombre';
          const quantity = item?.quantity || 1;
          
          console.log(`[${timestamp}] - Item ${index + 1}: ${title} x${quantity} (reintento simplificado)`);
          return quantity > 1 ? `• ${title} (${quantity})` : `• ${title}`;
        }).join('\n');
      } else {
        // Para compras nuevas: mostrar información completa
        productosTexto = items.map((item, index) => {
          const title = item?.title || 'Producto sin nombre';
          const quantity = item?.quantity || 1;
          const unit_price = item?.unit_price || 0;
          
          console.log(`[${timestamp}] - Item ${index + 1}: ${title} x${quantity} - $${unit_price}`);
          return `• ${title} x${quantity} - $${unit_price.toLocaleString('es-AR')}`;
        }).join('\n');
      }
    } else {
      console.log(`[${timestamp}] ⚠️ No se encontraron items válidos en paymentInfo`);
      productosTexto = '• Información de productos no disponible';
    }
    
    // Mensaje para administrador
    const businessName = BUSINESS_NAME || 'Tienda Online';
    
    // Mensaje base para el admin
    const tipoNotificacion = esReintento ? '🔄 *REINTENTO DE NOTIFICACIÓN*' : '🛒 *NUEVA COMPRA*';
    let mensajeAdmin = `${tipoNotificacion} - ${businessName}\n\n` +
      `👤 *Cliente:* ${nombre} ${apellido}\n` +
      `📱 *Teléfono:* ${telefono || 'No proporcionado'}\n` +
      `📅 *Fecha:* ${fechaHora}\n\n` +
      `🛍️ *Productos:*\n${productosTexto}\n\n` +
      `💰 *Total:* $${transaction_amount.toLocaleString('es-AR')}\n` +
      `🆔 *Pedido:* ${idPedidoCompleto}\n` +
      `💳 *Pago ID:* ${paymentId}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ *${esReintento ? 'Notificación reenviada al cliente automáticamente' : '¡Pago confirmado! Proceder con el envío'}*`;
    
    console.log(`[${timestamp}] 📝 Mensaje construido, enviando a: ${ADMIN_WHATSAPP}`);
    console.log(`[${timestamp}] 📄 Preview del mensaje: ${mensajeAdmin.substring(0, 200)}...`);
    
    // Normalizar número del administrador antes de enviar
    const adminNormalizado = normalizePhoneNumber(ADMIN_WHATSAPP);
    console.log(`[${timestamp}] 📱 Admin normalizado: ${adminNormalizado}`);
    
    // 1. ENVIAR NOTIFICACIÓN AL ADMINISTRADOR
    const resultAdmin = await enviarWhatsApp(adminNormalizado, mensajeAdmin);
    
    // Logging seguro del resultado para evitar [object Object]
    const safeMessageId = resultAdmin.messageId && typeof resultAdmin.messageId === 'object' 
      ? (resultAdmin.messageId._serialized || JSON.stringify(resultAdmin.messageId))
      : resultAdmin.messageId;
      
    console.log(`[${timestamp}] 📡 Resultado del envío al ADMIN:`, {
      success: resultAdmin.success,
      error: resultAdmin.error,
      messageId: safeMessageId
    });
    
    if (resultAdmin.success) {
      console.log(`[${timestamp}] ✅ Notificación al ADMINISTRADOR enviada exitosamente`);
    } else {
      console.error(`[${timestamp}] ❌ FALLO enviando notificación al administrador:`, resultAdmin.error);
    }
    
    // 2. ENVIAR CONFIRMACIÓN AL CLIENTE (siempre, tanto en compras nuevas como en reintentos)
    let resultCliente = { success: false, error: 'No se intentó enviar' };
    
    if (telefono && telefono.trim()) {
      console.log(`[${timestamp}] 📱 Enviando confirmación al cliente: ${telefono}`);
      
      // Mensaje para el cliente
      const mensajeCliente = `🎉 *¡Gracias por tu compra en ${businessName}!* 🎉\n\n` +
        `✅ *Tu pago ha sido procesado exitosamente*\n\n` +
        `📋 *Detalles de tu pedido:*\n` +
        `🆔 *Número:* ${numeroDisplay}\n` +
        `📅 *Fecha:* ${fechaHora}\n` +
        `💰 *Total:* $${transaction_amount.toLocaleString('es-AR')}\n\n` +
        `🛍️ *Productos:*\n${productosTexto}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📞 *Te contactaremos pronto para coordinar la entrega*\n\n` +
        `¡Gracias por elegirnos! 💜`;
      
      // Normalizar teléfono del cliente
      const clienteNormalizado = normalizePhoneNumber(telefono);
      console.log(`[${timestamp}] 📱 Cliente normalizado: ${clienteNormalizado}`);
      
      if (clienteNormalizado) {
        resultCliente = await enviarWhatsApp(clienteNormalizado, mensajeCliente);
        
        console.log(`[${timestamp}] 📡 Resultado del envío al CLIENTE:`, {
          success: resultCliente.success,
          error: resultCliente.error
        });
        
        if (resultCliente.success) {
          console.log(`[${timestamp}] ✅ Confirmación al CLIENTE enviada exitosamente`);
        } else {
          console.error(`[${timestamp}] ❌ FALLO enviando confirmación al cliente:`, resultCliente.error);
        }
      } else {
        console.error(`[${timestamp}] ❌ No se pudo normalizar teléfono del cliente: ${telefono}`);
        resultCliente = { success: false, error: 'Teléfono del cliente inválido' };
      }
    } else {
      console.warn(`[${timestamp}] ⚠️ No hay teléfono del cliente para enviar confirmación`);
    }
    
    // Retornar resultado combinado
    const resultado = {
      success: resultAdmin.success,
      admin_result: resultAdmin,
      cliente_result: resultCliente,
      both_sent: resultAdmin.success && resultCliente.success
    };
    
    // Si el envío fue exitoso, marcar conexión como buena y procesar pendientes
    if (resultado.success) {
      whatsappService.marcarConexionExitosa();
      
      // Procesar notificaciones pendientes en background
      setImmediate(async () => {
        try {
          await procesarNotificacionesPendientes();
        } catch (error) {
          console.error('Error procesando notificaciones pendientes:', error);
        }
      });
    }
    
    return resultado;
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ ERROR CRÍTICO en enviarNotificacionCompra:`, error.message);
    console.error(`[${timestamp}] Stack trace:`, error.stack);
    return { success: false, error: error.message, stack: error.stack };
  }
}

// ===============================
// ENDPOINT: WEBHOOK DE MERCADO PAGO
// ===============================
app.post('/webhook', async (req, res) => {
  const timestamp = new Date().toISOString();
  let paymentId = null;
  let shouldProcess = false;

  console.log(`[${timestamp}] 📬 WEBHOOK RECIBIDO:`);
  // Headers omitidos para reducir logs - solo mostrar info relevante
  console.log(`[${timestamp}] User-Agent: ${req.headers['user-agent']}`);
  console.log(`[${timestamp}] Body:`, JSON.stringify(req.body, null, 2));

  try {
    const { type, data, action, topic, resource } = req.body;
    
    // Detectar el payment ID desde diferentes formatos de webhook
    if (type === 'payment' && data?.id) {
      paymentId = data.id;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook tipo 'payment' con ID: ${paymentId}`);
    } else if (action === 'payment.created' && data?.id) {
      paymentId = data.id;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook action 'payment.created' con ID: ${paymentId}`);
    } else if (topic === 'payment' && resource) {
      paymentId = resource;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook topic 'payment' con resource: ${paymentId}`);
    } else {
      console.log(`[${timestamp}] ⚠️ Webhook ignorado - type: ${type}, action: ${action}, topic: ${topic}, resource: ${resource}`);
      return res.status(200).send('OK - Ignored (not payment)');
    }

    if (shouldProcess && paymentId) {
      // Verificar si ya existe el pedido en BD
      let pedidoExistente = null;
      try {
        const checkPedido = await executeQueryWithRetry(
          pool,
          `SELECT id_pedido FROM productos WHERE (mp_payment_id = $1 OR mp_payment_id = $2) AND id_pedido IS NOT NULL AND id_pedido != '' LIMIT 1`,
          [paymentId, paymentId.toString()],
          2
        );
        if (checkPedido && checkPedido.rows && checkPedido.rows.length > 0) {
          pedidoExistente = checkPedido.rows[0].id_pedido;
          console.log(`[${timestamp}] ✅ Pago ${paymentId} ya tiene pedido en BD: ${pedidoExistente} - Ignorado`);
          return res.status(200).send('OK - Already processed');
        }
      } catch (err) {
        console.error(`[${timestamp}] ⚠️ Error al verificar pedido existente:`, err.message);
      }

      // Verificar en memoria si ya se procesó
      if (webhookNotifications.has(paymentId)) {
        console.log(`[${timestamp}] ⚠️ Pago ${paymentId} ya procesado en memoria - Ignorado`);
        return res.status(200).send('OK - Already processed (memory)');
      }

      // Marcar como procesado en memoria
      webhookNotifications.set(paymentId, true);

      // Obtener información completa del pago de MercadoPago
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });

      console.log(`[${timestamp}] 💳 Estado del pago: ${paymentInfo.status}`);

      if (paymentInfo.status === 'approved') {
        // NUEVO: Verificar y reconectar WhatsApp si es necesario
        console.log(`[${timestamp}] 🔄 Verificando estado de WhatsApp para nueva venta...`);
        try {
          const estadoWhatsApp = await verificarEstadoWhatsApp();
          console.log(`[${timestamp}] - WhatsApp disponible: ${estadoWhatsApp.disponible}`);
          console.log(`[${timestamp}] - Razón: ${estadoWhatsApp.razon}`);
          
          if (!estadoWhatsApp.disponible && estadoWhatsApp.permitirAutoReconexion) {
            console.log(`[${timestamp}] 🔌 WhatsApp desconectado pero hay sesión válida - Reconectando...`);
            try {
              await inicializarWhatsApp();
              console.log(`[${timestamp}] ✅ WhatsApp reconectado exitosamente`);
              // Esperar 3 segundos para que se estabilice
              await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (reconnectError) {
              console.error(`[${timestamp}] ❌ Error reconectando WhatsApp:`, reconnectError.message);
              console.log(`[${timestamp}] ⚠️ Notificación quedará pendiente para reintento`);
            }
          } else if (!estadoWhatsApp.disponible) {
            console.log(`[${timestamp}] ⚠️ WhatsApp no disponible y sin sesión válida para auto-reconectar`);
            console.log(`[${timestamp}] 💡 Notificación quedará como pendiente para cuando WhatsApp se conecte`);
          }
        } catch (estadoError) {
          console.error(`[${timestamp}] ⚠️ Error verificando estado WhatsApp:`, estadoError.message);
        }
        
        // Extraer datos del comprador desde metadata o payer
        let customerData = {};
        try {
          if (paymentInfo.metadata) {
            customerData = {
              nombre: paymentInfo.payer?.first_name || '',
              apellido: paymentInfo.payer?.last_name || '',
              telefono: paymentInfo.metadata.telefono || paymentInfo.payer?.phone?.number || ''
            };
          }
        } catch (error) {
          console.error(`[${timestamp}] ⚠️ Error extrayendo customer data:`, error.message);
        }

        // Extraer IDs de productos
        let productIds = '';
        const items = paymentInfo.additional_info?.items || [];
        if (items.length > 0) {
          productIds = items.map(item => item.id).filter(Boolean).join(',');
        }
        if (!productIds) productIds = 'MANUAL';

        console.log(`[${timestamp}] 📦 Productos: ${productIds}`);

        // Verificar stock de productos
        let idsArray = [];
        if (productIds !== 'MANUAL') {
          idsArray = productIds.split(',').map(id => id.trim()).filter(Boolean);
        }

        let faltantes = [];
        if (idsArray.length > 0 && pool) {
          try {
            const placeholders = idsArray.map((_, i) => `$${i + 1}`).join(',');
            const query = `SELECT id_articulo FROM productos WHERE id_articulo IN (${placeholders}) AND estado != 'Disponible'`;
            const result = await executeQueryWithRetry(pool, query, idsArray, 2);
            faltantes = result.rows.map(row => row.id_articulo);
          } catch (error) {
            console.error(`[${timestamp}] ⚠️ Error verificando stock:`, error.message);
            // En caso de error, asumir que todos están disponibles para no perder la venta
          }
        }

        if (faltantes.length > 0) {
          console.log(`[${timestamp}] ⚠️ Productos sin stock: ${faltantes.join(', ')}`);
          // Enviar notificación de productos no disponibles
          if (whatsappAvailable && whatsappReady && ADMIN_WHATSAPP) {
            try {
              const mensaje = `⚠️ *PROBLEMA CON COMPRA*\n\n` +
                `💳 Pago ID: ${paymentId}\n` +
                `💰 Monto: $${paymentInfo.transaction_amount}\n` +
                `📦 Productos sin stock: ${faltantes.join(', ')}\n\n` +
                `👤 Cliente: ${customerData.nombre} ${customerData.apellido}\n` +
                ` Tel: ${customerData.telefono}\n\n` +
                `⚠️ No se creó el pedido automáticamente. Revisar y contactar al cliente.`;
              
              await enviarWhatsApp(ADMIN_WHATSAPP, mensaje);
            } catch (whatsappError) {
              console.error(`[${timestamp}] ❌ Error enviando WhatsApp:`, whatsappError.message);
            }
          }
        } else {
          // Crear pedido en la base de datos
          console.log(`[${timestamp}] 📝 Creando pedido en BD...`);
          
          try {
            // Llamar al stored procedure para crear el pedido
            await executeQueryWithRetry(
              pool,
              'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
              [
                productIds,
                paymentInfo.transaction_amount,
                paymentInfo.payer?.first_name || 'Cliente Web',
                'cliente@whatsapp.temp', // Email temporal ya que no usamos email
                customerData.telefono || paymentInfo.payer?.phone?.number || '',
                'MercadoPago',
                'Retiro', // Tipo de entrega por defecto
                paymentId
              ],
              2
            );

            // Obtener el ID del pedido creado
            const pedidoResult = await executeQueryWithRetry(
              pool,
              `SELECT id_pedido FROM productos WHERE (mp_payment_id = $1 OR mp_payment_id = $2) AND id_pedido IS NOT NULL AND id_pedido != '' ORDER BY pedido_fecha DESC LIMIT 1`,
              [paymentId, paymentId.toString()],
              2
            );

            if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
              const idPedidoCompleto = pedidoResult.rows[0].id_pedido;
              const numeroDisplay = idPedidoCompleto && idPedidoCompleto.length >= 2 ? 
                idPedidoCompleto.slice(-2) : idPedidoCompleto;

              console.log(`[${timestamp}] ✅ Pedido creado exitosamente: ${idPedidoCompleto} (Display: ${numeroDisplay})`);

              // Enviar notificación de compra por WhatsApp
              console.log(`[${timestamp}] 📱 Intentando enviar notificación WhatsApp...`);
              console.log(`[${timestamp}] - whatsappAvailable: ${whatsappAvailable}`);
              console.log(`[${timestamp}] - whatsappReady flag: ${whatsappReady}`);
              
              // MEJORA: Esperar un poco si WhatsApp se está inicializando
              if (whatsappAvailable && !whatsappReady) {
                console.log(`[${timestamp}] ⏳ WhatsApp disponible pero no listo, esperando 3 segundos...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
              }
              
              // NUEVO: Verificar estado real del cliente, no solo el flag
              let realClientState = null;
              let canSendWhatsApp = false;
              
              if (whatsappAvailable) {
                // ESTRATEGIA SIMPLIFICADA: Si WhatsApp está disponible, intentar envío directamente
                // Evitar verificaciones que pueden interrumpir conexiones activas
                console.log(`[${timestamp}] � WhatsApp disponible, asumiendo conexión activa`);
                canSendWhatsApp = true;
                realClientState = 'ASSUMED_CONNECTED';
                
                console.log(`[${timestamp}] 🔍 Verificación estado real:`);
                console.log(`[${timestamp}] - Flag whatsappReady: ${whatsappReady}`);
                console.log(`[${timestamp}] - Estado asumido: ${realClientState}`);
                console.log(`[${timestamp}] - Puede enviar: ${canSendWhatsApp}`);
              }
              
              if (whatsappAvailable && canSendWhatsApp) {
                console.log(`[${timestamp}] ✅ WhatsApp disponible, enviando notificación...`);
                try {
                  const notificationResult = await enviarNotificacionCompra(
                    customerData,
                    { numeroDisplay, idPedidoCompleto },
                    paymentInfo
                  );
                  
                  console.log(`[${timestamp}] 📨 Resultado notificación:`, {
                    success: notificationResult.success,
                    error: notificationResult.error
                  });
                  
                  // Actualizar estado en base de datos
                  await actualizarEstadoWhatsApp(paymentId, notificationResult.success);
                  
                } catch (whatsappError) {
                  console.error(`[${timestamp}] ❌ EXCEPCIÓN enviando notificación WhatsApp:`, whatsappError.message);
                  console.error(`[${timestamp}] Stack trace:`, whatsappError.stack);
                  
                  // Marcar como fallido en base de datos
                  await actualizarEstadoWhatsApp(paymentId, false);
                }
              } else {
                console.warn(`[${timestamp}] ⚠️ WhatsApp no disponible para notificación:`);
                console.warn(`[${timestamp}] - whatsappAvailable: ${whatsappAvailable}`);
                console.warn(`[${timestamp}] - whatsappReady flag: ${whatsappReady}`);
                console.warn(`[${timestamp}] - Estado real cliente: ${realClientState}`);
                console.warn(`[${timestamp}] - Puede enviar calculado: ${canSendWhatsApp}`);
                
                // Marcar como no enviado
                await actualizarEstadoWhatsApp(paymentId, false);
                
                // Intentar envío forzado si el cliente está CONNECTED pero el flag es false
                if (whatsappAvailable && realClientState === 'CONNECTED' && !whatsappReady) {
                  console.log(`[${timestamp}] 🔄 INTENTO FORZADO: Cliente CONNECTED pero flag false`);
                  try {
                    const forceResult = await enviarNotificacionCompra(
                      customerData,
                      { numeroDisplay, idPedidoCompleto },
                      paymentInfo
                    );
                    console.log(`[${timestamp}] 🚀 Resultado envío forzado:`, forceResult);
                    
                    // Actualizar estado según resultado del envío forzado
                    await actualizarEstadoWhatsApp(paymentId, forceResult.success);
                    
                  } catch (forceError) {
                    console.error(`[${timestamp}] ❌ Error en envío forzado:`, forceError.message);
                    // El estado ya se marcó como false arriba
                  }
                }
              }
            } else {
              console.error(`[${timestamp}] ⚠️ Pedido no encontrado después de crearlo`);
            }

          } catch (error) {
            console.error(`[${timestamp}] ❌ Error creando pedido:`, error.message);
            console.error(`[${timestamp}] Stack:`, error.stack);
          }
        }
      } else {
        console.log(`[${timestamp}] ⚠️ Pago ${paymentId} no aprobado (estado: ${paymentInfo.status})`);
      }
    } else {
      console.log(`[${timestamp}] ⚠️ Webhook recibido sin paymentId válido`);
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en webhook:`, error.message);
    console.error(`[${timestamp}] Stack:`, error.stack);
    res.status(500).send('Error interno del servidor');
  }
});

// ===============================
// ENDPOINT: CONSULTAR NÚMERO DE PEDIDO POR PAYMENT ID
// ===============================
app.get('/numero-pedido/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  console.log(`🔍 Consultando número de pedido para payment ID: ${paymentId}`);

  // Configuración de reintentos
  const MAX_TRIES = 5;
  const RETRY_DELAY_MS = 2000; // 2 segundos
  let intento = 0;
  let pedidoEncontrado = null;

  try {
    while (intento < MAX_TRIES && !pedidoEncontrado) {
      intento++;
      console.log(`🔄 Intento ${intento}/${MAX_TRIES} para payment ID: ${paymentId}`);

      try {
        const pedidoResult = await executeQueryWithRetry(
          pool,
          `SELECT p.id_pedido, p.pedido_fecha, p.pedido_nombre_cliente, p.pedido_monto_total, p.mp_payment_id 
           FROM productos p 
           WHERE (p.mp_payment_id = $1 OR p.mp_payment_id = $2) 
           AND p.id_pedido IS NOT NULL 
           AND p.id_pedido != '' 
           ORDER BY p.pedido_fecha DESC 
           LIMIT 1`,
          [paymentId, paymentId.toString()],
          2
        );

        if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
          pedidoEncontrado = pedidoResult.rows[0];
          break;
        }
      } catch (err) {
        console.error(`❌ Error al consultar pedido (intento ${intento}):`, err.message);
      }

      // Si no se encontró y quedan intentos, esperar antes de reintentar
      if (!pedidoEncontrado && intento < MAX_TRIES) {
        console.log(`⏳ Esperando ${RETRY_DELAY_MS}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    if (pedidoEncontrado) {
      const numeroDisplay = pedidoEncontrado.id_pedido && pedidoEncontrado.id_pedido.length >= 2 ?
        pedidoEncontrado.id_pedido.slice(-2) : pedidoEncontrado.id_pedido;

      console.log(`✅ Pedido encontrado: ${pedidoEncontrado.id_pedido} (Display: ${numeroDisplay})`);

      res.json({
        success: true,
        pedido_encontrado: true,
        numero_pedido: pedidoEncontrado.id_pedido,
        numero_display: numeroDisplay,
        fecha: pedidoEncontrado.pedido_fecha,
        cliente: pedidoEncontrado.pedido_nombre_cliente,
        monto: pedidoEncontrado.pedido_monto_total,
        payment_id: paymentId
      });
    } else {
      console.warn(`⚠️ Pedido no encontrado para payment_id: ${paymentId} después de ${MAX_TRIES} intentos`);
      
      res.json({
        success: false,
        pedido_encontrado: false,
        numero_pedido: null,
        message: 'Pedido no encontrado. Es posible que aún se esté procesando.',
        payment_id: paymentId,
        intentos_realizados: MAX_TRIES
      });
    }
  } catch (error) {
    console.error('❌ Error en /numero-pedido:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      payment_id: paymentId
    });
  }
});

// ===============================
// ENDPOINT TEMPORAL: Reintento manual de notificación WhatsApp
// ===============================
app.get('/reintento-whatsapp/:paymentId', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { paymentId } = req.params;
  
  console.log(`[${timestamp}] 🔄 === REINTENTO MANUAL WHATSAPP ===`);
  console.log(`[${timestamp}] 📱 Payment ID: ${paymentId}`);
  
  try {
    // Verificar estado de WhatsApp
    const estadoWhatsApp = await verificarEstadoWhatsApp();
    console.log(`[${timestamp}] 📊 Estado WhatsApp: ${JSON.stringify(estadoWhatsApp, null, 2)}`);
    
    if (!estadoWhatsApp.disponible) {
      return res.json({
        success: false,
        error: `WhatsApp no disponible: ${estadoWhatsApp.razon}`,
        estado_whatsapp: estadoWhatsApp
      });
    }
    
    // Buscar la compra en la BD
    const resultCompra = await executeQueryWithRetry(
      pool,
      `SELECT 
        p.mp_payment_id, 
        p.id_pedido, 
        p.pedido_nombre_cliente, 
        p.pedido_telefono_cliente,
        p.pedido_monto_total,
        p.pedido_fecha,
        p.whatsapp_notificado,
        p.estado
       FROM productos p 
       WHERE p.mp_payment_id = $1`,
      [paymentId],
      2
    );
    
    if (!resultCompra || !resultCompra.rows || resultCompra.rows.length === 0) {
      return res.json({
        success: false,
        error: 'Compra no encontrada',
        payment_id: paymentId
      });
    }
    
    const compra = resultCompra.rows[0];
    console.log(`[${timestamp}] 📦 Compra encontrada:`, {
      id_pedido: compra.id_pedido,
      cliente: compra.pedido_nombre_cliente,
      whatsapp_notificado: compra.whatsapp_notificado,
      estado: compra.estado
    });
    
    // Preparar datos para envío
    const customerData = {
      first_name: compra.pedido_nombre_cliente?.split(' ')[0] || 'Cliente',
      last_name: compra.pedido_nombre_cliente?.split(' ').slice(1).join(' ') || '',
      phone: {
        area_code: compra.pedido_telefono_cliente?.substring(2, 5) || '',
        number: compra.pedido_telefono_cliente?.substring(5) || ''
      }
    };
    
    const orderData = {
      numeroDisplay: compra.id_pedido?.slice(-2) || '??',
      idPedidoCompleto: compra.id_pedido
    };
    
    const paymentInfo = {
      transaction_amount: compra.pedido_monto_total || 0,
      id: paymentId
    };
    
    console.log(`[${timestamp}] 📨 Intentando envío WhatsApp...`);
    
    // Enviar notificación
    const resultado = await enviarNotificacionCompra(customerData, orderData, paymentInfo);
    
    console.log(`[${timestamp}] 📡 Resultado envío:`, {
      success: resultado.success,
      error: resultado.error
    });
    
    // Actualizar estado en BD
    const estadoAnterior = compra.whatsapp_notificado;
    await actualizarEstadoWhatsApp(paymentId, resultado.success);
    const estadoNuevo = resultado.success ? 'True' : 'False';
    
    console.log(`[${timestamp}] 💾 Estado actualizado: ${estadoAnterior} → ${estadoNuevo}`);
    
    res.json({
      success: true,
      reintento_exitoso: resultado.success,
      payment_id: paymentId,
      id_pedido: compra.id_pedido,
      cliente: compra.pedido_nombre_cliente,
      estado_anterior: estadoAnterior,
      estado_nuevo: estadoNuevo,
      resultado_envio: resultado,
      timestamp: timestamp
    });
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en reintento WhatsApp:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Error interno en reintento',
      message: error.message,
      payment_id: paymentId,
      timestamp: timestamp
    });
  }
});

// ===============================
// ENDPOINT TEMPORAL: Forzar reinicialización completa de WhatsApp
// ===============================
app.post('/whatsapp-force-restart', async (req, res) => {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] 🔥 === FORZAR REINICIO COMPLETO WHATSAPP ===`);
  
  try {
    // 1. Limpiar sesión PostgreSQL
    console.log(`[${timestamp}] 🧹 Paso 1: Limpiando sesión PostgreSQL...`);
    await limpiarSesionPostgreSQL();
    
    // 2. Resetear contador QR
    console.log(`[${timestamp}] 🔄 Paso 2: Reseteando contador QR...`);
    await resetearContadorQR();
    
    // 3. Forzar reconexión
    console.log(`[${timestamp}] 🔌 Paso 3: Forzando reconexión...`);
    const reconexionResult = await forzarReconexion();
    
    // 4. Reinicializar WhatsApp
    console.log(`[${timestamp}] 🚀 Paso 4: Reinicializando WhatsApp...`);
    await inicializarWhatsApp();
    
    console.log(`[${timestamp}] ✅ Reinicio completo solicitado - Monitorear logs para QR`);
    
    res.json({
      success: true,
      message: 'Reinicio completo de WhatsApp iniciado',
      pasos_ejecutados: [
        'Limpieza sesión PostgreSQL',
        'Reset contador QR', 
        'Forzar reconexión',
        'Reinicialización WhatsApp'
      ],
      instrucciones: 'Monitorear logs del servidor para ver el nuevo código QR',
      timestamp: timestamp
    });
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en reinicio completo:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Error en reinicio completo',
      message: error.message,
      timestamp: timestamp
    });
  }
});

// ===============================
// ENDPOINT: LIMPIAR SESIONES WHATSAPP EN BD
// ===============================
app.post('/limpiar-sesiones-whatsapp', async (req, res) => {
  console.log('🧹 Solicitud de limpieza de sesiones WhatsApp');
  
  try {
    // Validar que hay conexión a BD
    if (!pool) {
      console.error('❌ No hay conexión a base de datos');
      return res.status(500).json({
        success: false,
        error: 'Base de datos no disponible'
      });
    }
    
    // Consultar sesiones actuales ANTES de limpiar
    const beforeQuery = await pool.query(`
      SELECT id, LENGTH(session_data) as tamaño_bytes, created_at, updated_at 
      FROM whatsapp_sessions
      ORDER BY id
    `);
    
    console.log('📊 Sesiones ANTES de limpiar:', beforeQuery.rows.length);
    beforeQuery.rows.forEach(row => {
      const isCorrupt = row.tamaño_bytes < 1000;
      console.log(`  - ${row.id}: ${row.tamaño_bytes} bytes ${isCorrupt ? '❌ CORRUPTA' : '✅ VÁLIDA'}`);
    });
    
    // Llamar al stored procedure para limpiar
    console.log('🔧 Ejecutando sp_limpiar_sesiones_whatsapp()...');
    await pool.query('CALL sp_limpiar_sesiones_whatsapp()');
    
    // Verificar resultado
    const afterQuery = await pool.query('SELECT COUNT(*) as count FROM whatsapp_sessions');
    const sesionesRestantes = parseInt(afterQuery.rows[0].count, 10);
    
    console.log('✅ Limpieza completada');
    console.log(`📊 Sesiones DESPUÉS de limpiar: ${sesionesRestantes}`);
    
    res.json({
      success: true,
      message: 'Sesiones de WhatsApp limpiadas exitosamente',
      sesiones_antes: beforeQuery.rows.length,
      sesiones_despues: sesionesRestantes,
      sesiones_eliminadas: beforeQuery.rows.length - sesionesRestantes,
      detalle_antes: beforeQuery.rows.map(row => ({
        id: row.id,
        tamaño_bytes: row.tamaño_bytes,
        estado: row.tamaño_bytes < 1000 ? 'CORRUPTA' : 'VÁLIDA',
        created_at: row.created_at,
        updated_at: row.updated_at
      })),
      siguiente_paso: 'Reinicia el servidor o espera que Render redeploy automáticamente. Luego escanea el QR.'
    });
    
  } catch (error) {
    console.error('❌ Error limpiando sesiones WhatsApp:', error.message);
    console.error('Stack:', error.stack);
    
    // Verificar si el error es porque el SP no existe
    if (error.message.includes('does not exist') || error.message.includes('no existe')) {
      return res.status(500).json({
        success: false,
        error: 'El stored procedure sp_limpiar_sesiones_whatsapp no existe en la base de datos',
        solucion: 'Ejecuta el script database/sp_limpiar_sesiones_whatsapp.sql en la consola de Neon',
        detalles: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Error al limpiar sesiones',
      detalles: error.message
    });
  }
});

// Función simplificada para optimización de memoria
function setupMemoryOptimization() {
  console.log('🧹 Configurando optimización de memoria...');
  
  // Limpiar memoria cada 5 minutos
  setInterval(() => {
    try {
      // Forzar garbage collection si está disponible
      if (global.gc) {
        const memBefore = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        global.gc();
        const memAfter = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        console.log(`🧹 GC: ${memBefore}MB → ${memAfter}MB (liberados ${memBefore - memAfter}MB)`);
      }
      
      // Limpiar notificaciones webhook antiguas (más de 1 hora)
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      let cleaned = 0;
      for (const [key, timestamp] of webhookNotifications.entries()) {
        if (typeof timestamp === 'number' && timestamp < oneHourAgo) {
          webhookNotifications.delete(key);
          cleaned++;
        } else if (typeof timestamp !== 'number') {
          webhookNotifications.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`🧹 Limpiadas ${cleaned} notificaciones webhook antiguas`);
      }
      
      const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const memPercent = Math.round((memUsage / 512) * 100);
      console.log(`🧹 Memoria: ${memUsage}MB / 512MB (${memPercent}%)`);
      
    } catch (error) {
      console.log('🧹 Optimización de memoria completada');
    }
  }, 300000); // 5 minutos
}

// Inicializar la aplicación (simplificado)
async function startServer() {
  try {
    // Intentar inicializar la base de datos, pero no fallar si no está disponible
    try {
      await initializeDatabase();
      console.log('✅ Base de datos conectada');
    } catch (error) {
      console.warn('⚠️ Base de datos no disponible:', error.message);
      console.log('🔄 Continuando sin base de datos (solo modo estático)');
    }
    
    // Inicializar WhatsApp si está disponible
    if (whatsappAvailable) {
      console.log('📱 Inicializando servicio WhatsApp...');
      
      // Detectar reinicios y verificar estado previo
      const ahora = new Date();
      const ultimaConexion = whatsappService.ultimaConexionExitosa;
      const tiempoDesdeUltimaConexion = ultimaConexion ? 
        Math.floor((ahora - ultimaConexion) / 1000) : 999;
      
      if (ultimaConexion && tiempoDesdeUltimaConexion < 300) {
        console.log(`⚡ REINICIO DETECTADO: Última conexión hace ${tiempoDesdeUltimaConexion}s`);
        console.log('🔍 Validando estado de WhatsApp antes de reconectar...');
      }
      
      // CAMBIO: NO inicializar WhatsApp automáticamente para ahorrar memoria
      // Solo se inicializará cuando se use el endpoint /whatsapp-regenerar-qr
      console.log('💾 OPTIMIZACIÓN: WhatsApp se inicializará bajo demanda para ahorrar memoria');
      console.log('📡 Usa /whatsapp-regenerar-qr para inicializar WhatsApp cuando lo necesites');
      
      // Marcar como disponible pero no inicializado
      whatsappAvailable = true;
    } else {
      console.log('⚠️ WhatsApp no disponible');
    }
    
    // Configurar optimización de memoria
    setupMemoryOptimization();
    
    // Iniciar servidor siempre, independientemente de otros servicios
    const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    server = app.listen(PORT, HOST, () => {
      console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
      console.log(`🚀 Capri Store API escuchando en puerto ${PORT}`);
      console.log(`🌐 Host: ${HOST}:${PORT}`);
      console.log(`🌐 URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
      
      // Estado de WhatsApp más preciso
      if (whatsappAvailable) {
        console.log(`📱 WhatsApp: Inicializando (esperando autenticación)`);
      } else {
        console.log(`📱 WhatsApp: No disponible`);
      }
      
      console.log(`🗄️ Base de datos: ${pool ? 'Conectada' : 'No disponible'}`);
      console.log(`⚙️ Sistema: Simplificado - Una sola instancia con PostgreSQL sessions`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      // Iniciar sistema de reintentos de notificaciones WhatsApp
      console.log(`🔄 Configurando sistema de reintentos WhatsApp...`);
      console.log(`📊 Sistema de tracking WhatsApp v2.1 - Con regeneración segura de QR`);
      
      // Procesar notificaciones pendientes cada 3 minutos
      setInterval(async () => {
        try {
          await procesarNotificacionesPendientes();
        } catch (error) {
          console.error('❌ Error en procesamiento automático de notificaciones:', error.message);
        }
      }, 3 * 60 * 1000); // 3 minutos
      
      if (whatsappAvailable) {
        console.log(`📱 Si WhatsApp no conectó automáticamente, usa: /whatsapp-regenerar-qr`);
      }
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      // Procesar una vez al inicio - timeout ajustado según antigüedad de sesión
      const initialWaitTime = sessionIsOld ? 30 * 1000 : 50 * 1000; // 30s para sesión antigua, 50s para reciente
      console.log(`⏰ Tiempo de espera inicial: ${sessionIsOld ? '30s (sesión antigua)' : '50s (sesión reciente)'}`);
      
      setTimeout(async () => {
        console.log('🔄 Procesamiento inicial de notificaciones pendientes...');
        
        // Doble verificación: esperar a que WhatsApp esté realmente listo
        let intentos = 0;
        const maxIntentos = sessionIsOld ? 2 : 3; // Menos intentos si sesión antigua
        
        while (intentos < maxIntentos) {
          const estadoWhatsApp = await verificarEstadoWhatsApp();
          if (estadoWhatsApp.disponible) {
            console.log('✅ WhatsApp confirmado disponible para procesamiento inicial');
            break;
          }
          console.log(`⏳ Esperando WhatsApp... intento ${intentos + 1}/${maxIntentos} (${estadoWhatsApp.razon})`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar 5 segundos
          intentos++;
        }
        
        // Si tras los intentos no está disponible, sugerir regenerar QR
        const estadoFinal = await verificarEstadoWhatsApp();
        if (!estadoFinal.disponible) {
          console.log('\n⚠️ ═══════════════════════════════════════════════════════');
          console.log(`⚠️ WhatsApp no conectó tras espera de ${maxIntentos * 5}s`);
          if (sessionIsOld) {
            console.log('⚠️ La sesión guardada es antigua (>24h)');
            console.log('⚠️ Probablemente expiró y necesita renovarse');
          }
          console.log('💡 SOLUCIÓN: Regenerar QR con:');
          console.log('   GET https://capri-store.onrender.com/whatsapp-regenerar-qr');
          console.log('   PowerShell: Invoke-RestMethod -Uri "https://capri-store.onrender.com/whatsapp-regenerar-qr" -Method GET');
          console.log('⚠️ ═══════════════════════════════════════════════════════\n');
        }
        
        try {
          await procesarNotificacionesPendientes();
        } catch (error) {
          console.error('❌ Error en procesamiento inicial:', error.message);
        }
      }, initialWaitTime);
      
      if (whatsappAvailable) {
        console.log(`📲 Usa WhatsApp > Dispositivos Vinculados > Vincular`);
      }
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    });
    
  } catch (error) {
    console.error('❌ Error crítico al iniciar servidor:', error);
    
    // Intentar iniciar servidor básico aunque haya errores
    try {
      const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
      server = app.listen(PORT, HOST, () => {
        console.log(`🚨 Servidor en modo de emergencia en puerto ${PORT}`);
        console.log(`🌐 Host: ${HOST}:${PORT}`);
        console.log(`⚠️ Algunos servicios pueden no estar disponibles`);
      });
    } catch (criticalError) {
      console.error('💥 Error crítico - No se puede iniciar el servidor:', criticalError);
      process.exit(1);
    }
  }
}

startServer();