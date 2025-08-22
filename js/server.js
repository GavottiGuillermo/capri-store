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

console.log('📝 Configurando middleware de preflight...');
// Middleware adicional para manejar preflight requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});
console.log('✅ Middleware de preflight configurado');

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
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

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
    
    const { items, payer } = req.body;
    
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
    console.error('❌ Error al crear preferencia:', error);
    res.status(500).json({
      error: 'Error al crear preferencia',
      message: error.message
    });
  }
});
console.log('✅ Endpoint POST /crear-preferencia definido exitosamente');

// ===============================
// ENDPOINT: WEBHOOK DE MERCADO PAGO  
// ===============================
console.log('📝 Definiendo endpoint POST /webhook...');
app.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (type === 'payment') {
      const paymentId = data.id;
      console.log(`💳 Webhook recibido para pago: ${paymentId}`);
      
      // Marcar como procesado
      webhookNotifications.set(paymentId, true);
      
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
          await executeQueryWithRetry(
            pool,
            'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
            [
              JSON.stringify(paymentInfo.additional_info?.items || []),
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
      }
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
    console.log(`Consultando pedido para payment ID: ${paymentId}`);
    
    const pedidoResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        p.id_pedido,
        p.pedido_fecha,
        p.pedido_nombre_cliente,
        p.pedido_monto_total
       FROM productos p
       WHERE p.mp_payment_id = $1 
         AND p.id_pedido IS NOT NULL
       LIMIT 1`,
      [paymentId],
      2
    );
    
    if (pedidoResult.rows.length > 0) {
      const pedido = pedidoResult.rows[0];
      const idPedidoCompleto = pedido.id_pedido;
      const numeroDisplay = idPedidoCompleto.substring(1).slice(-2);
      
      console.log(`✅ Pedido encontrado: ${idPedidoCompleto} -> ${numeroDisplay}`);
      
      res.json({
        existe: true,
        id_pedido_completo: idPedidoCompleto,
        numero_display: numeroDisplay,
        nombre_cliente: pedido.pedido_nombre_cliente,
        total: pedido.pedido_monto_total,
        fecha_pedido: pedido.pedido_fecha
      });
      
    } else {
      console.log(`❌ Pedido no encontrado para payment ID: ${paymentId}`);
      res.json({
        existe: false,
        message: 'Pedido no encontrado',
        payment_id_consultado: paymentId
      });
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
