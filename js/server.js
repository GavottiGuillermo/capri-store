// Obtener solo el primer número de admin para uso público (botón WhatsApp)
function getPrimaryAdminNumber() {
  const admins = getAdminNumbers();
  return admins.length > 0 ? admins[0] : '';
}
const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');

const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno antes de inicializar servicios dependientes
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const whatsappApiService = require('./whatsapp-api-service');

const DEFAULT_DB_SCHEMA = process.env.DB_SCHEMA || 'public';
const DB_SCHEMA = sanitizeIdentifier(DEFAULT_DB_SCHEMA, 'public');
const PRODUCTOS_TABLE = qualifyTable('productos');

// Optional DB objects (may remain null in stateless mode)
let pool = null;

// Stub for initializeDatabase - will throw if DATABASE_URL not configured
async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('No DATABASE_URL configured');
  }
  
  // Crear pool de conexiones PostgreSQL
  console.log('🔌 Inicializando conexión a PostgreSQL...');
  console.log('🏷️ Esquema PostgreSQL seleccionado:', DB_SCHEMA);
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Necesario para Render/Neon
    },
    max: 20, // máximo 20 conexiones
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  
  // Verificar conexión
  const client = await pool.connect();
  console.log('✅ Conexión PostgreSQL establecida');
  client.release();
  
  return pool;
}

function sanitizeIdentifier(value, fallback) {
  const fallbackIdentifier = fallback || 'public';
  if (!value || typeof value !== 'string') {
    return fallbackIdentifier;
  }
  const trimmed = value.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_]/g, '');
  return safe || fallbackIdentifier;
}

function qualifyTable(tableName) {
  const safeTable = sanitizeIdentifier(tableName, tableName);
  return `"${DB_SCHEMA}"."${safeTable}"`;
}

// SYSTEM SIMPLIFIED: PostgreSQL session persistence working perfectly - v4.0

// === CONFIGURACIÓN WHATSAPP API ÚNICAMENTE ===
console.log('📱 Usando WhatsApp Cloud API como único medio de comunicación');

const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP;
// Número para consultas desde la web (DEBE ser diferente al número de la API)
// IMPORTANTE: ADMIN_WHATSAPP es el número de la API Cloud (no accesible para chatear)
// CONSULTAS_WHATSAPP debe apuntar a un número real al que el cliente pueda escribir
const CONSULTAS_WHATSAPP = process.env.CONSULTAS_WHATSAPP; // NO fallback a ADMIN_WHATSAPP
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';

// Permitir múltiples administradores: separar por coma o punto y coma
function getAdminNumbers() {
  if (!ADMIN_WHATSAPP) return [];
  if (Array.isArray(ADMIN_WHATSAPP)) return ADMIN_WHATSAPP;
  return String(ADMIN_WHATSAPP)
    .split(/[;,]/)
    .map(n => n.trim())
    .filter(Boolean);
}

// Obtener solo el primer número de admin para uso público (botón WhatsApp)
function getPrimaryAdminNumber() {
  const admins = getAdminNumbers();
  return admins.length > 0 ? admins[0] : '';
}

// ===============================
// MANEJADORES GLOBALES DE ERRORES
// ===============================
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error.message);
  console.error('Stack:', error.stack);
  
  // Si es error de ENOENT, registrar pero no crashear
  if (error.code === 'ENOENT') {
    console.log('⚠️ Error de archivo no encontrado - servidor continúa funcionando');
    return;
  }
  
  // Para otros errores críticos, loguear pero intentar continuar
  console.error('⚠️ Error crítico - intentando continuar operación...');
});

process.on('unhandledRejection', (reason, promise) => {
  const reasonMessage = String(reason?.message || reason || '');

  if (
    reasonMessage.includes('temp-auth') ||
    reasonMessage.includes('wwebjs') ||
    reasonMessage.includes('Session closed') ||
    reasonMessage.includes('Execution context was destroyed') ||
    reasonMessage.includes('Target closed') ||
    reasonMessage.includes('Runtime.callFunctionOn')
  ) {
    console.log('⚠️ Error de WhatsApp detectado (esperable por navegación/logout) - servidor continúa funcionando');
    return;
  }

  console.error('❌ UNHANDLED REJECTION en:', promise);
  console.error('Razón:', reason);
});

// Logging inicial para debugging
console.log('🔧 Variables de entorno cargadas:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- ADMIN_WHATSAPP:', process.env.ADMIN_WHATSAPP ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO');
console.log('- CONSULTAS_WHATSAPP:', process.env.CONSULTAS_WHATSAPP ? '✅ CONFIGURADO (número propio)' : `⚠️ NO CONFIGURADO (usando ADMIN_WHATSAPP como fallback)`);
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

// Tracking para notificaciones WhatsApp recientes (evitar duplicados)
const notificationSendHistory = new Map();
const NOTIFICATION_DUPLICATE_WINDOW_MS = 2 * 60 * 1000; // 2 minutos
const NOTIFICATION_HISTORY_TTL_MS = 15 * 60 * 1000; // 15 minutos
const notificationSendInFlight = new Set();
let pendingNotificationsProcessing = false;

function normalizePaymentId(rawId) {
  if (rawId === undefined || rawId === null) {
    return null;
  }
  const str = String(rawId).trim();
  if (!str) {
    return null;
  }
  const matches = str.match(/\d+/g);
  if (matches && matches.length > 0) {
    return matches[matches.length - 1];
  }
  return str;
}

function buildPaymentIdContext(rawId) {
  const normalized = normalizePaymentId(rawId);
  if (!normalized) {
    return { normalized: null, sdkId: null, dbParams: [] };
  }
  const numericValue = Number(normalized);
  const numeric = Number.isNaN(numericValue) ? null : numericValue;
  return {
    normalized,
    sdkId: numeric ?? normalized,
    dbParams: [normalized, numeric ?? normalized]
  };
}

// API key para apps móviles que consultan notificaciones pendientes
const MOBILE_NOTIFICATION_API_KEY = process.env.MOBILE_NOTIFICATION_API_KEY || process.env.NOTIFICATION_MOBILE_KEY;

function extraerApiKey(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return (req.headers['x-api-key'] || req.query.apiKey || req.query.api_key || '').toString().trim();
}

function requireMobileApiKey(req, res, next) {
  if (!MOBILE_NOTIFICATION_API_KEY) {
    console.error('❌ MOBILE_NOTIFICATION_API_KEY no configurada. Bloqueando acceso controlado.');
    return res.status(503).json({ error: 'Notificaciones móviles no habilitadas' });
  }
  const providedKey = extraerApiKey(req);
  if (!providedKey || providedKey !== MOBILE_NOTIFICATION_API_KEY) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  return next();
}

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
// HTML: sin caché (fuerza revalidación en cada visita)
// JS/CSS: caché corta con ETag para evitar descargas innecesarias
app.use(express.static(path.join(__dirname, '..'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (/\.(js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
  }
}));

// Middleware: evitar que los navegadores cacheen las respuestas dinámicas (API/JSON)
// Se aplica después de express.static, por lo que solo afecta a rutas no estáticas
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Endpoint básico de prueba
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Endpoint de texto plano para verificar que el servidor funciona
app.get('/test', (req, res) => {
  res.send('Servidor funcionando correctamente!');
});



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

function sanitizeTemplateText(value, fallback = '') {
  const safeValue = value === undefined || value === null ? '' : String(value);
  const baseText = safeValue || fallback || '';

  return baseText
    .normalize('NFC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\uFFFD/g, '')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function normalizeProductsForTemplate(value, fallback = 'Informacion de productos no disponible') {
  const raw = value === undefined || value === null ? '' : String(value);
  const withSeparators = raw.replace(/[\r\n\t]+/g, ', ');
  const withoutBullets = withSeparators.replace(/[•*]+/g, ' ');
  const normalized = sanitizeTemplateText(withoutBullets, fallback);
  return normalized || fallback;
}

function formatTemplateTotal(value, fallback = '$69.000') {
  const raw = sanitizeTemplateText(value, '');
  if (!raw) {
    return fallback;
  }

  const digitsOnly = raw.replace(/\D/g, '');
  if (!digitsOnly) {
    return fallback;
  }

  const amount = Number(digitsOnly);
  if (!Number.isFinite(amount)) {
    return fallback;
  }

  return `$${amount.toLocaleString('es-AR')}`;
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

// Reintenta consultas a PostgreSQL con backoff incremental
async function executeQueryWithRetry(poolInstance, query, params = [], maxRetries = 3, baseDelayMs = 500) {
  if (!poolInstance) {
    throw new Error('Pool de base de datos no inicializado');
  }

  const attempts = Math.max(1, maxRetries);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await poolInstance.query(query, params);
    } catch (error) {
      lastError = error;
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] ❌ Query falló (intento ${attempt}/${attempts}): ${error.message}`);
      if (attempt === attempts) {
        throw error;
      }
      const delayMs = baseDelayMs * attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('executeQueryWithRetry terminó sin resultado ni error');
}

function agruparPedidosPendientes(rows = []) {
  const pedidos = new Map();
  rows.forEach(row => {
    const key = row.mp_payment_id || row.id_pedido || `${row.pedido_nombre_cliente || 'cliente'}-${row.pedido_fecha?.toISOString?.() || row.pedido_fecha}`;
    if (!pedidos.has(key)) {
      pedidos.set(key, {
        mp_payment_id: row.mp_payment_id,
        id_pedido: row.id_pedido,
        cliente: row.pedido_nombre_cliente,
        telefono: row.pedido_telefono_cliente,
        monto_total: Number(row.pedido_monto_total) || 0,
        fecha: row.pedido_fecha,
        tipo_entrega: row.pedido_tipo_entrega,
        productos: []
      });
    }
    pedidos.get(key).productos.push({
      nombre: row.prenda,
      categoria: row.categoria,
      color: row.color,
      talle: row.talle,
      precio_transferencia: row.precio_venta_transferencia,
      precio_efectivo: row.precio_venta_efectivo
    });
  });

  return Array.from(pedidos.values()).map(p => ({
    ...p,
    productos: agruparProductosIdenticos(p.productos)
  }));
}

function agruparProductosIdenticos(productos = []) {
  const agrupados = new Map();
  productos.forEach(prod => {
    const key = `${prod.nombre}-${prod.color}-${prod.talle}`;
    if (agrupados.has(key)) {
      agrupados.get(key).cantidad += 1;
    } else {
      agrupados.set(key, {
        nombre: prod.nombre,
        categoria: prod.categoria,
        color: prod.color,
        talle: prod.talle,
        cantidad: 1,
        precio_transferencia: prod.precio_transferencia,
        precio_efectivo: prod.precio_efectivo
      });
    }
  });
  return Array.from(agrupados.values());
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
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsapp_api: apiStatus.configured ? 'configured' : 'not_configured',
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
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    whatsapp_api_ready: apiStatus.configured
  });
});

// ===============================
// ENDPOINT PARA KEEP-ALIVE CON MENSAJE WHATSAPP
// ===============================
app.get('/whatsapp-keep-alive', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 💚 Keep-Alive ejecutándose (solo API)...`);
  
  try {
    // Verificar estado de WhatsApp API
    const apiStatus = whatsappApiService.getWhatsAppApiStatus();
    console.log(`[${timestamp}] 📊 Estado WhatsApp API:`, apiStatus);
    
    // Procesar notificaciones pendientes
    let pendientesProcessed = false;
    if (apiStatus.configured) {
      console.log(`[${timestamp}] 📦 Procesando notificaciones pendientes...`);
      try {
        await procesarNotificacionesPendientes();
        pendientesProcessed = true;
        console.log(`[${timestamp}] ✅ Notificaciones pendientes procesadas`);
      } catch (pendientesErr) {
        console.error(`[${timestamp}] ❌ Error procesando pendientes:`, pendientesErr.message);
      }
    } else {
      console.log(`[${timestamp}] ⏭️ Saltando procesamiento de pendientes (API no configurada)`);
    }
    
    // Garbage collection
    if (global.gc) {
      console.log(`[${timestamp}] 🧹 Ejecutando garbage collection...`);
      global.gc();
    }
    
    res.json({
      success: true,
      timestamp,
      whatsapp_api: apiStatus.configured ? 'configured' : 'not_configured',
      api_status: apiStatus,
      pendientes_processed: pendientesProcessed,
      gc_available: Boolean(global.gc)
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en keep-alive:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp
    });
  }
});

// ===============================
// ÚNICO ENDPOINT DE WHATSAPP PARA REGENERAR QR
// ===============================
app.post('/limpiar-sesiones-whatsapp', async (req, res) => {
  try {
    console.log('🧹 REINICIO COMPLETO iniciado...');
    

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
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();
  res.json({
    mode: 'api_only',
    whatsapp_api: apiStatus,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/whatsapp-status', requireMobileApiKey, async (req, res) => {
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();
  res.json({
    mode: 'api_only',
    whatsapp_api: apiStatus,
    timestamp: new Date().toISOString()
  });
});

// === PRUEBA DE PLANTILLA WHATSAPP CLOUD API ===
app.post('/whatsapp-test-template', async (req, res) => {
  const timestamp = new Date().toISOString();

  try {
    const whatsappApiStatus = whatsappApiService.getWhatsAppApiStatus();
    const useCloudApi = whatsappApiService.shouldUseWhatsAppApi();
    const templateName = process.env.WHATSAPP_API_TEMPLATE_NAME;
    const templateLanguage = process.env.WHATSAPP_API_TEMPLATE_LANGUAGE || 'es';

    if (!useCloudApi) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp Cloud API no habilitada o mal configurada',
        status: whatsappApiStatus
      });
    }

    if (!templateName) {
      return res.status(400).json({
        success: false,
        error: 'Falta WHATSAPP_API_TEMPLATE_NAME en variables de entorno'
      });
    }

    const toRaw = req.body?.to || req.body?.telefono || req.body?.numero || process.env.ADMIN_WHATSAPP;
    const to = normalizePhoneNumber(String(toRaw || '').trim());
    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Número destino inválido. Envía { "to": "549..." } o configura ADMIN_WHATSAPP'
      });
    }

    const requestParameters = Array.isArray(req.body?.parameters) ? req.body.parameters : null;

    const nombreRaw = requestParameters?.[0] ?? req.body?.nombre ?? 'Guillermo';
    const pedidoRaw = requestParameters?.[1] ?? req.body?.pedido ?? '07';
    const fechaRaw = requestParameters?.[2] ?? req.body?.fecha ?? new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    const totalRaw = requestParameters?.[3] ?? req.body?.total ?? '$69.000';
    const productosRaw = requestParameters?.[4] ?? req.body?.productos ??
      '* Spicy\n* Vestido valen\n* Musculosa escote V\n* Mini short flecos'

    const nombre = sanitizeTemplateText(nombreRaw, 'Guillermo');
    const pedido = sanitizeTemplateText(pedidoRaw, '07');
    const fecha = sanitizeTemplateText(fechaRaw);
    const total = formatTemplateTotal(totalRaw, '$69.000');
    const productos = normalizeProductsForTemplate(productosRaw, 'Spicy, Vestido valen, Musculosa escote V, Mini short flecos');

    const parametros = [nombre, pedido, fecha, total, productos];

    console.log(`[${timestamp}] 🧪 Enviando plantilla de prueba vía Cloud API a ${to}`);
    console.log(`[${timestamp}] 🧪 Plantilla: ${templateName} (${templateLanguage})`);

    const resultado = await whatsappApiService.sendWhatsAppApiTemplateMessage(
      to,
      templateName,
      templateLanguage,
      parametros,
      { test: true }
    );

    // Log detallado de error si falla
    if (!resultado.success) {
      console.error(`[${timestamp}] ❌ WhatsApp Cloud API error detail:`, JSON.stringify(resultado, null, 2));
    }

    let pedidoUpdate = null;
    const paymentIdToUpdate = req.body?.paymentId || req.body?.payment_id || req.body?.mp_payment_id || req.body?.id_pago;
    if (resultado.success && paymentIdToUpdate) {
      await actualizarEstadoWhatsApp(paymentIdToUpdate, true);
      pedidoUpdate = {
        payment_id: normalizePaymentId(paymentIdToUpdate),
        whatsapp_notificado: 'True'
      };
    }

    return res.status(resultado.success ? 200 : 500).json({
      success: resultado.success,
      template_name: templateName,
      template_language: templateLanguage,
      to,
      parametros,
      resultado,
      pedido_update: pedidoUpdate,
      error_detail: resultado.details || resultado.error || null
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en /whatsapp-test-template: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// === ENDPOINT DEPRECADO - YA NO SE USA QR ===
app.get('/whatsapp-regenerar-qr', async (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Endpoint deprecado',
    message: 'Este sistema ahora usa WhatsApp Cloud API exclusivamente. No se requiere conexión QR.',
    api_status: whatsappApiService.getWhatsAppApiStatus(),
    instructions: [
      '☁️ Este sistema ahora usa WhatsApp Cloud API',
      '📊 Verifica /whatsapp-status para ver el estado de la API',
      '⚙️ Configura las variables: WHATSAPP_API_PHONE_NUMBER_ID, WHATSAPP_API_TOKEN, USE_WHATSAPP_API=true'
    ]
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
      whatsapp_api: whatsappApiService.getWhatsAppApiStatus().configured ? 'configured' : 'not_configured',
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

    },
    endpoints_disponibles: [
      '/health',
      '/debug', 
      '/contact-info',
      '/whatsapp-status',
      '/test-whatsapp (POST)',
      '/whatsapp-test-template (POST)',
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
      mode: 'api_only',
      api_configured: whatsappApiService.getWhatsAppApiStatus().configured,
      admin_configured: !!process.env.ADMIN_WHATSAPP
    }
  });
});

// === INFORMACIÓN DE CONTACTO ===
app.get('/contact-info', (req, res) => {
  try {
    const contactInfo = {
      whatsapp: process.env.CONSULTAS_WHATSAPP || null, // Solo número de consultas, NUNCA el de API
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
    if (typeof pool === 'undefined' || !pool) {
      console.warn('⚠️ Base de datos no disponible - retornando stock vacío');
      return res.json({ ids: [] });
    }
    
    // Consultar productos que NO están disponibles
    // Según la estructura de la tabla: estado != 'Disponible' significa agotado/vendido/reservado
    const result = await pool.query(`
      SELECT id_articulo 
      FROM ${PRODUCTOS_TABLE} 
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
    if (typeof pool === 'undefined' || !pool) {
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
      FROM ${PRODUCTOS_TABLE} 
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
      FROM ${PRODUCTOS_TABLE} 
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
        telefono: String(datosComprador.telefono).replace(/\D/g, '').substring(0, 15),
        email: String(datosComprador.email || '').trim().toLowerCase().substring(0, 254)
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
// ENDPOINTS PRINCIPALES
// ===============================
// FUNCIONES PARA NOTIFICACIONES DE COMPRA
// ===============================

// Función para enviar notificación de compra por WhatsApp
// Variables para tracking de estado WhatsApp
let intentosReconexion = 0;

// Función mejorada para verificar si WhatsApp está realmente disponible
// ===============================
// FUNCIÓN AUXILIAR: VERIFICAR ESTADO WHATSAPP API
// ===============================
async function verificarEstadoWhatsAppApi() {
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();
  return {
    disponible: apiStatus.configured,
    razon: apiStatus.configured ? 'WhatsApp API configurada' : `Faltan variables: ${apiStatus.missing.join(', ')}`,
    whatsappApi: apiStatus
  };
}

// Función para marcar conexión exitosa
// Función para procesar notificaciones pendientes
async function procesarNotificacionesPendientes(reintentos = 0, options = {}) {
  const timestamp = new Date().toISOString();
  const fastTrack = Boolean(options.fastTrack);
  const source = options.source || 'default';
  let pedidosProcesados = 0;
  let pedidosExitosos = 0;

  if (pendingNotificationsProcessing) {
    console.log(`[${timestamp}] ⏭️ procesarNotificacionesPendientes ya está en ejecución; se omite invocación duplicada`);
    return { skipped: true, reason: 'already_processing', source };
  }
  pendingNotificationsProcessing = true;
  
  try {
    console.log(`[${timestamp}] 🔍 DEBUG procesarNotificacionesPendientes - reintentos: ${reintentos}, source: ${source}`);
    
    // Verificar que WhatsApp API esté configurada
    const apiStatus = whatsappApiService.getWhatsAppApiStatus();
    if (!apiStatus.configured) {
      console.log(`[${timestamp}] ❌ WhatsApp API no configurada - missing: ${apiStatus.missing.join(', ')}`);
      return { success: false, error: 'WhatsApp API no configurada', reintentos, source };
    }
    
    console.log(`[${timestamp}] ✅ WhatsApp API operativa - buscando notificaciones pendientes...`);
    
    // Buscar productos con notificación pendiente (TODAS, sin límite de fecha)
    if (!pool) {
      console.log(`[${timestamp}] ⚠️ Base de datos no configurada - no se pueden procesar notificaciones pendientes`);
      return;
    }

    let resultPendientes;
    try {
      resultPendientes = await pool.query(`SELECT 
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
      FROM ${PRODUCTOS_TABLE} p 
       WHERE p.estado LIKE '%Pendiente%' 
       AND p.whatsapp_notificado = 'False'
       ORDER BY p.pedido_fecha ASC, p.mp_payment_id, p.id_articulo 
       LIMIT 50`);
    } catch (dbError) {
      console.error(`[${timestamp}] ❌ Error consultando notificaciones pendientes:`, dbError.message);
      return;
    }
    
    console.log(`[${timestamp}] 🔍 DEBUG: Query ejecutada para notificaciones pendientes (sin límite de fecha)`);
    console.log(`[${timestamp}] 🔍 Resultado query:`, resultPendientes?.rows?.length || 0, 'registros encontrados');
    
    if (!resultPendientes || !resultPendientes.rows || resultPendientes.rows.length === 0) {
      console.log(`[${timestamp}] ✅ No hay notificaciones WhatsApp pendientes`);
      return { success: true, source, fastTrack, totalPendientes: 0, pedidosProcesados: 0, pedidosExitosos: 0 };
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
        pedidosProcesados += 1;
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
          idPedidoCompleto: pedido.id_pedido,
          fechaPago: pedido.pedido_fecha
        };
        
        const paymentInfo = {
          transaction_amount: pedido.pedido_monto_total || 0,
          id: pedido.mp_payment_id,
          normalized_payment_id: pedido.mp_payment_id,
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
        
        const clienteNotificado = Boolean(resultado?.cliente_result?.success);
        await actualizarEstadoWhatsApp(pedido.mp_payment_id, clienteNotificado);
        
        if (resultado.success) {
          pedidosExitosos += 1;
          console.log(`[${timestamp}] ✅ Reintento exitoso para pedido: ${pedido.id_pedido}`);
        } else {
          console.log(`[${timestamp}] ❌ Reintento falló para pedido: ${pedido.id_pedido} - ${resultado.error}`);
        }
        
        // Delay entre envíos (reducido en fastTrack para aprovechar la sesión)
        if (fastTrack) {
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`[${timestamp}] ❌ Error procesando pedido ${pedido.id_pedido}:`, error.message);
      }
    }

    return {
      success: pedidosExitosos > 0,
      source,
      fastTrack,
      totalPendientes: pedidosMap.size,
      pedidosProcesados,
      pedidosExitosos
    };
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en procesarNotificacionesPendientes:`, error.message);
    return { success: false, source, fastTrack, error: error.message, pedidosProcesados, pedidosExitosos };
  } finally {
    pendingNotificationsProcessing = false;
  }
}

app.get('/api/notificaciones-pendientes', requireMobileApiKey, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: 'Base de datos no disponible' });
  }

  const maxLimit = 100;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 25, maxLimit));
  const windowHoursMax = 24 * 14; // 2 semanas
  const windowHours = Math.max(1, Math.min(parseInt(req.query.horas, 10) || 72, windowHoursMax));
  const sinceDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  try {
    const pendientes = await executeQueryWithRetry(
      pool,
      `SELECT
        p.mp_payment_id,
        p.id_pedido,
        p.pedido_nombre_cliente,
        p.pedido_telefono_cliente,
        p.pedido_monto_total,
        p.pedido_fecha,
        p.pedido_tipo_entrega,
        p.prenda,
        p.categoria,
        p.color,
        p.talle,
        p.precio_venta_transferencia,
        p.precio_venta_efectivo
      FROM ${PRODUCTOS_TABLE} p
       WHERE p.estado ILIKE '%Pendiente%'
         AND (p.whatsapp_notificado = 'False' OR p.whatsapp_notificado IS NULL)
         AND p.pedido_fecha >= $1
       ORDER BY p.pedido_fecha ASC
       LIMIT $2`,
      [sinceDate, limit]
    );

    const orders = agruparPedidosPendientes(pendientes.rows);
    return res.json({
      checked_at: new Date().toISOString(),
      pending: orders.length,
      window_hours: windowHours,
      limit,
      orders
    });
  } catch (error) {
    console.error('❌ Error consultando notificaciones pendientes (API móvil):', error.message);
    return res.status(500).json({ error: 'No se pudo consultar la información' });
  }
});

// Función para actualizar el estado de notificación WhatsApp
async function actualizarEstadoWhatsApp(paymentId, estado) {
  const timestamp = new Date().toISOString();
  
  const paymentContext = buildPaymentIdContext(paymentId);
  const normalizedPaymentId = paymentContext.normalized;
  
  if (!normalizedPaymentId) {
    console.warn(`[${timestamp}] ⚠️ No se puede actualizar estado WhatsApp: paymentId faltante`);
    return;
  }
  
  try {
    const estadoString = estado ? 'True' : 'False';
    const scope = estado ? 'CLIENTE ENTREGADO' : 'CLIENTE PENDIENTE';
    
    await executeQueryWithRetry(
      pool,
      `UPDATE ${PRODUCTOS_TABLE} SET whatsapp_notificado = $1 WHERE mp_payment_id = $2 OR mp_payment_id = $3`,
      [estadoString, paymentContext.dbParams[0], paymentContext.dbParams[1]],
      2
    );
    
    console.log(`[${timestamp}] ✅ Estado WhatsApp (${scope}) actualizado a ${estadoString} para payment_id: ${normalizedPaymentId}`);
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error actualizando estado WhatsApp:`, error.message);
  }
}

async function enviarNotificacionCompra(customerData, orderData, paymentInfo, esReintento = false) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔔 === INICIANDO NOTIFICACIÓN DE COMPRA ===`);
  
  let normalizedPaymentId = null;
  let paymentId = 'N/A';
  let rawPaymentId = null;
  const whatsappApiStatus = whatsappApiService.getWhatsAppApiStatus();
  const useCloudApi = whatsappApiService.shouldUseWhatsAppApi();
  const oneShotDispatch = Boolean(esReintento);

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

    console.log(`[${timestamp}] ☁️ WhatsApp API - flagEnabled: ${whatsappApiStatus.flagEnabled}, configurada: ${whatsappApiStatus.configured}, en uso: ${useCloudApi}`);
    
    // SOLO WhatsApp Cloud API - NO MÁS QR
    if (!useCloudApi) {
      console.error(`[${timestamp}] ❌ WhatsApp API no configurada o no habilitada`);
      if (whatsappApiStatus.flagEnabled && !whatsappApiStatus.configured) {
        console.error(`[${timestamp}] ⚠️ Faltan variables: ${whatsappApiStatus.missing.join(', ')}`);
      }
      return { success: false, error: 'WhatsApp API no configurada' };
    }
    
    console.log(`[${timestamp}] ☁️ Usando WhatsApp Cloud API para notificación`);

    console.log(`[${timestamp}] 📋 Datos de la compra:`);
    
    // Extraer datos con valores por defecto seguros
    const { first_name = '', last_name = '', phone } = customerData || {};
    const nombre = first_name;
    const apellido = last_name;
    const telefono = customerData?.telefono || 
      (phone ? 
        (typeof phone === 'string' ? phone : `${phone.area_code}${phone.number}`) : 
        '');
    
    const { numeroDisplay = 'N/A', idPedidoCompleto = 'N/A' } = orderData || {};
    rawPaymentId = paymentInfo?.normalized_payment_id ?? paymentInfo?.id ?? idPedidoCompleto;
    normalizedPaymentId = normalizePaymentId(rawPaymentId);
    paymentId = normalizedPaymentId || 'N/A';
    const transaction_amount = Number(
      paymentInfo?.transaction_amount ??
      orderData?.monto_total ??
      orderData?.montoTotal ??
      0
    );
  
    if (normalizedPaymentId) {
      if (notificationSendInFlight.has(normalizedPaymentId)) {
        console.warn(`[${timestamp}] ⚠️ Envío ya en curso para pago ${normalizedPaymentId} - omitiendo duplicado`);
        return {
          success: false,
          skipped: true,
          reason: 'in_flight'
        };
      }
      notificationSendInFlight.add(normalizedPaymentId);
    }
    
    console.log(`[${timestamp}] - Cliente: ${nombre} ${apellido}`);
    console.log(`[${timestamp}] - Teléfono: ${telefono || 'No proporcionado'}`);
    console.log(`[${timestamp}] - Teléfono RAW:`, phone);
    console.log(`[${timestamp}] - CustomerData completo:`, customerData);
    console.log(`[${timestamp}] - Pedido: ${numeroDisplay} (${idPedidoCompleto})`);
    console.log(`[${timestamp}] - Monto: $${transaction_amount}`);
    console.log(`[${timestamp}] - Payment ID: ${paymentId}`);
  
    if (!esReintento && normalizedPaymentId) {
      const lastSentAt = notificationSendHistory.get(normalizedPaymentId);
      if (lastSentAt && (Date.now() - lastSentAt) < NOTIFICATION_DUPLICATE_WINDOW_MS) {
        const secondsAgo = Math.round((Date.now() - lastSentAt) / 1000);
        console.warn(`[${timestamp}] ⚠️ Notificación duplicada detectada para pago ${normalizedPaymentId} (hace ${secondsAgo}s) - omitiendo reenvío`);
        return {
          success: true,
          duplicate: true,
          skipped: true,
          message: `Notificación ya enviada hace ${secondsAgo}s`
        };
      }
    }
      
    const fechaOptions = {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    };
    const fechaReferenciaCruda = orderData?.fechaPago || paymentInfo?.date_approved || paymentInfo?.date_created;
    let fechaHora;
    if (fechaReferenciaCruda) {
      const fechaParseada = new Date(fechaReferenciaCruda);
      if (!Number.isNaN(fechaParseada.getTime())) {
        fechaHora = fechaParseada.toLocaleString('es-AR', fechaOptions);
      }
    }
    if (!fechaHora) {
      fechaHora = new Date().toLocaleString('es-AR', fechaOptions);
    }
    
    // Obtener productos del payment info con validación robusta
    const items = (paymentInfo && paymentInfo.additional_info && paymentInfo.additional_info.items) 
      ? paymentInfo.additional_info.items 
      : [];
      
    console.log(`[${timestamp}] 📦 Items de la compra: ${items.length} productos`);
    
    let productosTexto = '';
    let productosTextoTemplate = '';
    if (Array.isArray(items) && items.length > 0) {
      if (esReintento) {
        productosTexto = items.map((item, index) => {
          const title = item?.title || 'Producto sin nombre';
          const quantity = item?.quantity || 1;
          
          console.log(`[${timestamp}] - Item ${index + 1}: ${title} x${quantity} (reintento simplificado)`);
          return quantity > 1 ? `• ${title} (${quantity})` : `• ${title}`;
        }).join('\n');
      } else {
        productosTexto = items.map((item, index) => {
          const title = item?.title || 'Producto sin nombre';
          const quantity = item?.quantity || 1;
          const unit_price = item?.unit_price || 0;
          
          console.log(`[${timestamp}] - Item ${index + 1}: ${title} x${quantity} - $${unit_price}`);
          return `• ${title} x${quantity} - $${unit_price.toLocaleString('es-AR')}`;
        }).join('\n');
      }

      productosTextoTemplate = items.map((item) => {
        const title = item?.title || 'Producto sin nombre';
        const quantity = item?.quantity || 1;
        return quantity > 1 ? `${title} (${quantity})` : `${title}`;
      }).join(', ');
    } else {
      console.log(`[${timestamp}] ⚠️ No se encontraron items válidos en paymentInfo`);
      productosTexto = '• Información de productos no disponible';
      productosTextoTemplate = '* Informacion de productos no disponible';
    }
    
    const businessName = BUSINESS_NAME || 'Tienda Online';
    const tipoNotificacion = esReintento ? '🔄 *REINTENTO DE NOTIFICACIÓN*' : '🛒 *NUEVA COMPRA*';
    // Nuevo título para aviso a admin.
    const mensajeAdmin = `🟢 Nuevo Pedido Registrado en el Sistema Capri\n\n` +
      `👤 *Cliente:* ${nombre} ${apellido}\n` +
      `📱 *Teléfono:* ${telefono || 'No proporcionado'}\n` +
      `📅 *Fecha:* ${fechaHora}\n\n` +
      `🛍️ *Productos:*\n${productosTexto}\n\n` +
      `💰 *Total:* $${transaction_amount.toLocaleString('es-AR')}\n` +
      `🆔 *Pedido:* ${idPedidoCompleto}\n` +
      `💳 *Pago ID:* ${paymentId}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ *${esReintento ? 'Notificación reenviada al cliente automáticamente' : '¡Pago confirmado! Proceder con el envío'}*`;
    
    const consultasNumero = (CONSULTAS_WHATSAPP || '').replace(/\D/g, '');
    const consultasLink = consultasNumero ? `https://wa.me/${consultasNumero}` : null;

    const mensajeCliente = `🎉 *¡Gracias por tu compra en ${businessName}!* 🎉\n\n` +
      `✅ *Tu pago ha sido procesado exitosamente*\n\n` +
      `📋 *Detalles de tu pedido:*\n` +
      `🆔 *ID Número Pedido:* ${numeroDisplay}\n` +
      `📅 *Fecha del pago:* ${fechaHora}\n` +
      `💰 *Total:* $${transaction_amount.toLocaleString('es-AR')}\n\n` +
      `🛍️ *Productos:*\n${productosTexto}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📞 *Te contactaremos pronto para coordinar la entrega*\n\n` +
      (consultasLink ? `💬 *Para comunicarte con nosotros podés usar el siguiente enlace:*\n👇 ${consultasLink}\n\n` : '') +
      `¡Gracias por elegirnos! 💜`;
    
    let resultado = null;
    
    if (useCloudApi) {
      const resultAdmin = { success: false, skipped: true, reason: 'cloud_api_mode' };
      let resultCliente = { success: false, error: 'No se intentó enviar' };
      const templateName = process.env.WHATSAPP_API_TEMPLATE_NAME;
      const templateLanguage = process.env.WHATSAPP_API_TEMPLATE_LANGUAGE || 'es';
      const useTemplate = Boolean(templateName);
      
      if (telefono && telefono.trim()) {
        console.log(`[${timestamp}] 📱 Enviando confirmación vía WhatsApp API al cliente: ${telefono}`);
        const clienteNormalizado = normalizePhoneNumber(telefono);
        console.log(`[${timestamp}] 📱 Cliente normalizado: ${clienteNormalizado}`);
        
        if (clienteNormalizado) {
          if (useTemplate && typeof whatsappApiService.sendWhatsAppApiTemplateMessage === 'function') {
            const totalTexto = formatTemplateTotal(transaction_amount, '$0');
            const nombreCliente = sanitizeTemplateText(nombre?.trim() || 'Cliente', 'Cliente');
            const numeroTemplate = sanitizeTemplateText(numeroDisplay, 'N/A');
            const fechaTemplate = sanitizeTemplateText(fechaHora);
            const productosTemplate = normalizeProductsForTemplate(productosTextoTemplate);
            const parametros = [
              nombreCliente,
              numeroTemplate,
              fechaTemplate,
              totalTexto,
              productosTemplate,
              consultasLink || ''  // {{6}} - link de consultas (agregar al template en Meta)
            ];

            resultCliente = await whatsappApiService.sendWhatsAppApiTemplateMessage(
              clienteNormalizado,
              templateName,
              templateLanguage,
              parametros,
              {
                paymentId,
                orderId: idPedidoCompleto,
                esReintento
              }
            );
          } else {
            resultCliente = await whatsappApiService.sendWhatsAppApiMessage(clienteNormalizado, mensajeCliente, {
              paymentId,
              orderId: idPedidoCompleto,
              esReintento
            });
          }
          
          console.log(`[${timestamp}] 📡 Resultado del envío vía API:`, {
            success: resultCliente.success,
            error: resultCliente.error,
            messageId: resultCliente.messageId
          });
        } else {
          console.error(`[${timestamp}] ❌ No se pudo normalizar teléfono del cliente para WhatsApp API: ${telefono}`);
          resultCliente = { success: false, error: 'Teléfono del cliente inválido' };
        }
      } else {
        console.warn(`[${timestamp}] ⚠️ No hay teléfono del cliente para enviar confirmación (WhatsApp API)`);
        resultCliente = { success: false, error: 'Teléfono del cliente no disponible' };
      }
      
      resultado = {
        success: resultCliente.success,
        admin_result: resultAdmin,
        cliente_result: resultCliente,
        both_sent: resultCliente.success,
        transport: 'whatsapp_api'
      };
    }
    
    if (normalizedPaymentId) {
      if (!esReintento && resultado.success) {
        notificationSendHistory.set(normalizedPaymentId, Date.now());
      }
    }
    
    // Procesar notificaciones pendientes si el envío fue exitoso
    if (resultado.success && !esReintento) {
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
  } finally {
    if (normalizedPaymentId) {
      notificationSendInFlight.delete(normalizedPaymentId);
    }
  }
}

// ===============================
// ENDPOINT: WEBHOOK DE MERCADO PAGO
// ===============================
app.post('/webhook', async (req, res) => {
  const timestamp = new Date().toISOString();
  let paymentIdRaw = null;
  let paymentIdContext = null;
  let shouldProcess = false;

  console.log(`[${timestamp}] 📬 WEBHOOK RECIBIDO:`);
  // Headers omitidos para reducir logs - solo mostrar info relevante
  console.log(`[${timestamp}] User-Agent: ${req.headers['user-agent']}`);
  console.log(`[${timestamp}] Body:`, JSON.stringify(req.body, null, 2));

  try {
    const { type, data, action, topic, resource } = req.body;
    
    // Detectar el payment ID desde diferentes formatos de webhook
    if (type === 'payment' && data?.id) {
      paymentIdRaw = data.id;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook tipo 'payment' detectado (raw ID: ${paymentIdRaw})`);
    } else if (action === 'payment.created' && data?.id) {
      paymentIdRaw = data.id;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook action 'payment.created' detectado (raw ID: ${paymentIdRaw})`);
    } else if (topic === 'payment' && resource) {
      paymentIdRaw = resource;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook topic 'payment' detectado (resource: ${paymentIdRaw})`);
    } else {
      console.log(`[${timestamp}] ⚠️ Webhook ignorado - type: ${type}, action: ${action}, topic: ${topic}, resource: ${resource}`);
      return res.status(200).send('OK - Ignored (not payment)');
    }

    if (shouldProcess && paymentIdRaw) {
      paymentIdContext = buildPaymentIdContext(paymentIdRaw);
      const paymentKey = paymentIdContext?.normalized;
      if (!paymentKey) {
        console.log(`[${timestamp}] ❌ No se pudo normalizar paymentId recibido: ${paymentIdRaw}`);
        return res.status(400).send('paymentId inválido en webhook');
      }
      const [dbPaymentKey, dbPaymentFallback] = paymentIdContext.dbParams;

      // Verificar si ya existe el pedido en BD
      let pedidoExistente = null;
      try {
        const checkPedido = await executeQueryWithRetry(
          pool,
          `SELECT id_pedido FROM ${PRODUCTOS_TABLE} WHERE (mp_payment_id = $1 OR mp_payment_id = $2) AND id_pedido IS NOT NULL AND id_pedido != '' LIMIT 1`,
          [dbPaymentKey, dbPaymentFallback],
          2
        );
        if (checkPedido && checkPedido.rows && checkPedido.rows.length > 0) {
          pedidoExistente = checkPedido.rows[0].id_pedido;
          console.log(`[${timestamp}] ✅ Pago ${paymentKey} ya tiene pedido en BD: ${pedidoExistente} - Ignorado`);
          return res.status(200).send('OK - Already processed');
        }
      } catch (err) {
        console.error(`[${timestamp}] ⚠️ Error al verificar pedido existente:`, err.message);
      }

      // Verificar en memoria si ya se procesó
      if (webhookNotifications.has(paymentKey)) {
        console.log(`[${timestamp}] ⚠️ Pago ${paymentKey} ya procesado en memoria - Ignorado`);
        return res.status(200).send('OK - Already processed (memory)');
      }

      // Marcar como procesado en memoria
      webhookNotifications.set(paymentKey, Date.now());

      // Obtener información completa del pago de MercadoPago
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentIdContext.sdkId });

      console.log(`[${timestamp}] 💳 Estado del pago (${paymentKey}): ${paymentInfo.status}`);
      paymentInfo.normalized_payment_id = paymentKey;

      if (paymentInfo.status === 'approved') {
        // Extraer datos del comprador desde metadata o payer
        let customerData = {};
        try {
          if (paymentInfo.metadata) {
            customerData = {
              nombre: paymentInfo.payer?.first_name || '',
              apellido: paymentInfo.payer?.last_name || '',
              email: paymentInfo.metadata.email || paymentInfo.payer?.email || '',
              telefono: paymentInfo.metadata.telefono || paymentInfo.payer?.phone?.number || ''
            };
          }
        } catch (error) {
          console.error(`[${timestamp}] ⚠️ Error extrayendo customer data:`, error.message);
        }

        const emailCliente = customerData.email || paymentInfo.metadata?.email || paymentInfo.payer?.email || `cliente${String(customerData.telefono || '').replace(/\D/g, '')}@mp.com.ar`;

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
            const query = `SELECT id_articulo FROM ${PRODUCTOS_TABLE} WHERE id_articulo IN (${placeholders}) AND estado != 'Disponible'`;
            const result = await executeQueryWithRetry(pool, query, idsArray, 2);
            faltantes = result.rows.map(row => row.id_articulo);
          } catch (error) {
            console.error(`[${timestamp}] ⚠️ Error verificando stock:`, error.message);
            // En caso de error, asumir que todos están disponibles para no perder la venta
          }
        }

        if (faltantes.length > 0) {
          console.log(`[${timestamp}] ⚠️ Productos sin stock: ${faltantes.join(', ')}`);
          // Notificación de productos no disponibles (solo por API si está configurada)
          const apiStatus = whatsappApiService.getWhatsAppApiStatus();
          if (apiStatus.configured && ADMIN_WHATSAPP) {
            try {
              const mensaje = `⚠️ *PROBLEMA CON COMPRA*\n\n` +
                `💳 Pago ID: ${paymentKey}\n` +
                `💰 Monto: $${paymentInfo.transaction_amount}\n` +
                `📦 Productos sin stock: ${faltantes.join(', ')}\n\n` +
                `👤 Cliente: ${customerData.nombre} ${customerData.apellido}\n` +
                ` Tel: ${customerData.telefono}\n\n` +
                `⚠️ No se creó el pedido automáticamente. Revisar y contactar al cliente.`;
              
              await whatsappApiService.sendWhatsAppApiMessage(ADMIN_WHATSAPP, mensaje, { type: 'stock_alert' });
            } catch (whatsappError) {
              console.error(`[${timestamp}] ❌ Error enviando WhatsApp API:`, whatsappError.message);
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
                emailCliente,
                customerData.telefono || paymentInfo.payer?.phone?.number || '',
                'MercadoPago',
                'Retiro', // Tipo de entrega por defecto
                paymentKey
              ],
              2
            );

            // Obtener el ID del pedido creado
            const pedidoResult = await executeQueryWithRetry(
              pool,
              `SELECT id_pedido, pedido_fecha FROM ${PRODUCTOS_TABLE} WHERE (mp_payment_id = $1 OR mp_payment_id = $2) AND id_pedido IS NOT NULL AND id_pedido != '' ORDER BY pedido_fecha DESC LIMIT 1`,
              [dbPaymentKey, dbPaymentFallback],
              2
            );

            if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
              const { id_pedido: idPedidoCompleto, pedido_fecha: fechaPedido } = pedidoResult.rows[0];
              const numeroDisplay = idPedidoCompleto && idPedidoCompleto.length >= 2 ? 
                idPedidoCompleto.slice(-2) : idPedidoCompleto;

              console.log(`[${timestamp}] ✅ Pedido creado exitosamente: ${idPedidoCompleto} (Display: ${numeroDisplay})`);
              await actualizarEstadoWhatsApp(paymentKey, false);

              // Enviar notificación de compra por WhatsApp API
              console.log(`[${timestamp}] 📱 Intentando enviar notificación vía WhatsApp API...`);
              const apiStatus = whatsappApiService.getWhatsAppApiStatus();
              console.log(`[${timestamp}] - WhatsApp API configurada: ${apiStatus.configured}`);
              
              if (apiStatus.configured) {
                console.log(`[${timestamp}] ✅ WhatsApp API disponible, enviando notificación...`);
                try {
                  const notificationResult = await enviarNotificacionCompra(
                    customerData,
                    { numeroDisplay, idPedidoCompleto, fechaPago: fechaPedido },
                    paymentInfo
                  );
                  
                  console.log(`[${timestamp}] 📨 Resultado notificación:`, {
                    success: notificationResult.success,
                    error: notificationResult.error
                  });
                  
                  // Actualizar estado en base de datos
                  await actualizarEstadoWhatsApp(paymentKey, Boolean(notificationResult?.cliente_result?.success));
                  
                } catch (whatsappError) {
                  console.error(`[${timestamp}] ❌ EXCEPCIÓN enviando notificación WhatsApp API:`, whatsappError.message);
                  console.error(`[${timestamp}] Stack trace:`, whatsappError.stack);
                  
                  // Marcar como fallido en base de datos
                  await actualizarEstadoWhatsApp(paymentKey, false);
                }
              } else {
                console.warn(`[${timestamp}] ⚠️ WhatsApp API no configurada - missing: ${apiStatus.missing.join(', ')}`);
                
                // Marcar como no enviado
                await actualizarEstadoWhatsApp(paymentKey, false);
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
        console.log(`[${timestamp}] ⚠️ Pago ${paymentKey} no aprobado (estado: ${paymentInfo.status})`);
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
  const paymentContext = buildPaymentIdContext(paymentId);
  const normalizedPaymentId = paymentContext.normalized;
  
  console.log(`🔍 Consultando número de pedido para payment ID: ${paymentId} (normalizado: ${normalizedPaymentId || 'N/A'})`);

  if (!normalizedPaymentId) {
    return res.status(400).json({
      success: false,
      error: 'paymentId inválido',
      payment_id: paymentId
    });
  }

  // Configuración de reintentos
  const MAX_TRIES = 5;
  const RETRY_DELAY_MS = 2000; // 2 segundos
  let intento = 0;
  let pedidoEncontrado = null;

  try {
    while (intento < MAX_TRIES && !pedidoEncontrado) {
      intento++;
      console.log(`🔄 Intento ${intento}/${MAX_TRIES} para payment ID: ${normalizedPaymentId}`);

      try {
        const pedidoResult = await executeQueryWithRetry(
          pool,
          `SELECT p.id_pedido, p.pedido_fecha, p.pedido_nombre_cliente, p.pedido_monto_total, p.mp_payment_id 
           FROM ${PRODUCTOS_TABLE} p 
           WHERE (p.mp_payment_id = $1 OR p.mp_payment_id = $2) 
           AND p.id_pedido IS NOT NULL 
           AND p.id_pedido != '' 
           ORDER BY p.pedido_fecha DESC 
           LIMIT 1`,
          paymentContext.dbParams,
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
        payment_id: normalizedPaymentId
      });
    } else {
      console.warn(`⚠️ Pedido no encontrado para payment_id: ${normalizedPaymentId} después de ${MAX_TRIES} intentos`);
      
      res.json({
        success: false,
        pedido_encontrado: false,
        numero_pedido: null,
        message: 'Pedido no encontrado. Es posible que aún se esté procesando.',
        payment_id: normalizedPaymentId,
        intentos_realizados: MAX_TRIES
      });
    }
  } catch (error) {
    console.error('❌ Error en /numero-pedido:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      payment_id: normalizedPaymentId
    });
  }
});

// ===============================
// ENDPOINT TEMPORAL: Reintento manual de notificación WhatsApp
// ===============================
app.get('/reintento-whatsapp/:paymentId', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { paymentId } = req.params;
  const paymentContext = buildPaymentIdContext(paymentId);
  const normalizedPaymentId = paymentContext.normalized;
  
  console.log(`[${timestamp}] 🔄 === REINTENTO MANUAL WHATSAPP ===`);
  console.log(`[${timestamp}] 📱 Payment ID recibido: ${paymentId} (normalizado: ${normalizedPaymentId || 'N/A'})`);
  
  if (!normalizedPaymentId) {
    return res.status(400).json({
      success: false,
      error: 'paymentId inválido',
      payment_id: paymentId
    });
  }
  
  try {
    // Verificar estado de WhatsApp API
    const estadoWhatsApp = await verificarEstadoWhatsAppApi();
    console.log(`[${timestamp}] 📊 Estado WhatsApp API: ${JSON.stringify(estadoWhatsApp, null, 2)}`);
    
    if (!estadoWhatsApp.disponible) {
      return res.json({
        success: false,
        error: `WhatsApp API no disponible: ${estadoWhatsApp.razon}`,
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
      FROM ${PRODUCTOS_TABLE} p 
       WHERE p.mp_payment_id = $1 OR p.mp_payment_id = $2`,
      paymentContext.dbParams,
      2
    );
    
    if (!resultCompra || !resultCompra.rows || resultCompra.rows.length === 0) {
      return res.json({
        success: false,
        error: 'Compra no encontrada',
        payment_id: normalizedPaymentId
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
      idPedidoCompleto: compra.id_pedido,
      fechaPago: compra.pedido_fecha
    };
    
    const paymentInfo = {
      transaction_amount: compra.pedido_monto_total || 0,
      id: normalizedPaymentId,
      normalized_payment_id: normalizedPaymentId
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
    const clienteNotificado = Boolean(resultado?.cliente_result?.success);
    await actualizarEstadoWhatsApp(normalizedPaymentId, clienteNotificado);
    const estadoNuevo = resultado.success ? 'True' : 'False';
    
    console.log(`[${timestamp}] 💾 Estado actualizado: ${estadoAnterior} → ${estadoNuevo}`);
    
    res.json({
      success: true,
      reintento_exitoso: resultado.success,
      payment_id: normalizedPaymentId,
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
      payment_id: normalizedPaymentId || paymentId,
      timestamp: timestamp
    });
  }
});

// ===============================
// ENDPOINT DEPRECADO: /whatsapp-force-restart (YA NO USADO - API CLOUD)
// ===============================
app.post('/whatsapp-force-restart', async (req, res) => {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] ⚠️ Endpoint deprecado: /whatsapp-force-restart llamado`);
  
  res.status(410).json({
    success: false,
    error: 'Endpoint deprecado',
    message: 'La conexión vía QR ha sido eliminada. Ahora se usa WhatsApp Cloud API.',
    migration_info: {
      old_system: 'whatsapp-web.js con código QR',
      new_system: 'WhatsApp Cloud API (graph.facebook.com)',
      no_action_needed: 'La API no requiere escaneo de QR ni reinicializaciones'
    },
    endpoint_removed: 'POST /whatsapp-force-restart',
    check_status: 'GET /whatsapp-status para ver estado de la API',
    timestamp: timestamp
  });
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
      
      // Limpiar historial de envíos duplicados
      const now = Date.now();
      let historyCleaned = 0;
      for (const [key, sentAt] of notificationSendHistory.entries()) {
        if (now - sentAt > NOTIFICATION_HISTORY_TTL_MS) {
          notificationSendHistory.delete(key);
          historyCleaned++;
        }
      }
      if (historyCleaned > 0) {
        console.log(`🧹 Historial de notificaciones reducido (${historyCleaned} entradas)`);
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
    
    // Mostrar estado de WhatsApp API
    const apiStatus = whatsappApiService.getWhatsAppApiStatus();
    if (apiStatus.configured) {
      console.log('📱 WhatsApp: Cloud API configurada y lista ✅');
      console.log(`   - Phone Number ID: ${process.env.WA_PHONE_ID?.substring(0, 10)}...`);
      console.log(`   - Business Account: ${process.env.WA_BUSINESS_ACCOUNT_ID?.substring(0, 10)}...`);
    } else {
      console.log('📱 WhatsApp: Cloud API no configurada ⚠️');
      console.log(`   - Faltan variables: ${apiStatus.missing.join(', ')}`);
      console.log('   - Las notificaciones no se enviarán hasta configurar la API');
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
      
      // Estado de WhatsApp API
      const apiStatus = whatsappApiService.getWhatsAppApiStatus();
      if (apiStatus.configured) {
        console.log(`📱 WhatsApp: API configurada y lista`);
      } else {
        console.log(`📱 WhatsApp: API no configurada - missing: ${apiStatus.missing.join(', ')}`);
      }
      
      console.log(`🗄️ Base de datos: ${typeof pool === 'undefined' ? 'No disponible' : (pool ? 'Conectada' : 'No disponible')}`);
      console.log(`⚙️ Sistema: WhatsApp Cloud API - Sin conexión QR necesaria`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      console.log('📊 Sistema de notificaciones v3.0 - Solo WhatsApp Cloud API');
      console.log('ℹ️ WhatsApp: Usa API oficial - Sin QR, sin sesiones locales');
      console.log('ℹ️ Keep-alive: GitHub Actions cada 5 min (procesa pendientes)');
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📱 WhatsApp Cloud API - Configuración en variables de entorno`);
      console.log(`💡 Variables requeridas:`);
      console.log(`   - WHATSAPP_API_PHONE_NUMBER_ID`);
      console.log(`   - WHATSAPP_API_TOKEN`);
      console.log(`   - USE_WHATSAPP_API=true`);
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