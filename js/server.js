const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');
const cors = require('cors');

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

const { enviarWhatsApp, inicializarWhatsApp, getWhatsAppStatus, whatsappReady, ADMIN_WHATSAPP, BUSINESS_NAME } = whatsappService;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env en la carpeta padre
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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
  if (req.path === '/health' || req.path === '/' || req.path === '/debug' || req.path === '/contact-info') {
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
  
  // Validar email si se proporciona
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Email no válido');
  }
  
  return errors;
}

// ===============================
// ENDPOINTS BÁSICOS
// ===============================

// Endpoint de salud
app.get('/health', (req, res) => {
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
      admin_email: !!process.env.ADMIN_EMAIL,
      mercadopago_token: !!process.env.MERCADOPAGO_ACCESS_TOKEN
    }
  });
});

// === ESTADO DEL WHATSAPP ===
app.get('/whatsapp-status', (req, res) => {
  res.json(getWhatsAppStatus());
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
      ADMIN_EMAIL: process.env.ADMIN_EMAIL ? 'CONFIGURADO' : 'NO CONFIGURADO',
      MERCADOPAGO_ACCESS_TOKEN: process.env.MERCADOPAGO_ACCESS_TOKEN ? 'CONFIGURADO' : 'NO CONFIGURADO',
      DATABASE_URL: process.env.DATABASE_URL ? 'CONFIGURADO' : 'NO CONFIGURADO'
    },
    endpoints_disponibles: [
      '/health',
      '/debug', 
      '/contact-info',
      '/whatsapp-status'
    ]
  });
});

// === INFORMACIÓN DE CONTACTO ===
app.get('/contact-info', (req, res) => {
  try {
    const contactInfo = {
      whatsapp: process.env.ADMIN_WHATSAPP,
      instagram: process.env.ADMIN_INSTAGRAM,
      email: process.env.ADMIN_EMAIL,
      business_name: BUSINESS_NAME,
      location: 'Zárate, Buenos Aires, Argentina'
    };
    
    // Log para debugging
    console.log('📄 Enviando información de contacto:', {
      whatsapp: contactInfo.whatsapp ? `${contactInfo.whatsapp.substring(0, 4)}****` : 'NO CONFIGURADO',
      instagram: contactInfo.instagram ? 'CONFIGURADO' : 'NO CONFIGURADO',
      email: contactInfo.email ? 'CONFIGURADO' : 'NO CONFIGURADO'
    });
    
    // Validar que al menos uno de los contactos esté configurado
    if (!contactInfo.whatsapp && !contactInfo.instagram && !contactInfo.email) {
      console.warn('⚠️ Ninguna variable de contacto está configurada');
      return res.status(500).json({
        error: 'No hay información de contacto configurada',
        message: 'Variables de entorno ADMIN_WHATSAPP, ADMIN_INSTAGRAM, ADMIN_EMAIL no están configuradas'
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

// ===============================
// ENDPOINTS PRINCIPALES
// ===============================
// FUNCIONES PARA NOTIFICACIONES DE COMPRA
// ===============================

// Función para enviar notificación de compra por WhatsApp
async function enviarNotificacionCompra(customerData, orderData, paymentInfo) {
  if (!whatsappAvailable || !whatsappReady) {
    console.warn('⚠️ WhatsApp no disponible para notificación de compra');
    return { success: false, error: 'WhatsApp no disponible' };
  }

  try {
    const { nombre, apellido, email, telefono } = customerData;
    const { numeroDisplay, idPedidoCompleto } = orderData;
    const { transaction_amount, id: paymentId } = paymentInfo;
    
    const fechaHora = new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Obtener productos del payment info
    const items = paymentInfo.additional_info?.items || [];
    let productosTexto = '';
    
    if (items.length > 0) {
      productosTexto = items.map(item => 
        `• ${item.title || 'Producto'} x${item.quantity || 1} - $${(item.unit_price || 0).toLocaleString('es-AR')}`
      ).join('\n');
    } else {
      productosTexto = '• Productos no especificados';
    }
    
    // Mensaje para administrador
    const mensajeAdmin = `� *NUEVA COMPRA - ${BUSINESS_NAME}* 🛒\n\n` +
      `👤 *Cliente:* ${nombre} ${apellido}\n` +
      `📧 *Email:* ${email || 'No proporcionado'}\n` +
      `📱 *Teléfono:* ${telefono || 'No proporcionado'}\n` +
      `📅 *Fecha:* ${fechaHora}\n\n` +
      `�️ *Productos:*\n${productosTexto}\n\n` +
      `� *Total:* $${transaction_amount.toLocaleString('es-AR')}\n` +
      `🆔 *Pedido:* ${numeroDisplay || idPedidoCompleto}\n` +
      `💳 *Pago ID:* ${paymentId}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ *¡Pago confirmado! Proceder con el envío*`;
    
    const result = await enviarWhatsApp(ADMIN_WHATSAPP, mensajeAdmin);
    
    if (result.success) {
      console.log('✅ Notificación de compra enviada por WhatsApp');
    } else {
      console.error('❌ Error enviando notificación de compra:', result.error);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Error en enviarNotificacionCompra:', error);
    return { success: false, error: error.message };
  }
}

// Inicializar la aplicación
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
        console.log('✅ WhatsApp inicializado correctamente');
      } catch (error) {
        console.error('❌ Error inicializando WhatsApp:', error.message);
        console.log('📧 Continuando sin WhatsApp');
      }
    } else {
      console.log('⚠️ WhatsApp no disponible');
    }
    
    // Iniciar servidor siempre, independientemente de otros servicios
    server = app.listen(PORT, () => {
      console.log(`🚀 Capri Store API escuchando en puerto ${PORT}`);
      console.log(`🌐 URL: http://localhost:${PORT}`);
      console.log(`📱 WhatsApp: ${whatsappAvailable ? 'Disponible' : 'No disponible'}`);
      console.log(`🗄️ Base de datos: ${pool ? 'Conectada' : 'No disponible'}`);
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