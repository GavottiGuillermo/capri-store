const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
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
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  try {
    console.log('--- INICIO /crear-preferencia ---');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body recibido:', JSON.stringify(req.body, null, 2));
    console.log('Creando preferencia de pago...');
    console.log('📦 Datos recibidos:', JSON.stringify(req.body, null, 2));

    const { items, datosComprador } = req.body;

    // Validar datos requeridos
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.log('❌ Error: Items requeridos no presentes o vacíos');
      return res.status(400).json({
        error: 'Items requeridos',
        message: 'Se requiere al menos un item',
        received: req.body
      });
    }

    if (!datosComprador || !datosComprador.email) {
      console.log('❌ Error: Datos del comprador incompletos:', datosComprador);
      return res.status(400).json({
        error: 'Datos del comprador incompletos',
        message: 'Email del comprador es requerido',
        received_data: datosComprador
      });
    }

    // Validar que cada item tenga los campos requeridos por MercadoPago
    const itemsMP = items.map((item, idx) => {
      if (!item.id_articulo && !item.id) {
        console.log(`❌ Error: El item en posición ${idx} no tiene id_articulo ni id`, item);
        throw new Error(`El item en posición ${idx} no tiene id_articulo ni id`);
      }
      const mapped = {
        id: item.id_articulo ? String(item.id_articulo) : String(item.id),
        title: item.nombre || item.title || 'Producto Capri',
        quantity: item.cantidad || item.quantity || 1,
        currency_id: 'ARS',
        unit_price: item.precio || item.unit_price || 0
      };
      console.log(`Item mapeado para MP [${idx}]:`, mapped);
      return mapped;
    });

    for (const [idx, item] of itemsMP.entries()) {
      if (!item.id || !item.title || !item.unit_price || !item.quantity) {
        console.log(`❌ Error: El item en posición ${idx} no tiene todos los campos requeridos`, item);
        return res.status(400).json({
          error: 'Item inválido',
          message: `El item en posición ${idx} no tiene todos los campos requeridos`,
          item
        });
      }
    }

    const payer = {
      name: datosComprador.nombre || '',
      surname: datosComprador.apellido || '',
      email: datosComprador.email,
      phone: {
        area_code: '11',
        number: datosComprador.telefono?.replace(/\D/g, '') || ''
      }
    };
    const preference = new Preference(client);
    let result;
    try {
      console.log('Enviando preferencia a MercadoPago:', JSON.stringify({
        items: itemsMP,
        payer,
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
      }, null, 2));
      result = await preference.create({
        body: {
          items: itemsMP,
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
      console.log('Respuesta MercadoPago:', JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('❌ Error MercadoPago:', err.message, err);
      return res.status(500).json({
        error: 'Error al crear preferencia en MercadoPago',
        message: err.message,
        mp_error: err
      });
    }
    if (!result || !result.id || !result.init_point) {
    console.log('❌ Error: Preferencia no generada, respuesta incompleta de MercadoPago:', result);
    return res.status(500).json({
      error: 'Preferencia no generada',
      message: 'No se recibió un init_point válido de MercadoPago',
      result
    });
  }
    console.log('✅ Preferencia creada exitosamente');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({
      preference_id: result.id,
      init_point: result.init_point
    });
  } catch (error) {
    // Loguear error inesperado y devolver JSON siempre
    console.error('❌ Error inesperado al crear preferencia:');
    console.error('📋 Detalles completos del error:', error && error.stack ? error.stack : error);
    try {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(500).json({
        error: 'Error inesperado al crear preferencia',
        message: error.message || String(error),
        stack: error.stack || null
      });
    } catch (err2) {
      console.error('❌ Error al intentar enviar respuesta de error:', err2);
      res.end();
    }

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

    // Lógica robusta: solo procesar el primer webhook que traiga paymentId, ignorar los demás
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
      console.log(`ℹ️ Webhook topic payment recibido para pago: ${paymentId}`);
    } else if (topic === 'merchant_order' && resource) {
      // Solo intentar obtener paymentId desde merchant_order si NO se obtuvo antes
      console.log('ℹ️ Merchant order webhook recibido. Intentando obtener payments desde resource...');
      try {
        const resourceUrl = resource;
        const resp = await fetch(`${resourceUrl}?access_token=${process.env.MERCADOPAGO_ACCESS_TOKEN}`);
        if (!resp.ok) {
          console.log('⚠️ No se pudo obtener merchant_order, status:', resp.status);
          return res.status(200).send('OK - merchant_order ignored');
        }
        const mo = await resp.json();
        const payments = mo.payments || [];
        if (payments.length > 0 && payments[0].id) {
          paymentId = payments[0].id;
          shouldProcess = true;
          console.log(`ℹ️ merchant_order -> procesando paymentId: ${paymentId}`);
        } else {
          console.log('ℹ️ merchant_order sin payments - ignorando');
          return res.status(200).send('OK - No payments in merchant_order');
        }
      } catch (err) {
        console.error('⚠️ Error al obtener merchant_order:', err.message || err);
        return res.status(200).send('OK - merchant_order fetch failed');
      }
    } else {
      console.log(`ℹ️ Webhook ignorado - tipo: ${type || topic}, action: ${action}`);
      return res.status(200).send('OK - Ignored');
    }
    
    if (shouldProcess && paymentId) {
      // NUEVA VERIFICACIÓN: Consultar en la base si ya existe un pedido para este paymentId (antes de procesar)
      let pedidoExistenteAntes = null;
      try {
        const pedidoExistente = await executeQueryWithRetry(
          pool,
          `SELECT id_pedido FROM productos WHERE (mp_payment_id = $1 OR mp_payment_id = $2) AND id_pedido IS NOT NULL AND id_pedido != '' LIMIT 1`,
          [paymentId, paymentId.toString()],
          2
        );
        if (pedidoExistente && pedidoExistente.rows && pedidoExistente.rows.length > 0) {
          pedidoExistenteAntes = pedidoExistente.rows[0].id_pedido;
          console.log(`⚠️ Pago ${paymentId} ya tiene pedido en BD (${pedidoExistenteAntes}) - IGNORANDO WEBHOOK`);
          return res.status(200).send('OK - Already processed in DB');
        }
      } catch (err) {
        console.error('⚠️ Error al consultar pedido existente en BD:', err.message || err);
        // Si hay error en la consulta, por seguridad NO procesar el pedido
        return res.status(200).send('OK - DB check error');
      }

      // VERIFICACIÓN CRÍTICA: Solo procesar si NO ha sido procesado antes en memoria
      if (webhookNotifications.has(paymentId)) {
        console.log(`⚠️ Pago ${paymentId} ya fue procesado anteriormente (memoria) - IGNORANDO WEBHOOK`);
        return res.status(200).send('OK - Already processed (memory)');
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
        // Extraer productIds de items (si existen)
        let productIds = '';
        const items = paymentInfo.additional_info?.items || [];
        if (items.length > 0) {
          productIds = (items.map(item => item.id).filter(Boolean) || []).join(',');
        }
        // Si no hay productIds, usar 'MANUAL' o dejar vacío
        if (!productIds) productIds = 'MANUAL';
        let pedidoExistenteDespues = null;
        let idPedidoCompleto = null;
        let numeroDisplay = null;
        let pedidoCreado = false;
        try {
          // Ejecutar el stored procedure SIEMPRE
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
              productIds,
              paymentInfo.transaction_amount,
              paymentInfo.payer?.first_name || 'Cliente Web',
              customerData.customer_email || paymentInfo.payer?.email || 'cliente@web.com',
              customerData.customer_phone || '',
              'MercadoPago',
              'Retiro',
              paymentId
            ]
          );
          // Buscar el id_pedido generado después de ejecutar el SP
          const pedidoResult = await executeQueryWithRetry(
            pool,
            `SELECT id_pedido FROM productos WHERE mp_payment_id = $1 OR mp_payment_id = $2 AND id_pedido IS NOT NULL AND id_pedido != '' ORDER BY pedido_fecha DESC LIMIT 1`,
            [paymentId, paymentId.toString()],
            2
          );
          if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
            pedidoExistenteDespues = pedidoResult.rows[0].id_pedido;
            idPedidoCompleto = pedidoExistenteDespues;
            numeroDisplay = idPedidoCompleto && idPedidoCompleto.length >= 2 ? idPedidoCompleto.slice(-2) : idPedidoCompleto;
            // Solo enviar mail si el pedido no existía antes y existe después
            pedidoCreado = !pedidoExistenteAntes && !!pedidoExistenteDespues;
            console.log(`✅ Pedido generado: ${idPedidoCompleto} -> ${numeroDisplay}`);
          } else {
            console.log('⚠️ No se encontró id_pedido tras ejecutar el SP');
          }
        } catch (err) {
          console.error('⚠️ Error al buscar id_pedido tras SP:', err.message || err);
        }
        // Enviar email a cliente y admin SOLO si el pedido fue creado en esta ejecución
        if (pedidoCreado) {
          try {
            if ((customerData.customer_email || paymentInfo.payer?.email) && process.env.SMTP_USER && process.env.SMTP_PASS) {
              const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
                secure: false,
                auth: {
                  user: process.env.SMTP_USER,
                  pass: process.env.SMTP_PASS
                }
              });
              const toEmails = [customerData.customer_email || paymentInfo.payer?.email];
              if (process.env.ADMIN_EMAILS) {
                toEmails.push(...process.env.ADMIN_EMAILS.split(','));
              }
              const mailOptions = {
                from: process.env.SMTP_USER,
                to: toEmails.join(','),
                subject: `Confirmación de pedido Capri Store #${numeroDisplay || ''}`,
                text: `¡Gracias por tu compra!\n\nTu número de pedido es: ${idPedidoCompleto || 'N/A'}\nMonto: $${paymentInfo.transaction_amount}\n\nSi tienes dudas, responde este email.\n\n-- Capri Store` 
              };
              transporter.sendMail(mailOptions).then(info => {
                console.log('✅ Email de confirmación enviado:', info.response || info);
              }).catch(mailErr => {
                console.error('⚠️ Error al enviar email de confirmación:', mailErr.message || mailErr);
              });
            }
          } catch (mailError) {
            console.error('⚠️ Error en envío de email:', mailError.message || mailError);
          }
        } else {
          console.log('ℹ️ No se envía mail porque el pedido ya existía antes de este webhook.');
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

    // Intentar hasta MAX_TRIES veces esperando entre intentos (para dar tiempo al webhook)
    const MAX_TRIES = 3;
    const RETRY_DELAY_MS = 2000; // 2 segundos
    let intento = 0;
    let pedidoEncontrado = null;
    let debugResult = null;

    while (intento < MAX_TRIES && !pedidoEncontrado) {
      intento++;
      console.log(`🔁 Intento ${intento}/${MAX_TRIES} para payment_id: ${paymentId}`);

      // Resultados debug opcionales
      try {
        debugResult = await executeQueryWithRetry(
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
      } catch (err) {
        console.error('⚠️ Error en consulta debugResult:', err.message || err);
      }

      console.log(`🔍 Resultados debug (${(debugResult && debugResult.rows.length) || 0} filas)`);

      try {
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

        if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
          pedidoEncontrado = pedidoResult.rows[0];
          break;
        }
      } catch (err) {
        console.error(`⚠️ Intento ${intento} falló al consultar pedido:`, err.message || err);
      }

      if (!pedidoEncontrado && intento < MAX_TRIES) {
        console.log(`⏳ Esperando ${RETRY_DELAY_MS}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    if (pedidoEncontrado) {
      const pedido = pedidoEncontrado;
      const idPedidoCompleto = pedido.id_pedido;

      // Mejorar el cálculo del número display
      let numeroDisplay = idPedidoCompleto;
      if (idPedidoCompleto && idPedidoCompleto.length >= 2) {
        numeroDisplay = idPedidoCompleto.slice(-2); // Últimos 2 dígitos/caracteres
      }

      console.log(`✅ Pedido encontrado: ${idPedidoCompleto} -> ${numeroDisplay}`);
      const respuesta = {
        existe: true,
        id_pedido_completo: idPedidoCompleto,
        numero_display: numeroDisplay,
        nombre_cliente: pedido.pedido_nombre_cliente,
        total: pedido.pedido_monto_total,
        fecha_pedido: pedido.pedido_fecha
      };

      console.log(`📤 Enviando respuesta al frontend:`, respuesta);
      return res.json(respuesta);
    } else {
      console.log(`❌ Pedido no encontrado tras ${MAX_TRIES} intentos para payment ID: ${paymentId}`);

      // Verificar si hay algún registro para este payment_id (sin importar id_pedido)
      let checkCount = 0;
      try {
        const checkResult = await executeQueryWithRetry(
          pool,
          `SELECT COUNT(*) as count FROM productos WHERE mp_payment_id = $1 OR mp_payment_id = $2`,
          [paymentId, paymentId.toString()],
          1
        );
        checkCount = checkResult.rows[0]?.count || 0;
      } catch (err) {
        console.error('⚠️ Error al ejecutar checkResult:', err.message || err);
      }

      console.log(`🔍 Registros encontrados con este payment_id: ${checkCount}`);

      const respuestaError = {
        existe: false,
        message: 'Pedido no encontrado. Si el pago aparece en MercadoPago y no en este sitio, por favor contacte soporte para completar la entrega.',
        payment_id_consultado: paymentId,
        attempts: MAX_TRIES,
        contact_support: true
      };

      console.log(`📤 Enviando respuesta de error:`, respuestaError);
      return res.json(respuestaError);
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
console.log('✅ Endpoint GET /health definido exitosamente');

// ===============================
// ENDPOINT TEMPORAL: CONSULTAR DEFINICIÓN DEL STORED PROCEDURE
// ===============================
console.log('📝 Definiendo endpoint GET /debug-sp...');
app.get('/debug-sp', async (req, res) => {
  console.log('🔍 === CONSULTANDO DEFINICIÓN DEL STORED PROCEDURE ===');
  
  try {
    // Consultar la definición del stored procedure
    const spResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        p.proname as procedure_name,
        p.pronargs as num_args,
        pg_get_function_arguments(p.oid) as arguments,
        pg_get_functiondef(p.oid) as definition
       FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE p.proname = 'sp_crear_pedido_web'
         AND n.nspname = 'public'`,
      [],
      1
    );
    
    console.log('📦 Resultado consulta SP:', spResult.rows);
    
    // También consultar la estructura de la tabla productos para entender los campos
    const tableResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
       FROM information_schema.columns
       WHERE table_name = 'productos'
       ORDER BY ordinal_position`,
      [],
      1
    );
    
    console.log('📊 Estructura tabla productos:', tableResult.rows);
    
    res.json({
      stored_procedure: spResult.rows,
      table_structure: tableResult.rows,
      webhook_current_call: {
        parameters: 8,
        call: "CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)",
        values: [
          "productIds (string)",
          "transaction_amount (number)",
          "first_name (string)",
          "customer_email (string)", 
          "customer_phone (string)",
          "MercadoPago (string)",
          "Retiro (string)",
          "paymentId (string)"
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ Error al consultar SP:', error);
    res.status(500).json({
      error: 'Error al consultar stored procedure',
      message: error.message
    });
  }
});
console.log('✅ Endpoint GET /debug-sp definido exitosamente');

// Endpoint de test básico
app.get('/', (req, res) => {
  res.json({ 
    message: 'Capri Store API funcionando', 
    endpoints: ['/health', '/crear-preferencia', '/webhook', '/numero-pedido/:paymentId', '/forzar-pago-manual/:paymentId'] 
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
