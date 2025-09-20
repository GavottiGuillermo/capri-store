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

console.log('� Capri Store API iniciando...');

// ===============================
// VALIDACIÓN DE VARIABLES DE ENTORNO
// ===============================
if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.warn('⚠️ Configuración de email incompleta');
}

if (!process.env.ADMIN_EMAILS) {
  console.warn('⚠️ ADMIN_EMAILS no configurado');
}

const app = express();


// Almacén en memoria para notificaciones de webhook
const webhookNotifications = new Map();
// Bandera para evitar envío duplicado de email por paymentId
const emailSentForPayment = new Set();

// ===============================
// CONFIGURACIÓN DE MIDDLEWARES
// ===============================
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// Servir archivos estáticos desde la carpeta raíz
app.use(express.static(path.join(__dirname, '..')));

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
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, faltantes: [], error: 'Body vacío o malformado. Enviar JSON con { ids: [...] }' });
    }
    
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.json({ ok: true, faltantes: [], advertencia: 'No se recibieron IDs para validar. Enviar JSON como { "ids": [1,2,3] }' });
    }

    const faltantes = [];
    
    // Para cada ID, verificar stock usando la nueva lógica
    for (const id of ids) {
      try {
        // Obtener datos del producto
        const productQuery = `
          SELECT prenda, color, talle 
          FROM productos 
          WHERE id_articulo = $1 
          LIMIT 1
        `;
        
        const productResult = await executeQueryWithRetry(pool, productQuery, [parseInt(id)], 2);
        
        if (!productResult.rows || productResult.rows.length === 0) {
          // Producto no existe
          faltantes.push(parseInt(id));
          continue;
        }

        const { prenda, color, talle } = productResult.rows[0];

        // Contar stock disponible para esta combinación
        const stockQuery = `
          SELECT COUNT(*) as stock_total
          FROM productos 
          WHERE prenda = $1 
            AND color = $2 
            AND talle = $3 
            AND estado = 'Disponible'
        `;
        
        const stockResult = await executeQueryWithRetry(
          pool, 
          stockQuery, 
          [prenda, color, talle], 
          2
        );

        const stockTotal = parseInt(stockResult.rows[0]?.stock_total || 0);
        
        if (stockTotal === 0) {
          faltantes.push(parseInt(id));
        }
        
      } catch (error) {
        console.error(`❌ Error validando stock para ID ${id}:`, error);
        // En caso de error, por seguridad lo marcamos como faltante
        faltantes.push(parseInt(id));
      }
    }

    res.json({ ok: true, faltantes });
    
  } catch (error) {
    console.error('❌ Error en /validar-stock-carrito:', error);
    res.status(500).json({ ok: false, faltantes: [], error: error.message });
  }
});

// ===============================
// ENDPOINT: OBTENER IDS DE PRODUCTOS SIN STOCK
// ===============================
app.get('/stock-agotado', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  try {
    // Nueva consulta: obtener productos cuya combinación prenda+color+talle no tiene stock disponible
    const query = `
      WITH stock_combinations AS (
        SELECT 
          prenda, 
          color, 
          talle,
          COUNT(*) FILTER (WHERE estado = 'Disponible') as stock_disponible,
          array_agg(id_articulo) as all_ids
        FROM productos 
        WHERE prenda IS NOT NULL 
          AND color IS NOT NULL 
          AND talle IS NOT NULL
        GROUP BY prenda, color, talle
      )
      SELECT DISTINCT unnest(all_ids) as id_articulo
      FROM stock_combinations 
      WHERE stock_disponible = 0
    `;
    
    const result = await executeQueryWithRetry(pool, query, [], 2);
    
    const idsAgotados = result.rows.map(row => parseInt(row.id_articulo));
    
    res.json({ 
      ok: true, 
      ids: idsAgotados,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error en /stock-agotado:', error);
    res.status(500).json({ 
      ok: false, 
      ids: [], 
      error: error.message 
    });
  }
});

// ===============================
// ENDPOINT: CREAR PREFERENCIA DE MERCADO PAGO
// ===============================
app.post('/crear-preferencia', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  // Verificar si MercadoPago está configurado
  if (!client || !process.env.MERCADOPAGO_ACCESS_TOKEN) {
    console.error('❌ MercadoPago no configurado - no se puede crear preferencia');
    return res.status(503).json({
      error: 'Servicio no disponible',
      message: 'MercadoPago no está configurado correctamente',
      details: 'El token de acceso de MercadoPago no está configurado en el servidor'
    });
  }
  
  try {
    const { items, datosComprador } = req.body;
    console.log('📋 Datos recibidos en /crear-preferencia:');
    console.log('📋 Items:', JSON.stringify(items, null, 2));
    console.log('📋 Datos comprador:', JSON.stringify(datosComprador, null, 2));
    console.log('🌐 URLs calculadas:');
    console.log('  - Protocol:', req.protocol);
    console.log('  - Host:', req.get('host'));
    console.log('  - Success URL:', 'https://capristorezte.com.ar/success.html');

    // Validar datos requeridos
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error('❌ /crear-preferencia: Items requeridos no presentes');
      return res.status(400).json({
        error: 'Items requeridos',
        message: 'Se requiere al menos un item',
        received: req.body
      });
    }

    if (!datosComprador || !datosComprador.email) {
      console.error('❌ /crear-preferencia: Datos del comprador incompletos');
      return res.status(400).json({
        error: 'Datos del comprador incompletos',
        message: 'Email del comprador es requerido',
        received_data: datosComprador
      });
    }

    // Validar que cada item tenga los campos requeridos por MercadoPago
    const itemsMP = items.map((item, idx) => {
      if (!item.id_articulo && !item.id) {
        console.error(`❌ /crear-preferencia: Item en posición ${idx} sin ID`);
        throw new Error(`El item en posición ${idx} no tiene id_articulo ni id`);
      }
      
      const precio = Number(item.precio || item.unit_price || 0);
      const cantidad = Number(item.cantidad || item.quantity || 1);
      
      if (precio <= 0) {
        throw new Error(`El item en posición ${idx} tiene precio inválido: ${precio}`);
      }
      
      if (cantidad <= 0) {
        throw new Error(`El item en posición ${idx} tiene cantidad inválida: ${cantidad}`);
      }
      
      const mapped = {
        id: String(item.id_articulo || item.id),
        title: (item.nombre || item.title || 'Producto Capri').substring(0, 256), // Limitar título
        description: `Producto de Capri Store - ${item.nombre || 'Sin descripción'}`.substring(0, 600),
        quantity: cantidad,
        currency_id: 'ARS',
        unit_price: precio,
        category_id: 'fashion'  // Categoría para ropa
      };
      
      console.log(`✅ Item ${idx} mapeado:`, mapped);
      return mapped;
    });

    for (const [idx, item] of itemsMP.entries()) {
      if (!item.id || !item.title || !item.unit_price || !item.quantity) {
        console.error(`❌ /crear-preferencia: Item en posición ${idx} incompleto`);
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
          area_code: '11',
          number: (datosComprador.telefono || '').replace(/[^\d]/g, '').slice(-8)
        }
        // Remover identification temporalmente - puede estar causando el rechazo
        // identification: {
        //   type: 'DNI',
        //   number: '12345678'
        // }
      },
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 6  // Reducir a 6 cuotas por si 12 causa problemas
      },
      shipments: {
        mode: 'not_specified'
      },
      external_reference: JSON.stringify({
        email: datosComprador.email,
        nombre: datosComprador.nombre,
        apellido: datosComprador.apellido,
        telefono: datosComprador.telefono
      }),
      statement_descriptor: 'CAPRI STORE',
      auto_return: 'approved',
      binary_mode: false,
      back_urls: {
        success: 'https://capristorezte.com.ar/success.html',
        failure: 'https://capristorezte.com.ar/failure.html',
        pending: 'https://capristorezte.com.ar/pending.html'
      },
      notification_url: 'https://capri-store.onrender.com/webhook'
      // Remover campos que pueden causar conflictos
      // expires: false,
      // expiration_date_from: null,
      // expiration_date_to: null
    };

    console.log('🚀 Creando preferencia con datos:', JSON.stringify(preferenceData, null, 2));

    const result = await preference.create({ body: preferenceData });
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({
      preference_id: result.id,
      init_point: result.init_point
    });
  } catch (error) {
    console.error('❌ Error al crear preferencia:', error.message);
    console.error('❌ Stack trace:', error.stack);
    console.error('❌ Error completo:', error);
    console.error('❌ Datos recibidos:', JSON.stringify(req.body, null, 2));
    
    try {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(500).json({
        error: 'Error inesperado al crear preferencia',
        message: error.message || String(error),
        stack: error.stack || null,
        details: 'Ver logs del servidor para más información'
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
  
  console.log(`[${timestamp}] 🔔 WEBHOOK RECIBIDO:`);
  console.log(`[${timestamp}] Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`[${timestamp}] Body:`, JSON.stringify(req.body, null, 2));
  
  try {
    const { type, data, action, topic, resource } = req.body;
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
      console.log(`[${timestamp}] ❌ Webhook ignorado - type: ${type}, action: ${action}, topic: ${topic}, resource: ${resource}`);
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
                `${customerData.nombre || ''} ${customerData.apellido || ''}`.trim() || paymentInfo.payer?.first_name || 'Cliente Web',
                customerData.email || paymentInfo.payer?.email || 'cliente@web.com',
                customerData.telefono || '',
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
  
  // Intentar hasta MAX_TRIES veces esperando entre intentos (para dar tiempo al webhook)
  const MAX_TRIES = 3;
  const RETRY_DELAY_MS = 2000; // 2 segundos
  let intento = 0;
  let pedidoEncontrado = null;
  
  try {
    while (intento < MAX_TRIES && !pedidoEncontrado) {
      intento++;
      
      
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
        console.error(`⚠️ Error al consultar pedido (intento ${intento}):`, err.message);
      }
      
      if (!pedidoEncontrado && intento < MAX_TRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    
    if (pedidoEncontrado) {
      const numeroDisplay = pedidoEncontrado.id_pedido && pedidoEncontrado.id_pedido.length >= 2 ? 
        pedidoEncontrado.id_pedido.slice(-2) : pedidoEncontrado.id_pedido;
      
      
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
// ENDPOINT: OBTENER STOCK DE PRODUCTO ESPECÍFICO
// ===============================
app.get('/stock-producto/:id', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ ok: false, error: 'ID de producto requerido' });
    }

    // Primero obtener los datos del producto base (prenda, color, talle)
    const productQuery = `
      SELECT prenda, color, talle 
      FROM productos 
      WHERE id_articulo = $1 
      LIMIT 1
    `;
    
    const productResult = await executeQueryWithRetry(pool, productQuery, [parseInt(id)], 2);
    
    if (!productResult.rows || productResult.rows.length === 0) {
      return res.json({ ok: true, stock: 0, disponible: false, producto_no_encontrado: true });
    }

    const { prenda, color, talle } = productResult.rows[0];

    // Ahora contar todos los productos con la misma combinación prenda+color+talle que estén disponibles
    const stockQuery = `
      SELECT COUNT(*) as stock_total
      FROM productos 
      WHERE prenda = $1 
        AND color = $2 
        AND talle = $3 
        AND estado = 'Disponible'
    `;
    
    const stockResult = await executeQueryWithRetry(
      pool, 
      stockQuery, 
      [prenda, color, talle], 
      2
    );

    const stockTotal = parseInt(stockResult.rows[0]?.stock_total || 0);
    
    res.json({
      ok: true,
      stock: stockTotal,
      disponible: stockTotal > 0,
      prenda,
      color,
      talle,
      producto_id: id
    });

  } catch (error) {
    console.error('❌ Error en /stock-producto:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error interno del servidor',
      message: error.message 
    });
  }
});

// ===============================
// ENDPOINT DE EMERGENCIA: PROCESAR PAGO MANUAL
// ===============================
app.post('/procesar-pago-manual/:paymentId', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  const { paymentId } = req.params;
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] 🚨 PROCESAMIENTO MANUAL para pago: ${paymentId}`);
  
  try {
    // Simular el procesamiento del webhook manualmente
    const payment = new Payment(client);
    const paymentInfo = await payment.get({ id: paymentId });
    
    console.log(`[${timestamp}] 📋 Info del pago:`, JSON.stringify(paymentInfo, null, 2));
    
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
      
      // Crear pedido en la base de datos
      try {
        await executeQueryWithRetry(
          pool,
          'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            productIds,
            paymentInfo.transaction_amount,
            `${customerData.nombre || ''} ${customerData.apellido || ''}`.trim() || paymentInfo.payer?.first_name || 'Cliente Web',
            customerData.email || paymentInfo.payer?.email || 'cliente@web.com',
            customerData.telefono || '',
            'MercadoPago',
            'Retiro',
            paymentId
          ]
        );
        
        console.log(`[${timestamp}] ✅ Pedido creado manualmente para pago ${paymentId}`);
        
        res.json({
          success: true,
          message: 'Pago procesado manualmente',
          payment_id: paymentId,
          status: paymentInfo.status
        });
        
      } catch (dbError) {
        console.error(`[${timestamp}] ❌ Error creando pedido manual:`, dbError);
        res.status(500).json({
          success: false,
          error: 'Error creando pedido en base de datos',
          payment_id: paymentId
        });
      }
      
    } else {
      res.json({
        success: false,
        message: `Pago no aprobado. Estado: ${paymentInfo.status}`,
        payment_id: paymentId,
        status: paymentInfo.status
      });
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error procesando pago manual:`, error);
    res.status(500).json({
      success: false,
      error: 'Error procesando pago manual',
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
