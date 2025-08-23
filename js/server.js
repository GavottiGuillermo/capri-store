const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env en la carpeta padre
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('🔧 === INICIANDO SERVIDOR ===');
console.log('📂 Directorio de trabajo:', __dirname);
console.log('🌐 NODE_ENV:', process.env.NODE_ENV || 'development');

// ===============================
// VALIDACIÓN DE VARIABLES DE ENTORNO
// ===============================
console.log('🔧 Validando configuración...');

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.log('⚠️ Configuración de email incompleta');
}

if (process.env.ADMIN_EMAILS) {
  const adminEmails = process.env.ADMIN_EMAILS.split(',').map(email => email.trim());
  console.log('✅ Emails administrativos configurados:', adminEmails.length, 'emails');
} else {
  console.log('⚠️ ADMIN_EMAILS no configurado');
}

console.log('✅ Creando instancia de Express...');
const app = express();
console.log('✅ Express app creada exitosamente');

// Almacén en memoria para notificaciones de webhook
const webhookNotifications = new Map();

console.log('🔧 Configurando middlewares básicos...');

// ===============================
// CONFIGURACIÓN DE MIDDLEWARES
// ===============================
console.log('📝 Configurando CORS...');
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000', 
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'https://capristorezte.com.ar',
    'https://www.capristorezte.com.ar'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
}));
console.log('✅ CORS configurado exitosamente');

console.log('📝 Configurando parsers JSON y URL...');
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
console.log('✅ Parsers configurados exitosamente');

console.log('📝 Configurando middleware de preflight (alternativo)...');
// Middleware CORS alternativo más explícito
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});
console.log('✅ Middleware de preflight alternativo configurado');

console.log('📝 Configurando archivos estáticos...');
// Servir archivos estáticos desde la carpeta raíz
app.use(express.static(path.join(__dirname, '..')));
console.log('✅ Archivos estáticos configurados');

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
    console.log('✅ Conexión a PostgreSQL exitosa');

    // Verificar si existe la columna mp_payment_id
    const client2 = await pool.connect();
    const checkColumn = await client2.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'productos' 
        AND column_name = 'mp_payment_id'
    `);
    client2.release();

    if (checkColumn.rows.length > 0) {
      console.log('✅ Columna mp_payment_id existe en tabla productos');
    } else {
      console.log('⚠️ ATENCIÓN: Columna mp_payment_id NO existe en tabla productos');
      console.log('💡 Ejecuta: ALTER TABLE productos ADD COLUMN mp_payment_id TEXT;');
    }

  } catch (error) {
    console.error('❌ Error de conexión a PostgreSQL:', error.message);
    throw error;
  }
}

// ===============================
// CONFIGURACIÓN DE MERCADO PAGO
// ===============================
console.log('🔧 Configurando MercadoPago...');

// Validar token de acceso
if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
  console.error('❌ ERROR CRÍTICO: MERCADOPAGO_ACCESS_TOKEN no está configurado en las variables de entorno');
  process.exit(1);
}

// Verificar formato del token
const tokenStart = process.env.MERCADOPAGO_ACCESS_TOKEN.substring(0, 20);
console.log('🔑 Token MercadoPago configurado:', tokenStart + '...');

if (process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('TEST-')) {
  console.log('🧪 Usando token de PRUEBA de MercadoPago');
} else if (process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('APP_USR-')) {
  console.log('🚀 Usando token de PRODUCCIÓN de MercadoPago');
} else {
  console.warn('⚠️ Formato de token no reconocido - verificar configuración');
}

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
console.log('✅ Cliente MercadoPago configurado correctamente');

// ===============================
// FUNCIONES AUXILIARES
// ===============================
async function executeQueryWithRetry(pool, query, params, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(query, params);
        client.release();
        return result;
      } catch (error) {
        client.release();
        throw error;
      }
    } catch (error) {
      console.error(`Intento ${attempt}/${maxRetries} falló:`, error.message);
      lastError = error;
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  throw lastError;
}

// ===============================
// ENDPOINT: CREAR PREFERENCIA DE MERCADO PAGO
// ===============================
console.log('📝 Definiendo endpoint POST /crear-preferencia...');
app.post('/crear-preferencia', async (req, res) => {
  // Headers CORS explícitos para este endpoint
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  try {
    console.log('Creando preferencia de pago...');
    console.log('📦 Datos recibidos:', JSON.stringify(req.body, null, 2));
    
    const { items, datosComprador } = req.body;
    
    // Validar datos requeridos
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Items requeridos',
        message: 'Se requiere al menos un item'
      });
    }
    
    if (!datosComprador || !datosComprador.email) {
      console.log('❌ Datos comprador recibidos:', datosComprador);
      return res.status(400).json({
        error: 'Datos del comprador incompletos',
        message: 'Email del comprador es requerido',
        received_data: datosComprador
      });
    }
    
    console.log('📧 Email del comprador:', datosComprador.email);
    console.log('🛍️ Items:', items.length, 'productos');
    
    // Construir objeto payer para MercadoPago
    const payer = {
      name: datosComprador.nombre || '',
      surname: datosComprador.apellido || '',
      email: datosComprador.email,
      phone: {
        area_code: '11', // Código de área por defecto para Argentina
        number: datosComprador.telefono?.replace(/\D/g, '') || ''
      }
    };
    
    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: items,
        payer: payer,
        back_urls: {
          success: `${req.headers.origin || 'https://capristorezte.com.ar'}/success.html`,
          failure: `${req.headers.origin || 'https://capristorezte.com.ar'}/failure.html`,
          pending: `${req.headers.origin || 'https://capristorezte.com.ar'}/pending.html`
        },
        auto_return: 'approved',
        notification_url: 'https://capri-store.onrender.com/webhook',
        external_reference: JSON.stringify({
          customer_email: payer.email,
          customer_phone: payer.phone?.number || '',
          timestamp: Date.now()
        })
      }
    });
    
    console.log('✅ Preferencia creada exitosamente');
    res.json({
      preference_id: result.id,
      init_point: result.init_point
    });
    
  } catch (error) {
    console.error('❌ Error al crear preferencia:');
    console.error('📋 Detalles completos del error:', JSON.stringify(error, null, 2));
    console.error('🔍 Mensaje:', error.message);
    console.error('🔍 Código:', error.status || error.code);
    
    // Errores específicos de MercadoPago
    if (error.message === 'invalid_token') {
      console.error('🔑 Error de token - verificar MERCADOPAGO_ACCESS_TOKEN en variables de entorno');
      return res.status(401).json({
        error: 'Error de autenticación con MercadoPago',
        message: 'Token de acceso inválido o expirado',
        details: 'Verificar configuración de MERCADOPAGO_ACCESS_TOKEN'
      });
    }
    
    res.status(500).json({
      error: 'Error al crear preferencia',
      message: error.message,
      mp_error: error
    });
  }
});
console.log('✅ Endpoint POST /crear-preferencia definido exitosamente');

// ===============================
// ENDPOINT: WEBHOOK DE MERCADO PAGO  
// ===============================
console.log('📝 Definiendo endpoint POST /webhook...');
app.post('/webhook', async (req, res) => {
  console.log('🚨 === WEBHOOK RECIBIDO ===');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('🌐 Headers:', JSON.stringify(req.headers, null, 2));
  
  try {
    console.log('🔔 Webhook recibido - datos completos:', JSON.stringify(req.body, null, 2));
    
    const { type, data, action, topic, resource } = req.body;
    
    // Filtrar solo los eventos de pago que necesitamos procesar
    let paymentId = null;
    let shouldProcess = false;
    
    if (type === 'payment' && data?.id) {
      paymentId = data.id;
      shouldProcess = true;
      console.log(`💳 Webhook payment recibido para pago: ${paymentId}`);
    } else if (action === 'payment.created' && data?.id) {
      paymentId = data.id;
      shouldProcess = true;
      console.log(`💳 Webhook payment.created recibido para pago: ${paymentId}`);
    } else if (topic === 'payment' && resource) {
      paymentId = resource;
      shouldProcess = true;
      console.log(`� Webhook topic payment recibido para pago: ${paymentId}`);
    } else {
      console.log(`ℹ️ Webhook ignorado - tipo: ${type || topic}, action: ${action}`);
      return res.status(200).send('OK - Ignored');
    }
    
    if (shouldProcess && paymentId) {
      // VERIFICACIÓN CRÍTICA: Solo procesar si NO ha sido procesado antes
      if (webhookNotifications.has(paymentId)) {
        console.log(`⚠️ Pago ${paymentId} ya fue procesado anteriormente - IGNORANDO WEBHOOK`);
        return res.status(200).send('OK - Already processed');
      }
      
      // MARCAR INMEDIATAMENTE como procesado para evitar race conditions
      webhookNotifications.set(paymentId, true);
      console.log(`🔒 Pago ${paymentId} marcado como procesado - procediendo...`);
      console.log(`🔍 Procesando pago: ${paymentId}`);
      
      // Obtener información del pago
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });
      
      if (paymentInfo.status === 'approved') {
        console.log('✅ Pago aprobado, procesando pedido...');
        
        // Extraer información del external_reference
        let customerData = {};
        try {
          if (paymentInfo.external_reference) {
            customerData = JSON.parse(paymentInfo.external_reference);
          }
        } catch (error) {
          console.log('⚠️ No se pudo parsear external_reference');
        }
        
        // Procesar el pedido con stored procedure
        try {
          // Extraer IDs de productos del payment info
          const items = paymentInfo.additional_info?.items || [];
          const productIds = items.map(item => item.id).join(',');
          
          console.log('🛍️ Items completos recibidos:', JSON.stringify(items, null, 2));
          console.log('🏷️ Productos a procesar (IDs):', productIds);
          console.log('💰 Monto total:', paymentInfo.transaction_amount);
          console.log('👤 Cliente:', customerData.customer_email);
          console.log('📞 Teléfono:', customerData.customer_phone);
          
          console.log('🔧 === LLAMANDO AL STORED PROCEDURE ===');
          console.log('Parámetros:', [
            productIds,
            paymentInfo.transaction_amount,
            paymentInfo.payer?.first_name || 'Cliente Web',
            customerData.customer_email || paymentInfo.payer?.email || 'cliente@web.com',
            customerData.customer_phone || '',
            'MercadoPago',
            'Retiro',
            paymentId
          ]);
          
          await executeQueryWithRetry(
            pool,
            'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
            [
              productIds, // IDs separados por comas en lugar de JSON
              paymentInfo.transaction_amount,
              paymentInfo.payer?.first_name || 'Cliente Web',
              customerData.customer_email || paymentInfo.payer?.email || 'cliente@web.com',
              customerData.customer_phone || '',
              'MercadoPago',
              'Retiro',
              paymentId
            ]
          );
          
          console.log('✅ Pedido procesado exitosamente por webhook');
        } catch (error) {
          console.error('❌ Error al procesar pedido en webhook:', error);
        }
      } else {
        console.log(`⚠️ Pago ${paymentId} no está aprobado - estado: ${paymentInfo.status}`);
      }
    } else {
      console.log(`ℹ️ No se encontró paymentId válido en el webhook`);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.status(500).send('Error');
  }
});
console.log('✅ Endpoint POST /webhook definido exitosamente');

// ===============================
// ENDPOINT: STATUS DEL WEBHOOK - SIMPLIFICADO TEMPORALMENTE
// ===============================
console.log('📝 Definiendo endpoints de webhook status...');
app.get('/webhook-status-test', (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  const paymentId = req.query.paymentId;
  const processed = webhookNotifications.has(paymentId);
  
  res.json({ processed, payment_id: paymentId, status: 'test-ok' });
});

console.log('📝 Definiendo endpoint GET /webhook-status/:paymentId...');
app.get('/webhook-status/:paymentId', (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  const { paymentId } = req.params;
  const processed = webhookNotifications.has(paymentId);
  
  res.json({ processed, payment_id: paymentId });
});
console.log('✅ Endpoint GET /webhook-status/:paymentId definido');

// ===============================
// ENDPOINT PRINCIPAL: CONSULTAR PEDIDO POR MP_PAYMENT_ID
// ===============================
console.log('📝 Definiendo endpoints de número de pedido...');
// Versión de test sin parámetros de ruta
app.get('/numero-pedido-test', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  res.json({ status: 'endpoint-test-ok', message: 'Endpoint funcionando' });
});

console.log('📝 Definiendo endpoint GET /numero-pedido/:paymentId...');
app.get('/numero-pedido/:paymentId', async (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  try {
    const { paymentId } = req.params;
    console.log(`🔍 === ENDPOINT CONSULTA PEDIDO ===`);
    console.log(`Payment ID recibido: ${paymentId}`);
    console.log(`Headers de la petición:`, req.headers.origin);
    
    // Primero, vamos a verificar qué datos tenemos en la BD para este payment_id
    console.log(`🔍 Verificando datos en BD para payment_id: ${paymentId}`);
    
    const debugResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        p.id_articulo,
        p.mp_payment_id,
        p.id_pedido,
        p.estado,
        p.pedido_fecha,
        p.pedido_nombre_cliente,
        p.pedido_monto_total
       FROM productos p
       WHERE p.mp_payment_id = $1 OR p.mp_payment_id = $2
       ORDER BY p.pedido_fecha DESC`,
      [paymentId, paymentId.toString()],
      2
    );
    
    console.log(`🔍 Resultados debug (${debugResult.rows.length} filas):`, debugResult.rows);
    
    const pedidoResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        p.id_pedido,
        p.pedido_fecha,
        p.pedido_nombre_cliente,
        p.pedido_monto_total,
        p.mp_payment_id
       FROM productos p
       WHERE (p.mp_payment_id = $1 OR p.mp_payment_id = $2)
         AND p.id_pedido IS NOT NULL
         AND p.id_pedido != ''
       ORDER BY p.pedido_fecha DESC
       LIMIT 1`,
      [paymentId, paymentId.toString()],
      2
    );
    
    if (pedidoResult.rows.length > 0) {
      const pedido = pedidoResult.rows[0];
      const idPedidoCompleto = pedido.id_pedido;
      
      // Mejorar el cálculo del número display
      let numeroDisplay = idPedidoCompleto;
      if (idPedidoCompleto.length >= 2) {
        numeroDisplay = idPedidoCompleto.slice(-2); // Últimos 2 dígitos/caracteres
      }
      
      console.log(`✅ Pedido encontrado: ${idPedidoCompleto} -> ${numeroDisplay}`);
      console.log(`🔧 Cálculo: "${idPedidoCompleto}" -> últimos 2: "${numeroDisplay}"`);
      
      const respuesta = {
        existe: true,
        id_pedido_completo: idPedidoCompleto,
        numero_display: numeroDisplay,
        nombre_cliente: pedido.pedido_nombre_cliente,
        total: pedido.pedido_monto_total,
        fecha_pedido: pedido.pedido_fecha
      };
      
      console.log(`📤 Enviando respuesta al frontend:`, respuesta);
      res.json(respuesta);
      
    } else {
      console.log(`❌ Pedido no encontrado para payment ID: ${paymentId}`);
      
      // Verificar si hay algún registro para este payment_id (sin importar id_pedido)
      const checkResult = await executeQueryWithRetry(
        pool,
        `SELECT COUNT(*) as count FROM productos WHERE mp_payment_id = $1 OR mp_payment_id = $2`,
        [paymentId, paymentId.toString()],
        1
      );
      
      console.log(`🔍 Registros encontrados con este payment_id: ${checkResult.rows[0]?.count || 0}`);
      
      const respuestaError = {
        existe: false,
        message: 'Pedido no encontrado',
        payment_id_consultado: paymentId
      };
      
      console.log(`📤 Enviando respuesta de error:`, respuestaError);
      res.json(respuestaError);
    }
    
  } catch (error) {
    console.error('❌ Error al consultar pedido:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});
console.log('✅ Endpoint GET /numero-pedido/:paymentId definido');

// ===============================
// ENDPOINT: CONSULTAR ESTADO DE STOCK DE PRODUCTOS
// ===============================
console.log('📝 Definiendo endpoint GET /stock-productos...');
app.get('/stock-productos', async (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  try {
    console.log(`🔍 === CONSULTA DE STOCK DE PRODUCTOS ===`);
    console.log(`Headers de la petición:`, req.headers.origin);
    
    // Consultar estado de todos los productos
    const stockResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        id_articulo,
        estado,
        (CASE 
          WHEN estado = 'Disponible' THEN true 
          ELSE false 
        END) as disponible
       FROM productos 
       WHERE id_articulo IS NOT NULL
       GROUP BY id_articulo, estado
       ORDER BY id_articulo`,
      [],
      2
    );
    
    console.log(`📊 Stock consultado - ${stockResult.rows.length} productos encontrados`);
    
    // Procesar resultados para crear un objeto de fácil consulta
    const stockMap = {};
    stockResult.rows.forEach(row => {
      stockMap[row.id_articulo] = {
        disponible: row.disponible,
        estado: row.estado
      };
    });
    
    console.log(`📤 Enviando información de stock:`, stockMap);
    
    res.json({
      success: true,
      stock: stockMap,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error al consultar stock:', error);
    res.status(500).json({
      success: false,
      error: 'Error al consultar stock de productos',
      message: error.message
    });
  }
});
console.log('✅ Endpoint GET /stock-productos definido exitosamente');

// ===============================
// ENDPOINT: STOCK AGOTADO (Compatible con frontend existente)
// ===============================
console.log('📝 Definiendo endpoint GET /stock-agotado...');
app.get('/stock-agotado', async (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  try {
    console.log(`🔍 === CONSULTA DE STOCK AGOTADO ===`);
    console.log(`Headers de la petición:`, req.headers.origin);
    
    // Consultar productos que NO están disponibles
    const stockResult = await executeQueryWithRetry(
      pool,
      `SELECT DISTINCT id_articulo
       FROM productos 
       WHERE estado != 'Disponible' 
       AND id_articulo IS NOT NULL`,
      [],
      2
    );
    
    console.log(`📊 Stock agotado consultado - ${stockResult.rows.length} productos sin stock`);
    
    // Extraer solo los IDs de productos agotados
    const idsAgotados = stockResult.rows.map(row => parseInt(row.id_articulo));
    
    console.log(`📤 IDs de productos agotados:`, idsAgotados);
    
    res.json({
      success: true,
      ids: idsAgotados,
      timestamp: new Date().toISOString(),
      count: idsAgotados.length
    });
    
  } catch (error) {
    console.error('❌ Error al consultar stock agotado:', error);
    res.status(500).json({
      success: false,
      ids: [],
      error: 'Error al consultar stock agotado',
      message: error.message
    });
  }
});
console.log('✅ Endpoint GET /stock-agotado definido exitosamente');

// ===============================
// ENDPOINT DE SALUD
// ===============================
console.log('📝 Definiendo endpoints básicos...');
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'capri-store-api'
  });
});

// Endpoint de test básico
app.get('/', (req, res) => {
  res.json({ 
    message: 'Capri Store API funcionando', 
    endpoints: ['/health', '/crear-preferencia', '/webhook', '/numero-pedido/:paymentId'] 
  });
});

// Manejo de errores global
app.use((error, req, res, next) => {
  console.error('💥 Error global capturado:', error);
  res.status(500).json({ 
    error: 'Error interno del servidor', 
    message: error.message,
    timestamp: new Date().toISOString() 
  });
});
console.log('✅ Todos los endpoints definidos exitosamente');

// ===============================
// SERVIDOR HTTP
// ===============================
const PORT = process.env.PORT || 3000;

let server;

// Inicializar la aplicación
async function startServer() {
  try {
    await initializeDatabase();
    
    server = app.listen(PORT, () => {
      console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
      console.log(`🌐 Accesible en: http://localhost:${PORT}`);
    });
    
  } catch (error) {
    console.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
}

// Manejo de cierre del servidor
process.on('SIGTERM', () => {
  console.log('📴 Recibida señal SIGTERM, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado exitosamente');
  });
});

process.on('SIGINT', () => {
  console.log('📴 Recibida señal SIGINT, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado exitosamente');
  });
});

// Iniciar el servidor
startServer();
