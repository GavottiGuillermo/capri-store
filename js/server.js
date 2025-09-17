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

console.log('🔧 Capri Store API iniciando...');
console.log(`🌐 Modo: ${process.env.NODE_ENV || 'development'} | Directorio: ${__dirname}`);

// ===============================
// VALIDACIÓN DE VARIABLES DE ENTORNO
// ===============================
console.log('🔧 Validando configuración de entorno...');

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.warn('⚠️ Configuración de email incompleta');
}

if (process.env.ADMIN_EMAILS) {
  const adminEmails = process.env.ADMIN_EMAILS.split(',').map(email => email.trim());
  console.log('✅ Emails administrativos configurados:', adminEmails.length);
} else {
  console.warn('⚠️ ADMIN_EMAILS no configurado');
}

console.log('✅ Creando instancia de Express...');
const app = express();
console.log('✅ Express app creada exitosamente');


// Almacén en memoria para notificaciones de webhook
const webhookNotifications = new Map();
// Bandera para evitar envío duplicado de email por paymentId
const emailSentForPayment = new Set();

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
  console.log('✅ Columna mp_payment_id existe');
    } else {
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
console.log('🔧 Configurando MercadoPago...');

// Validar token de acceso
if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
  console.error('❌ MERCADOPAGO_ACCESS_TOKEN no configurado');
  process.exit(1);
}

// Verificar formato del token
const tokenStart = process.env.MERCADOPAGO_ACCESS_TOKEN.substring(0, 20);
console.log('🔑 Token MercadoPago configurado:', tokenStart + '...');

if (process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('TEST-')) {
  console.log('🧪 Usando token de PRUEBA');
} else if (process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('APP_USR-')) {
  console.log('🚀 Usando token de PRODUCCIÓN');
} else {
  console.warn('⚠️ Formato de token no reconocido');
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
// ENDPOINT: VALIDAR STOCK DE CARRITO
// ===============================
app.post('/validar-stock-carrito', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  try {
    // Validación robusta del body.
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, faltantes: [], error: 'Body vacío o malformado. Enviar JSON con { ids: [...] }' });
    }
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      // Si el array está vacío o malformado, devolver 200 pero con todos como faltantes
      return res.json({ ok: true, faltantes: [], advertencia: 'No se recibieron IDs para validar. Enviar JSON como { "ids": [1,2,3] }' });
    }

    // Consultar los productos que NO están disponibles
    const query = `SELECT id_articulo FROM productos WHERE id_articulo = ANY($1) AND estado != 'Disponible'`;
    const result = await executeQueryWithRetry(
      pool,
      query,
      [ids.map(Number)],
      2
    );

    // IDs que no están disponibles
    const faltantes = result.rows.map(row => Number(row.id_articulo));
    // Si algún id enviado no existe en la tabla, también se considera faltante
    // Consultar todos los ids existentes
    const queryExist = `SELECT id_articulo FROM productos WHERE id_articulo = ANY($1)`;
    const resultExist = await executeQueryWithRetry(
      pool,
      queryExist,
      [ids.map(Number)],
      2
    );
    const existentes = resultExist.rows.map(row => Number(row.id_articulo));
    const idsNoExisten = ids.map(Number).filter(id => !existentes.includes(id));
    const faltantesFinal = [...new Set([...faltantes, ...idsNoExisten])];
    res.json({ ok: true, faltantes: faltantesFinal });
  } catch (error) {
    console.error('❌ Error en /validar-stock-carrito:', error);
    res.status(500).json({ ok: false, faltantes: [], error: error.message });
  }
});

// ===============================
// ENDPOINT: CREAR PREFERENCIA DE MERCADO PAGO
// ===============================
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

    // Crear la preferencia en MercadoPago
    const preference = new Preference(client);
    const preferenceData = {
      items: itemsMP,
      payer: {
        name: datosComprador.nombre || '',
        surname: datosComprador.apellido || '',
        email: datosComprador.email,
        phone: {
          area_code: '',
          number: datosComprador.telefono || ''
        }
      },
      external_reference: JSON.stringify(datosComprador),
      statement_descriptor: 'CAPRI STORE',
      auto_return: 'approved',
      back_urls: {
        success: `${req.protocol}://${req.get('host')}/success.html`,
        failure: `${req.protocol}://${req.get('host')}/failure.html`,
        pending: `${req.protocol}://${req.get('host')}/pending.html`
      }
    };

    console.log('🔄 Creando preferencia con datos:', JSON.stringify(preferenceData, null, 2));
    const result = await preference.create({ body: preferenceData });
    
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

// ===============================
// ENDPOINT: WEBHOOK DE MERCADO PAGO  
// ===============================
app.post('/webhook', async (req, res) => {
  const timestamp = new Date().toISOString();
  let paymentId = null;
  let shouldProcess = false;
  try {
    const { type, data, action, topic, resource } = req.body;
    if (type === 'payment' && data?.id) {
      paymentId = data.id;
      shouldProcess = true;
    } else if (action === 'payment.created' && data?.id) {
      paymentId = data.id;
      shouldProcess = true;
    } else if (topic === 'payment' && resource) {
      paymentId = resource;
      shouldProcess = true;
    } else {
      console.log(`[${timestamp}] Webhook ignorado (no payment)`);
      return res.status(200).send('OK - Ignored (not payment)');
    }
    if (shouldProcess && paymentId) {
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
          console.log(`[${timestamp}] Pago ${paymentId} ya tiene pedido en BD (${pedidoExistenteAntes}) - Ignorado`);
          return res.status(200).send('OK - Already processed in DB');
        }
      } catch (err) {
        console.log(`[${timestamp}] Error al consultar pedido existente en BD para pago ${paymentId}`);
        return res.status(200).send('OK - DB check error');
      }
      if (webhookNotifications.has(paymentId)) {
        console.log(`[${timestamp}] Pago ${paymentId} ya fue procesado anteriormente (memoria) - Ignorado`);
        return res.status(200).send('OK - Already processed (memory)');
      }
      webhookNotifications.set(paymentId, true);
      // Procesamiento normal (sin logs detallados)
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });
      if (paymentInfo.status === 'approved') {
        // Extraer información del external_reference
        let customerData = {};
        try {
          if (paymentInfo.external_reference) {
            customerData = JSON.parse(paymentInfo.external_reference);
          }
        } catch (error) {}
        let productIds = '';
        const items = paymentInfo.additional_info?.items || [];
        if (items.length > 0) {
          productIds = (items.map(item => item.id).filter(Boolean) || []).join(',');
        }
        if (!productIds) productIds = 'MANUAL';

        // NUEVO: Chequeo en BD si el paymentId ya existe
        let idsArray = [];
        if (productIds !== 'MANUAL') {
          idsArray = productIds.split(',').map(id => id.trim()).filter(Boolean);
        }
        let faltantes = [];
        if (idsArray.length > 0) {
          try {
            const query = `SELECT id_articulo FROM productos WHERE id_articulo = ANY($1) AND estado != 'Disponible'`;
            const result = await executeQueryWithRetry(
              pool,
              query,
              [idsArray],
              2
            );
            faltantes = result.rows.map(row => row.id_articulo);
          } catch (error) {
            // Si hay error en la consulta, por seguridad, considerar como faltantes todos
            try {
              const result = await executeQueryWithRetry(
                pool,
                `SELECT COUNT(*) AS count FROM productos WHERE mp_payment_id = $1`,
                [paymentId],
                2
              );
              if (result.rows[0].count && Number(result.rows[0].count) > 0) {
                console.log(`[${timestamp}] Webhook ignorado: paymentId ${paymentId} ya existe en BD (productos.mp_payment_id)`);
                return res.status(200).send('OK');
              }
            } catch (err) {
              console.error(`[${timestamp}] Error al consultar BD para paymentId ${paymentId}:`, err);
              // Si hay error en la consulta, sigue con la lógica normal para no perder el webhook
            }
            faltantes = idsArray;
          }
        }

        if (faltantes.length > 0) {
          // Hay productos no disponibles, NO crear pedido, enviar correo de aviso
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
              // Email al cliente y admins
              const mailOptions = {
                from: process.env.SMTP_USER,
                to: toEmails.join(','),
                subject: `Problema con tu compra en Capri Store` ,
                text: `Hola,\n\nLamentablemente uno o más artículos de tu compra ya no están disponibles.\n\nArtículos sin stock: ${faltantes.join(', ')}\n\nNo se ha generado el pedido automáticamente. Nos comunicaremos a la brevedad para resolver el inconveniente.\n\nDisculpa las molestias.\n\n-- Capri Store` 
              };
              await transporter.sendMail(mailOptions);
            }
          } catch (mailError) {}
          console.log(`[${timestamp}] Pago ${paymentId} recibido pero artículos sin stock (${faltantes.join(', ')}), se notificó por email.`);
        } else {
          // Todos los productos disponibles, crear pedido normalmente
          let pedidoExistenteDespues = null;
          let idPedidoCompleto = null;
          let numeroDisplay = null;
          let pedidoCreado = false;
          try {
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
              pedidoCreado = !pedidoExistenteAntes && !!pedidoExistenteDespues;
            }
          } catch (err) {}
          if (pedidoCreado && !pedidoExistenteAntes) {
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
                await transporter.sendMail(mailOptions);
              }
            } catch (mailError) {}
          }
          console.log(`[${timestamp}] Pago ${paymentId} procesado correctamente`);
        }
      } else {
        console.log(`[${timestamp}] Pago ${paymentId} no aprobado (estado: ${paymentInfo.status})`);
      }
    } else {
      console.log(`[${timestamp}] Webhook recibido sin paymentId válido`);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[${timestamp}] Error en webhook:`, error);
    res.status(500).send('Error interno del servidor');
  }
});

// ===============================
// ENDPOINT: STATUS DEL WEBHOOK
// ===============================
app.get('/webhook-status/:paymentId', (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  const { paymentId } = req.params;
  const processed = webhookNotifications.has(paymentId);
  
  res.json({ processed, payment_id: paymentId });
});

// ===============================
// ENDPOINT PRINCIPAL: CONSULTAR PEDIDO POR MP_PAYMENT_ID
// ===============================
app.get('/numero-pedido/:paymentId', async (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  const { paymentId } = req.params;
  console.log('🔍 === ENDPOINT CONSULTA PEDIDO ===');
  console.log('Payment ID recibido:', paymentId);
  console.log('Headers de la petición:', req.headers.origin);
  
  // Primero, vamos a verificar qué datos tenemos en la BD para este payment_id
  console.log('🔍 Verificando datos en BD para payment_id:', paymentId);
  
  // Intentar hasta MAX_TRIES veces esperando entre intentos (para dar tiempo al webhook)
  const MAX_TRIES = 3;
  const RETRY_DELAY_MS = 2000; // 2 segundos
  let intento = 0;
  let pedidoEncontrado = null;
  let debugResult = null;
  
  try {
    while (intento < MAX_TRIES && !pedidoEncontrado) {
      intento++;
      console.log('🔁 Intento', intento, '/', MAX_TRIES, 'para payment_id:', paymentId);
      
      // Resultados debug opcionales
      try {
        debugResult = await executeQueryWithRetry(
          pool,
          'SELECT p.id_articulo, p.mp_payment_id, p.id_pedido, p.estado, p.pedido_fecha, p.pedido_nombre_cliente, p.pedido_monto_total FROM productos p WHERE p.mp_payment_id = $1 OR p.mp_payment_id = $2 ORDER BY p.pedido_fecha DESC',
          [paymentId, paymentId.toString()],
          2
        );
      } catch (err) {
        console.error('⚠️ Error en consulta debugResult:', err.message || err);
      }
      
      console.log('🔍 Resultados debug (', (debugResult && debugResult.rows.length) || 0, 'filas)');
      
      try {
        const pedidoResult = await executeQueryWithRetry(
          pool,
          'SELECT p.id_pedido, p.pedido_fecha, p.pedido_nombre_cliente, p.pedido_monto_total, p.mp_payment_id FROM productos p WHERE (p.mp_payment_id = $1 OR p.mp_payment_id = $2) AND p.id_pedido IS NOT NULL AND p.id_pedido != \'\' ORDER BY p.pedido_fecha DESC LIMIT 1',
          [paymentId, paymentId.toString()],
          2
        );
        
        if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
          pedidoEncontrado = pedidoResult.rows[0];
          break;
        }
      } catch (err) {
        console.error('⚠️ Intento', intento, 'falló al consultar pedido:', err.message || err);
      }
      
      if (!pedidoEncontrado && intento < MAX_TRIES) {
        console.log('⏳ Esperando', RETRY_DELAY_MS / 1000, 'segundos antes del siguiente intento...');
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    
    if (pedidoEncontrado) {
      const numeroDisplay = pedidoEncontrado.id_pedido && pedidoEncontrado.id_pedido.length >= 2 ? 
        pedidoEncontrado.id_pedido.slice(-2) : pedidoEncontrado.id_pedido;
      
      console.log('✅ Pedido encontrado:', pedidoEncontrado.id_pedido);
      
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
      console.log('❌ Pedido no encontrado después de', MAX_TRIES, 'intentos');
      
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
    console.error('❌ Error en endpoint /numero-pedido/:paymentId:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      payment_id: paymentId
    });
  }
});

// ===============================
// ENDPOINTS BÁSICOS
// ===============================

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime() 
  });
});

// Manejo de errores global
app.use((error, req, res, next) => {
  console.error('� Error global capturado:', error);
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
      console.log(`🚀 Capri Store API escuchando en puerto ${PORT}`);
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
