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

const { enviarWhatsApp, inicializarWhatsApp, getWhatsAppStatus, forzarReconexion, limpiarSesionCorrupta, limpiarSesionPostgreSQL, resetearContadorQR, sincronizarEstadoWhatsApp, forzarGuardadoSesion, whatsappReady, ADMIN_WHATSAPP, BUSINESS_NAME } = whatsappService;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env en la carpeta padre
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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

// Endpoint de salud (simplificado sin Instance Lock)
app.get('/health', async (req, res) => {  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsapp_available: whatsappAvailable,
    whatsapp_ready: whatsappAvailable ? whatsappReady : false,
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
    }
  });
});

// === ESTADO DEL WHATSAPP ===
app.get('/whatsapp-status', async (req, res) => {
  try {
    const status = await getWhatsAppStatus();
    console.log('📊 Estado WhatsApp consultado:', status);
    res.json(status);
  } catch (error) {
    console.error('❌ Error obteniendo estado WhatsApp:', error);
    res.json({
      whatsapp_ready: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === TEST DE WHATSAPP (para debugging) ===
app.post('/test-whatsapp', express.json(), async (req, res) => {
  try {
    const { numero, mensaje } = req.body;
    
    if (!numero || !mensaje) {
      return res.status(400).json({
        success: false,
        error: 'Faltan parámetros: numero y mensaje requeridos'
      });
    }
    
    console.log('🧪 TEST WhatsApp solicitado:');
    console.log('- Número:', numero);
    console.log('- Mensaje:', mensaje.substring(0, 50) + '...');
    
    const result = await enviarWhatsApp(numero, mensaje);
    
    console.log('🧪 Resultado del test:', result);
    
    res.json({
      success: result.success,
      error: result.error,
      details: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error en test de WhatsApp:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === TEST DE NORMALIZACIÓN DE TELÉFONOS ===
app.post('/test-phone', express.json(), async (req, res) => {
  console.log('🧪 TEST PHONE: Probando normalización de teléfonos');
  
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Parámetro phone requerido'
      });
    }
    
    console.log('📱 Teléfono original:', phone);
    const normalized = normalizePhoneNumber(phone);
    console.log('📱 Teléfono normalizado:', normalized);
    
    res.json({
      success: true,
      original: phone,
      normalized: normalized,
      admin_current: ADMIN_WHATSAPP,
      admin_normalized: normalizePhoneNumber(ADMIN_WHATSAPP),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('🧪 TEST PHONE ERROR:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === TEST DE NOTIFICACIÓN COMPLETA ===
app.post('/test-notification', express.json(), async (req, res) => {
  console.log('🧪 TEST NOTIFICATION: Probando notificación completa');
  
  try {
    // Datos de prueba
    const testCustomerData = {
      nombre: 'Cliente',
      apellido: 'Prueba',
      telefono: '+5493487610270'
    };
    
    const testOrderData = {
      numeroDisplay: '99',
      idPedidoCompleto: 'TEST001'
    };
    
    const testPaymentInfo = {
      transaction_amount: 1000,
      id: 'TEST_PAYMENT_123',
      additional_info: {
        items: [
          {
            title: 'Producto de Prueba',
            quantity: 1,
            unit_price: 1000
          }
        ]
      }
    };
    
    console.log('🧪 Enviando notificación de prueba...');
    const result = await enviarNotificacionCompra(testCustomerData, testOrderData, testPaymentInfo);
    
    res.json({
      success: true,
      notification_result: result,
      test_data: { testCustomerData, testOrderData, testPaymentInfo },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('🧪 TEST NOTIFICATION ERROR:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === FORZAR RECONEXIÓN DE WHATSAPP ===
app.post('/whatsapp-reconnect', async (req, res) => {
  try {
    console.log('🔄 Forzando reconexión de WhatsApp solicitada desde API...');
    
    if (!whatsappAvailable) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service no disponible'
      });
    }
    
    const result = await forzarReconexion();
    
    console.log('🔄 Resultado de reconexión forzada:', result);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error forzando reconexión:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === LIMPIAR SESIÓN CORRUPTA ===
app.post('/whatsapp-clean-session', async (req, res) => {
  try {
    console.log('🧹 Limpieza de sesión WhatsApp solicitada desde API...');
    
    if (!whatsappAvailable) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service no disponible'
      });
    }
    
    const result = await limpiarSesionCorrupta();
    
    console.log('🧹 Resultado de limpieza de sesión:', result);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error limpiando sesión:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === REINICIO COMPLETO DE WHATSAPP ===
app.post('/whatsapp-full-reset', async (req, res) => {
  try {
    console.log('🔄 REINICIO COMPLETO de WhatsApp solicitado... [v2]');
    
    if (!whatsappAvailable) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service no disponible'
      });
    }
    
    // Primero limpiar sesión
    const cleanResult = await limpiarSesionCorrupta();
    
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

// === VERIFICAR SESIÓN POSTGRESQL ===
app.get('/whatsapp-session-check', async (req, res) => {
  try {
    console.log('🗄️ Verificando sesiones en PostgreSQL...');
    
    const query = 'SELECT id, created_at, updated_at FROM whatsapp_sessions ORDER BY updated_at DESC';
    const result = await pool.query(query);
    
    console.log(`📊 Sesiones encontradas: ${result.rows.length}`);
    
    res.json({
      success: true,
      sessions_count: result.rows.length,
      sessions: result.rows.map(row => ({
        id: row.id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        has_data: !!(row.session_data)
      })),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error verificando sesiones:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === FORZAR GUARDADO DE SESIÓN ===
app.post('/whatsapp-force-save', async (req, res) => {
  try {
    console.log('💾 Forzando guardado de sesión...');
    
    // Verificar si estamos usando PostgreSQL
    const usePostgresAuth = !!(process.env.DATABASE_URL);
    if (!usePostgresAuth) {
      return res.json({
        success: false,
        error: 'No se está usando autenticación PostgreSQL',
        current_auth: 'LocalAuth',
        timestamp: new Date().toISOString()
      });
    }
    
    // Verificar estado de WhatsApp
    const status = await getWhatsAppStatus();
    
    if (!status.whatsapp_ready) {
      return res.json({
        success: false,
        error: 'WhatsApp no está conectado',
        whatsapp_status: status,
        timestamp: new Date().toISOString()
      });
    }
    
    // Aquí normalmente forzaríamos el guardado, pero RemoteAuth maneja esto internamente
    console.log('🔄 Sesión debe guardarse automáticamente según backupSyncIntervalMs (5 min)');
    
    res.json({
      success: true,
      message: 'WhatsApp conectado con PostgreSQL - Sesión se guarda automáticamente cada 5 minutos',
      whatsapp_status: status,
      next_backup_in_minutes: 5,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error forzando guardado:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === LIMPIAR SOLO SESIÓN POSTGRESQL ===
app.post('/whatsapp-clean-postgres', async (req, res) => {
  try {
    console.log('🗄️ Endpoint de limpieza PostgreSQL llamado');
    
    const result = await limpiarSesionPostgreSQL();
    
    if (result.success) {
      console.log('✅ Sesión PostgreSQL limpiada exitosamente');
      res.json({
        success: true,
        message: result.message,
        timestamp: result.timestamp,
        next_steps: [
          '1. Reinicia el servidor para reconectar',
          '2. Se generará nuevo QR para escanear',
          '3. La nueva sesión se guardará en PostgreSQL'
        ]
      });
    } else {
      res.status(500).json(result);
    }
    
  } catch (error) {
    console.error('❌ Error limpiando PostgreSQL:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === LIMPIAR SESIÓN EXPIRADA AUTOMÁTICAMENTE ===
app.post('/whatsapp-clean-expired', async (req, res) => {
  try {
    console.log('🔄 Limpieza automática de sesión expirada solicitada...');
    
    if (!whatsappAvailable) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service no disponible'
      });
    }
    
    // Verificar estado actual
    const status = await getWhatsAppStatus();
    
    if (status.whatsapp_ready) {
      return res.json({
        success: true,
        message: 'WhatsApp ya está conectado - no es necesaria limpieza',
        current_status: status
      });
    }
    
    // Si hay sesión pero no está conectado, limpiar
    if (status.auth_folder && status.auth_folder.exists && !status.qr_generated) {
      console.log('🧹 Detectada sesión existente pero no conectada - limpiando...');
      
      const cleanResult = await limpiarSesionCorrupta();
      
      if (cleanResult.success) {
        res.json({
          success: true,
          message: 'Sesión expirada limpiada automáticamente - Se generará nuevo QR',
          clean_result: cleanResult,
          next_steps: [
            'Espera 10-15 segundos',
            'Verifica /whatsapp-status para el nuevo QR',
            'Escanea el QR con WhatsApp'
          ]
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error limpiando sesión expirada',
          details: cleanResult
        });
      }
    } else {
      res.json({
        success: true,
        message: 'No hay sesión expirada para limpiar',
        current_status: status
      });
    }
    
  } catch (error) {
    console.error('❌ Error en limpieza automática:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === RESETEAR CONTADOR QR ===
app.post('/whatsapp-reset-qr-counter', async (req, res) => {
  try {
    console.log('🔄 Reseteando contador QR solicitado desde API...');
    
    if (!whatsappAvailable) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service no disponible'
      });
    }
    
    const result = resetearContadorQR();
    
    console.log('🔄 Resultado reseteo contador QR:', result);
    res.json({
      success: true,
      message: `Contador QR reseteado de ${result.anterior} a ${result.actual}`,
      previous_attempts: result.anterior,
      current_attempts: result.actual,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error reseteando contador QR:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === SINCRONIZAR ESTADO WHATSAPP ===
app.post('/whatsapp-sync-state', async (req, res) => {
  try {
    console.log('🔄 Sincronización de estado WhatsApp solicitada desde API...');
    
    if (!whatsappAvailable) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service no disponible'
      });
    }
    
    const result = await sincronizarEstadoWhatsApp();
    
    console.log('🔄 Resultado sincronización estado:', result);
    res.json({
      success: result.success,
      action: result.action || 'unknown',
      message: result.action === 'flag_updated' ? 
        `Estado sincronizado: ${result.previous} -> ${result.current}` :
        'Estado ya estaba sincronizado',
      previous_flag: result.previous,
      current_flag: result.current,
      client_state: result.state,
      error: result.error,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error sincronizando estado:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// === FORZAR GUARDADO INMEDIATO DE SESIÓN ===
app.post('/whatsapp-save-session-now', async (req, res) => {
  try {
    console.log('💾 Guardado inmediato de sesión solicitado desde API...');
    
    if (!whatsappAvailable) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service no disponible'
      });
    }
    
    const result = await forzarGuardadoSesion();
    
    console.log('💾 Resultado guardado inmediato:', result);
    res.json({
      success: result.success,
      message: result.message || (result.success ? 'Sesión guardada exitosamente' : 'Error al guardar sesión'),
      client_id: result.client_id,
      client_state: result.state,
      error: result.error,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error forzando guardado inmediato:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
      client_ready: whatsappAvailable ? whatsappReady : false,
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
    
    // Normalizar teléfono del comprador
    const telefonoNormalizado = normalizePhoneNumber(datosComprador.telefono);
    if (!telefonoNormalizado) {
      console.error('❌ Formato de teléfono inválido:', datosComprador.telefono);
      return res.status(400).json({ 
        error: 'Formato de teléfono inválido' 
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
    
    const preferenceData = {
      items: items.map(item => ({
        id: String(item.id || 'producto'),
        title: item.title || item.nombre || 'Producto',
        quantity: Number(item.quantity || item.cantidad || 1),
        currency_id: 'ARS',
        unit_price: Number(item.unit_price || item.precio || 0)
      })),
      payer: {
        name: datosComprador.nombre || '',
        surname: datosComprador.apellido || '',
        email: `${datosComprador.telefono}@whatsapp.temp`, // Email temporal generado del teléfono
        phone: {
          area_code: '',
          number: String(datosComprador.telefono || '')
        }
      },
      back_urls: {
        success: `${baseUrl}/success.html`,
        failure: `${baseUrl}/failure.html`,
        pending: `${baseUrl}/pending.html`
      },
      auto_return: 'approved',
      notification_url: `https://capri-store.onrender.com/webhook`,
      metadata: {
        tipo_entrega: datosComprador.tipoEntrega || 'retiro',
        costo_envio: datosComprador.costoEnvio || 0,
        datos_envio: JSON.stringify(datosComprador.datosEnvio || {}),
        telefono: datosComprador.telefono,
        timestamp: new Date().toISOString()
      }
    };
    
    console.log('📋 Creando preferencia con', items.length, 'items');
    
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

async function enviarNotificacionCompra(customerData, orderData, paymentInfo) {
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
    console.log(`[${timestamp}] - whatsappReady flag: ${whatsappReady}`);
    console.log(`[${timestamp}] - ADMIN_WHATSAPP: ${ADMIN_WHATSAPP ? `${ADMIN_WHATSAPP.substring(0, 4)}****` : 'NO CONFIGURADO'}`);
    
    if (!whatsappAvailable) {
      console.error(`[${timestamp}] ❌ WhatsApp service no está disponible (no se pudo cargar el módulo)`);
      return { success: false, error: 'WhatsApp service no disponible' };
    }

  // NUEVA VERIFICACIÓN: Comprobar estado real del cliente independientemente del flag
  let realClientState = null;
  let clientReady = whatsappReady;
  
  try {
    const statusCheck = await getWhatsAppStatus();
    realClientState = statusCheck.client_state;
    
    // MEJORA: Si vemos CONNECTED en logs pero getState falla, usar verificación alternativa
    if (realClientState === null || realClientState === undefined) {
      // Buscar "CONNECTED" en los logs recientes o asumir conectado si flag es true
      if (whatsappReady) {
        console.log(`[${timestamp}] 🔄 Estado null pero flag true, asumiendo CONNECTED`);
        realClientState = 'CONNECTED';
      }
    }
    
    clientReady = statusCheck.whatsapp_ready || realClientState === 'CONNECTED' || whatsappReady;
    
    console.log(`[${timestamp}] 🔍 Verificación estado en enviarNotificacionCompra:`);
    console.log(`[${timestamp}] - Flag whatsappReady: ${whatsappReady}`);
    console.log(`[${timestamp}] - Estado real del cliente: ${realClientState}`);
    console.log(`[${timestamp}] - Cliente listo calculado: ${clientReady}`);
    
  } catch (statusError) {
    console.warn(`[${timestamp}] ⚠️ No se pudo verificar estado real, usando flag: ${statusError.message}`);
    // Si hay error pero el flag es true, intentar envío
    if (whatsappReady) {
      clientReady = true;
      realClientState = 'CONNECTED (fallback)';
      console.log(`[${timestamp}] 🔄 Error en verificación pero flag true, intentando envío`);
    }
  }

  if (!clientReady) {
    console.error(`[${timestamp}] ❌ WhatsApp no está listo para envío:`);
    console.error(`[${timestamp}] - Flag whatsappReady: ${whatsappReady}`);
    console.error(`[${timestamp}] - Estado real cliente: ${realClientState}`);
    console.error(`[${timestamp}] - Cliente listo calculado: ${clientReady}`);
    return { success: false, error: `WhatsApp no está listo. Flag: ${whatsappReady}, Estado: ${realClientState}` };
  }

  if (!ADMIN_WHATSAPP) {
    console.error(`[${timestamp}] ❌ ADMIN_WHATSAPP no está configurado en variables de entorno`);
    return { success: false, error: 'Número de administrador no configurado' };
  }

  console.log(`[${timestamp}] 📋 Datos de la compra:`);
    
    // Extraer datos con valores por defecto seguros
    const { nombre = '', apellido = '', telefono = '' } = customerData || {};
    const { numeroDisplay = 'N/A', idPedidoCompleto = 'N/A' } = orderData || {};
    const { transaction_amount = 0, id: paymentId = 'N/A' } = paymentInfo || {};
    
    console.log(`[${timestamp}] - Cliente: ${nombre} ${apellido}`);
    console.log(`[${timestamp}] - Teléfono: ${telefono || 'No proporcionado'}`);
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
      productosTexto = items.map((item, index) => {
        const title = item?.title || 'Producto sin nombre';
        const quantity = item?.quantity || 1;
        const unit_price = item?.unit_price || 0;
        
        console.log(`[${timestamp}] - Item ${index + 1}: ${title} x${quantity} - $${unit_price}`);
        return `• ${title} x${quantity} - $${unit_price.toLocaleString('es-AR')}`;
      }).join('\n');
    } else {
      console.log(`[${timestamp}] ⚠️ No se encontraron items válidos en paymentInfo`);
      productosTexto = '• Información de productos no disponible';
    }
    
    // Mensaje para administrador
    const businessName = BUSINESS_NAME || 'Tienda Online';
    const mensajeAdmin = `🛒 *NUEVA COMPRA - ${businessName}* 🛒\n\n` +
      `👤 *Cliente:* ${nombre} ${apellido}\n` +
      ` *Teléfono:* ${telefono || 'No proporcionado'}\n` +
      `📅 *Fecha:* ${fechaHora}\n\n` +
      `🛍️ *Productos:*\n${productosTexto}\n\n` +
      `💰 *Total:* $${transaction_amount.toLocaleString('es-AR')}\n` +
      `🆔 *Pedido:* ${numeroDisplay || idPedidoCompleto}\n` +
      `💳 *Pago ID:* ${paymentId}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ *¡Pago confirmado! Proceder con el envío*`;
    
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
    
    // 2. ENVIAR CONFIRMACIÓN AL CLIENTE
    let resultCliente = { success: false, error: 'No se intentó enviar' };
    
    if (telefono && telefono.trim()) {
      console.log(`[${timestamp}] 📱 Enviando confirmación al cliente: ${telefono}`);
      
      // Mensaje para el cliente
      const mensajeCliente = `🎉 *¡Gracias por tu compra en ${businessName}!* 🎉\n\n` +
        `✅ *Tu pago ha sido procesado exitosamente*\n\n` +
        `📋 *Detalles de tu pedido:*\n` +
        `🆔 *Número:* ${numeroDisplay || idPedidoCompleto}\n` +
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
    return {
      success: resultAdmin.success,
      admin_result: resultAdmin,
      cliente_result: resultCliente,
      both_sent: resultAdmin.success && resultCliente.success
    };
    
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
  console.log(`[${timestamp}] Headers:`, JSON.stringify(req.headers, null, 2));
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
                try {
                  const statusCheck = await getWhatsAppStatus();
                  realClientState = statusCheck.client_state;
                  
                  // MEJORA: Ser más tolerante con estados null/undefined
                  if (realClientState === null || realClientState === undefined) {
                    if (whatsappReady) {
                      console.log(`[${timestamp}] 🔄 Estado null pero flag true, asumiendo CONNECTED`);
                      realClientState = 'CONNECTED';
                    }
                  }
                  
                  canSendWhatsApp = statusCheck.whatsapp_ready || realClientState === 'CONNECTED' || whatsappReady;
                  
                  console.log(`[${timestamp}] 🔍 Verificación estado real:`);
                  console.log(`[${timestamp}] - Flag whatsappReady: ${whatsappReady}`);
                  console.log(`[${timestamp}] - Estado real cliente: ${realClientState}`);
                  console.log(`[${timestamp}] - Puede enviar: ${canSendWhatsApp}`);
                  
                } catch (statusError) {
                  console.error(`[${timestamp}] ❌ Error verificando estado real:`, statusError.message);
                  // Si hay error pero el flag es true, intentar envío
                  if (whatsappReady) {
                    canSendWhatsApp = true;
                    realClientState = 'CONNECTED (fallback)';
                    console.log(`[${timestamp}] 🔄 Error en verificación pero flag true, intentando envío`);
                  } else {
                    canSendWhatsApp = whatsappReady; // Fallback al flag original
                  }
                }
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
      try {
        await inicializarWhatsApp();
        console.log('✅ WhatsApp service inicializado (esperando autenticación)');
      } catch (error) {
        console.error('❌ Error inicializando WhatsApp:', error.message);
        console.log('📧 Continuando sin WhatsApp');
        whatsappAvailable = false;
      }
    } else {
      console.log('⚠️ WhatsApp no disponible');
    }
    
    // Configurar optimización de memoria
    setupMemoryOptimization();
    
    // Iniciar servidor siempre, independientemente de otros servicios
    server = app.listen(PORT, () => {
      console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
      console.log(`🚀 Capri Store API escuchando en puerto ${PORT}`);
      console.log(`🌐 URL: http://localhost:${PORT}`);
      
      // Estado de WhatsApp más preciso
      if (whatsappAvailable) {
        console.log(`📱 WhatsApp: Inicializando (esperando autenticación)`);
      } else {
        console.log(`📱 WhatsApp: No disponible`);
      }
      
      console.log(`🗄️ Base de datos: ${pool ? 'Conectada' : 'No disponible'}`);
      console.log(`⚙️ Sistema: Simplificado - Una sola instancia con PostgreSQL sessions`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      if (whatsappAvailable) {
        console.log(`📱 BUSCA EL CÓDIGO QR ARRIBA ☝️ PARA ESCANEAR`);
        console.log(`📲 Usa WhatsApp > Dispositivos Vinculados > Vincular`);
      }
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    });
    
  } catch (error) {
    console.error('❌ Error crítico al iniciar servidor:', error);
    
    // Intentar iniciar servidor básico aunque haya errores
    try {
      server = app.listen(PORT, () => {
        console.log(`🚨 Servidor en modo de emergencia en puerto ${PORT}`);
        console.log(`⚠️ Algunos servicios pueden no estar disponibles`);
      });
    } catch (criticalError) {
      console.error('💥 Error crítico - No se puede iniciar el servidor:', criticalError);
      process.exit(1);
    }
  }
}

startServer();