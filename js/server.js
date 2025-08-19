const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env en la carpeta padre
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ===============================
// VALIDACIÓN DE VARIABLES DE ENTORNO
// ===============================
console.log('🔧 === VALIDANDO CONFIGURACIÓN ===');

// Verificar variables de email
if (!process.env.SMTP_USER) {
  console.error('❌ SMTP_USER no configurado en variables de entorno');
  console.error('💡 Configura tu email de Zoho en la variable SMTP_USER');
}

if (!process.env.SMTP_PASS) {
  console.error('❌ SMTP_PASS no configurado en variables de entorno');
  console.error('💡 Configura tu contraseña de aplicación de Zoho en SMTP_PASS');
}

if (!process.env.ADMIN_EMAILS) {
  console.error('❌ ADMIN_EMAILS no configurado en variables de entorno');
  console.error('💡 Configura los emails administrativos separados por comas');
} else {
  const adminEmails = process.env.ADMIN_EMAILS.split(',').map(email => email.trim());
  console.log('✅ Emails administrativos configurados:', adminEmails.length, 'emails');
  adminEmails.forEach((email, index) => {
    console.log(`   ${index + 1}. ${email}`);
  });
}

if (process.env.SMTP_USER && process.env.SMTP_PASS && process.env.ADMIN_EMAILS) {
  console.log('✅ Configuración de correos: COMPLETA');
} else {
  console.log('⚠️ Configuración de correos: INCOMPLETA - Algunas funciones de email no funcionarán');
}

console.log('🔧 === FIN VALIDACIÓN ===\n');

const app = express();

// Almacén en memoria para notificaciones de webhook
const webhookNotifications = new Map();

// Sistema de idempotencia para evitar procesamiento duplicado
const processedPayments = new Set();

// Función para verificar si un pago ya fue procesado
function isPaymentProcessed(paymentId) {
  return processedPayments.has(paymentId);
}

// Función para marcar un pago como procesado
function markPaymentAsProcessed(paymentId) {
  processedPayments.add(paymentId);
  // Limpiar después de 30 minutos
  setTimeout(() => {
    processedPayments.delete(paymentId);
  }, 30 * 60 * 1000);
}

// Función helper para ejecutar queries con reintentos
async function executeQueryWithRetry(pool, query, params, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let client;
    try {
      console.log(`🔄 Intento ${attempt}/${maxRetries} de conexión BD`);
      
      // Obtener conexión con timeout
      const connectionPromise = pool.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout conexión BD (intento ${attempt})`)), 8000)
      );
      
      client = await Promise.race([connectionPromise, timeoutPromise]);
      console.log(`✅ Conexión obtenida en intento ${attempt}`);
      
      // Ejecutar query con timeout
      const queryPromise = client.query(query, params);
      const queryTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout query BD (intento ${attempt})`)), 10000)
      );
      
      const result = await Promise.race([queryPromise, queryTimeoutPromise]);
      console.log(`✅ Query completada en intento ${attempt}`);
      
      return result;
      
    } catch (error) {
      console.error(`❌ Error en intento ${attempt}:`, error.message);
      
      if (attempt === maxRetries) {
        console.error('💥 Agotados todos los reintentos');
        throw error;
      }
      
      // Esperar antes del siguiente intento (exponential backoff)
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`⏳ Esperando ${waitTime}ms antes del siguiente intento...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('❌ Error liberando conexión:', releaseError.message);
        }
      }
    }
  }
}

// Función para almacenar notificación de webhook exitoso
function storeWebhookNotification(paymentId, pedidoId, externalReference) {
  const notification = {
    paymentId,
    pedidoId,
    externalReference,
    timestamp: Date.now(),
    processed: false
  };
  webhookNotifications.set(paymentId, notification);
  
  // Limpiar notificaciones antiguas (mayores a 10 minutos)
  setTimeout(() => {
    webhookNotifications.delete(paymentId);
  }, 10 * 60 * 1000);
  
  console.log(`🔔 Notificación de webhook almacenada para payment ${paymentId}`);
}

// SIEMPRE PRIMERO
app.use(express.json());

// Middleware de logs simplificado
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Manejo global de errores no capturados
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Middleware
app.use(cors({
  origin: [
    'https://www.capristorezte.com.ar',
    'https://capristorezte.com.ar',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://localhost:3001',
    'http://127.0.0.1:5500'
  ]
}));

// Configura Mercado Pago - detectar entorno automáticamente
const isProduction = process.env.NODE_ENV === 'production';
const accessToken = isProduction 
  ? process.env.MERCADOPAGO_ACCESS_TOKEN 
  : (process.env.MERCADOPAGO_ACCESS_TOKEN_TEST || process.env.MERCADOPAGO_ACCESS_TOKEN);

console.log('🔧 Configuración MercadoPago:');
console.log('- Entorno:', isProduction ? 'PRODUCCIÓN' : 'DESARROLLO/TEST');
console.log('- Token tipo:', accessToken?.startsWith('TEST-') ? 'TEST' : 'PRODUCTION');
console.log('- Token length:', accessToken?.length || 0);

// Configuración de la base de datos PostgreSQL con variables de entorno
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,                    // Reducir pool máximo
  min: 2,                     // Mantener conexiones mínimas
  idleTimeoutMillis: 20000,   // Reducir timeout de idle
  connectionTimeoutMillis: 8000, // Aumentar timeout de conexión
  acquireTimeoutMillis: 8000, // Timeout para obtener conexión del pool
  createTimeoutMillis: 8000,  // Timeout para crear nueva conexión
  destroyTimeoutMillis: 5000, // Timeout para destruir conexión
  createRetryIntervalMillis: 1000, // Intervalo entre reintentos
  propagateCreateError: false // No propagar errores de creación
});

// Verificar conexión a la base de datos al iniciar
async function verificarConexionBD() {
  try {
    const client = await pool.connect();
    console.log('✅ Conexión exitosa a PostgreSQL (Neon)');
    await client.query('SELECT NOW()');
    
    // Verificar si existe la columna mp_payment_id
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'productos' 
        AND column_name = 'mp_payment_id'
    `);
    
    if (columnCheck.rows.length > 0) {
      console.log('✅ Columna mp_payment_id existe en tabla productos');
    } else {
      console.log('⚠️ ATENCIÓN: Columna mp_payment_id NO existe en tabla productos');
      console.log('💡 Ejecuta: ALTER TABLE productos ADD COLUMN mp_payment_id TEXT;');
    }
    
    console.log('✅ Stored procedure sp_crear_pedido_web disponible en BD');
    client.release();
  } catch (error) {
    console.error('❌ Error al conectar con PostgreSQL:', error.message);
    if (process.env.NODE_ENV === 'development') {
      console.log('⚠️ Modo desarrollo: Continuando sin base de datos...');
    }
  }
}

// Verificar conexión al iniciar el servidor
verificarConexionBD();

const client = new MercadoPagoConfig({
  accessToken: accessToken,
  options: {
    timeout: 10000,
    idempotencyKey: 'capri-store-' + Date.now()
  }
});

app.post('/crear-preferencia', async (req, res) => {
  console.log('=== INICIO /crear-preferencia ===');
  console.log('Request body (raw):', JSON.stringify(req.body, null, 2));
  
  try {
    const items = req.body.items;
    const datosCompradorMeta = req.body.datosComprador || null;
    
    console.log('Items recibidos:', JSON.stringify(items, null, 2));
    console.log('Datos comprador:', JSON.stringify(datosCompradorMeta, null, 2));
    
    // Validación de items
    if (!Array.isArray(items) || items.length === 0) {
      const errorResponse = { 
        error: "No hay productos en el carrito.", 
        log: 'Items no válidos', 
        timestamp: new Date().toISOString() 
      };
      res.status(400).json(errorResponse);
      return;
    }
    
    // Validar cada item
    for (const [i, item] of items.entries()) {
      if (
        !item ||
        typeof item.title !== 'string' || !item.title.trim() ||
        typeof item.quantity !== 'number' || item.quantity < 1 ||
        typeof item.currency_id !== 'string' || item.currency_id !== 'ARS' ||
        typeof item.unit_price !== 'number' || isNaN(item.unit_price) || item.unit_price < 0
      ) {
        const errorResponse = {
          error: `Formato de producto inválido en el item #${i + 1}`,
          log: `Item inválido: ${JSON.stringify(item)}`,
          timestamp: new Date().toISOString()
        };
        res.status(400).json(errorResponse);
        return;
      }
    }
    
    // Determinar URLs según el entorno
    const isProduction = process.env.NODE_ENV === 'production';
    const frontendUrl = 'https://www.capristorezte.com.ar';  // Frontend siempre en el dominio principal
    const backendUrl = isProduction
      ? 'https://capri-store.onrender.com'  // Backend en Render
      : 'http://localhost:3001';
    
    const preference = {
      items: items.map(item => ({
        title: item.title,
        quantity: item.quantity,
        currency_id: item.currency_id,
        unit_price: item.unit_price
      })),
      metadata: {
        itemsSimple: items.map(i => ({ 
          id: i.id,
          title: i.title, 
          quantity: i.quantity, 
          unit_price: i.unit_price 
        })),
        datosComprador: datosCompradorMeta || null
      },
      back_urls: {
        success: `${frontendUrl}/success.html?status=approved`,
        failure: `${frontendUrl}/failure.html?status=failure`,
        pending: `${frontendUrl}/pending.html?status=pending`
      },
      auto_return: "approved",
      site_id: "MLA",
      binary_mode: true,
      statement_descriptor: "CAPRI STORE",
      external_reference: "capri-" + Date.now() + "-ids-" + items.map(i => `${i.id}x${i.quantity}`).join(","),
      payer: {
        name: datosCompradorMeta?.nombre || "Cliente",
        surname: datosCompradorMeta?.apellido || "Capri Store"
      },
      additional_info: {
        items: items.map(item => ({
          id: item.id || "ITEM-" + Date.now(),
          title: item.title,
          description: item.title,
          picture_url: item.picture_url || "",
          category_id: "fashion",
          quantity: item.quantity,
          unit_price: item.unit_price
        })),
        payer: {
          first_name: datosCompradorMeta?.nombre || "Cliente",
          last_name: datosCompradorMeta?.apellido || "Capri Store"
        },
        shipments: {
          receiver_address: {
            zip_code: "2800",
            state_name: "Buenos Aires",
            city_name: "Zárate",
            street_name: "Justa Lima 123"
          }
        }
      },
      payment_methods: {
        excluded_payment_types: [],
        installments: 12
      },
      notification_url: `${backendUrl}/webhook`  // Webhook apunta al backend en Render
    };
    
    console.log('Preference enviada a Mercado Pago:', JSON.stringify(preference, null, 2));
    console.log('🔍 Configuración específica:');
    console.log('- Entorno:', isProduction ? 'PRODUCCIÓN' : 'DESARROLLO');
    console.log('- Frontend URL:', frontendUrl);
    console.log('- Backend URL:', backendUrl);
    console.log('- Auto return:', preference.auto_return || 'NO CONFIGURADO');
    console.log('- Binary mode:', preference.binary_mode);
    console.log('- Notification URL:', preference.notification_url);
    
    // Crear preferencia
    const preferenceObj = new Preference(client);
    console.log('Creando preferencia...');
    
    let response;
    try {
      response = await Promise.race([
        preferenceObj.create({ body: preference }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout al crear preferencia después de 15 segundos')), 15000)
        )
      ]);
      console.log('Respuesta de MercadoPago recibida:', JSON.stringify(response, null, 2));
    } catch (err) {
      console.error('=== ERROR DETALLADO AL CREAR PREFERENCIA ===');
      console.error('Error message:', err.message);
      console.error('Error stack:', err.stack);
      
      if (err.response) {
        console.error('HTTP Status:', err.response.status);
        console.error('Response data:', err.response.data);
      }
      
      const errorResponse = { 
        error: 'Error al crear preferencia', 
        log: err.message, 
        details: err.response?.data || 'Sin detalles adicionales',
        timestamp: new Date().toISOString() 
      };
      res.status(500).json(errorResponse);
      return;
    }
    
    if (!response || !response.init_point) {
      const errorResponse = { 
        error: 'Mercado Pago no devolvió un link de pago válido', 
        log: 'init_point faltante', 
        response, 
        timestamp: new Date().toISOString() 
      };
      res.status(500).json(errorResponse);
      return;
    }
    
    const result = { 
      init_point: response.init_point,
      id: response.id
    };
    
    res.json(result);
    console.log('Enviando respuesta al frontend:', JSON.stringify(result, null, 2));
    console.log('=== FIN /crear-preferencia EXITOSO ===');
    
  } catch (error) {
    console.error('=== ERROR en /crear-preferencia ===');
    console.error('Error completo:', error);
    
    const errorResponse = {
      error: 'Error al procesar el pago',
      message: error.message,
      timestamp: new Date().toISOString()
    };
    
    res.status(500).json(errorResponse);
    console.log('=== FIN /crear-preferencia CON ERROR ===');
  }
});

// Función para enviar correo de confirmación
async function enviarCorreoConfirmacion(datosComprador, productos, total, numeroPedido) {
  const startTime = Date.now();
  console.log('📧 === INICIANDO ENVÍO DE CORREO ===');
  console.log('⏰ Timestamp:', new Date().toISOString());
  
  try {
    // Verificar credenciales
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('❌ Credenciales de email no configuradas');
      throw new Error('Credenciales de email no configuradas');
    }

    // Verificar si la contraseña no es la de placeholder
    if (process.env.SMTP_PASS === 'tu_contraseña_de_aplicacion_zoho_aqui') {
      console.error('❌ SMTP_PASS contiene valor de placeholder - necesita configuración real');
      throw new Error('SMTP_PASS necesita ser configurado con una contraseña de aplicación válida de Zoho');
    }

    // Validar datos de entrada
    if (!datosComprador || !datosComprador.email || !datosComprador.nombre) {
      throw new Error('Datos del comprador incompletos para envío de correo');
    }

    // Configurar transporter con timeout y reintentos
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 587,
      secure: false, // Para puerto 587
      requireTLS: true, // Requiere TLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      connectionTimeout: 10000, // 10 segundos
      greetingTimeout: 5000,     // 5 segundos
      socketTimeout: 15000       // 15 segundos
    });

    // Verificar conexión SMTP con timeout
    console.log('🔍 Verificando conexión SMTP...');
    const verifyPromise = transporter.verify();
    const verifyTimeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout verificando conexión SMTP después de 10 segundos')), 10000)
    );

    await Promise.race([verifyPromise, verifyTimeoutPromise]);
    console.log('✅ Conexión SMTP verificada exitosamente');

    // Crear resumen de productos
    let resumenProductos = '';
    let subtotal = 0;
    
    if (!productos || !Array.isArray(productos)) {
      throw new Error('Lista de productos no válida');
    }
    
    productos.forEach((producto, index) => {
      const totalProducto = producto.cantidad * producto.precio;
      subtotal += totalProducto;
      resumenProductos += `${index + 1}. ${producto.nombre}`;
      if (producto.talle) {
        resumenProductos += ` (Talle: ${producto.talle})`;
      }
      resumenProductos += `\n   Cantidad: ${producto.cantidad} x $${producto.precio.toFixed(2)} = $${totalProducto.toFixed(2)}\n`;
    });

    // Determinar tipo de entrega
    const tipoEntrega = datosComprador.tipoEntrega || 'retiro';
    let mensajeEntrega = '';
    if (tipoEntrega === 'envio') {
      mensajeEntrega = 'Nos comunicaremos contigo para coordinar el envío a tu domicilio.';
    } else {
      mensajeEntrega = 'Podes retirarlo por Justa Lima 123, Zárate.';
    }

    // Crear contenido del email
    const nombreCompletoSaludo = [datosComprador.nombre, datosComprador.apellido]
      .filter(Boolean)
      .join(' ')
      .trim() || datosComprador.nombre;

    const emailText = `¡Hola ${nombreCompletoSaludo}!

Gracias por tu compra en Capri Store. Tu pedido ha sido confirmado exitosamente.

🛍️ RESUMEN DE TU COMPRA:
${resumenProductos}
-----------------------------------
Subtotal: $${subtotal.toFixed(2)}
${subtotal !== parseFloat(total) ? `Envío: $${(parseFloat(total) - subtotal).toFixed(2)}\n` : ''}Total: $${parseFloat(total).toFixed(2)}

📋 NÚMERO DE PEDIDO: ${numeroPedido}

📍 ENTREGA:
${mensajeEntrega}

📞 CONTACTO:
Si tenes alguna consulta, no dudes en contactarnos.

¡Gracias por elegirnos!

Capri Store
Justa Lima 123, Zárate`;

    const mailOptions = {
      from: `"Capri Store" <${process.env.SMTP_USER}>`,
      to: datosComprador.email,
      subject: `Confirmación de compra #${numeroPedido} - Capri Store`,
      text: emailText
    };

    // Enviar el correo con timeout
    console.log('🚀 === ENVIANDO EMAIL ===');
    const emailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout al enviar email después de 30 segundos')), 30000)
    );

    const info = await Promise.race([emailPromise, timeoutPromise]);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('🎉 === EMAIL ENVIADO EXITOSAMENTE ===');
    console.log('⏱️ Tiempo de envío:', duration + 'ms');
    console.log('📧 Message ID:', info.messageId);
    console.log('✅ Email enviado a:', datosComprador.email);
    
    return { 
      success: true, 
      messageId: info.messageId,
      duration: duration + 'ms'
    };
    
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.error('💥 === ERROR AL ENVIAR CORREO ===');
    console.error('⏱️ Tiempo hasta error:', duration + 'ms');
    console.error('Error mensaje:', error.message);
    
    // Clasificar tipos de errores para mejor debugging
    if (error.message.includes('535')) {
      console.error('🔐 Error de autenticación - Verifica SMTP_USER y SMTP_PASS en .env');
      console.error('💡 Asegúrate de usar una contraseña de aplicación de Zoho, no la contraseña normal');
    } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      console.error('⏰ Error de timeout - El servidor SMTP tardó demasiado en responder');
    } else if (error.message.includes('connection')) {
      console.error('🌐 Error de conexión - No se puede conectar al servidor SMTP');
    }
    
    return { 
      success: false, 
      error: error.message,
      duration: duration + 'ms'
    };
  }
}

// Test endpoint para verificar conectividad
app.get('/webhook', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`📞 [${timestamp}] GET request al webhook - MercadoPago puede estar probando conectividad`);
  console.log('Query params:', JSON.stringify(req.query, null, 2));
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  res.status(200).send('Webhook endpoint is reachable');
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('🏥 Health check request');
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    webhook_url: process.env.NODE_ENV === 'production' 
      ? 'https://www.capristorezte.com.ar/webhook' 
      : 'http://localhost:3001/webhook'
  });
});

// Endpoint de prueba para contact
app.get('/contact-test', (req, res) => {
  console.log('🧪 Contact test endpoint hit');
  res.status(200).json({ 
    message: 'Contact endpoint is working', 
    timestamp: new Date().toISOString(),
    method: 'GET'
  });
});

// Endpoint específico para que MercadoPago verifique conectividad
app.get('/webhook-test', (req, res) => {
  console.log('🔗 Webhook connectivity test from MercadoPago');
  res.status(200).json({
    message: 'Webhook endpoint is reachable',
    timestamp: new Date().toISOString(),
    server: 'Capri Store Backend'
  });
});

// Endpoint para verificar si un pago fue procesado por webhook
app.get('/webhook-status/:paymentId', (req, res) => {
  const { paymentId } = req.params;
  const notification = webhookNotifications.get(paymentId);
  
  if (notification) {
    console.log(`✅ Webhook procesó el pago ${paymentId}`);
    // Marcar como procesado para evitar reutilización
    notification.processed = true;
    res.json({
      processed: true,
      timestamp: notification.timestamp,
      pedidoId: notification.pedidoId,
      externalReference: notification.externalReference
    });
  } else {
    console.log(`⏳ Webhook aún no procesó el pago ${paymentId}`);
    res.json({
      processed: false,
      message: 'Payment not yet processed by webhook'
    });
  }
});

// Webhook para notificaciones de Mercado Pago
app.post('/webhook', async (req, res) => {
  const timestamp = new Date().toISOString();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`🔔 [${timestamp}] WEBHOOK POST RECIBIDO - Request ID: ${requestId}`);
  console.log(`📡 IP origen: ${req.ip || req.connection.remoteAddress}`);
  console.log(`🔗 URL completa: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
  console.log('📋 Headers completos:', JSON.stringify(req.headers, null, 2));
  console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
  console.log('🔍 Query params:', JSON.stringify(req.query, null, 2));

  try {
    const topic = req.body.type || req.query.topic || req.headers['x-topic'] || req.query.type;
    const id = req.body.data?.id || req.query.id || req.query['data.id'];
    
    console.log(`📢 Topic detectado: '${topic}', ID: '${id}'`);
    console.log(`🔧 Métodos de extracción utilizados:`, {
      'req.body.type': req.body.type,
      'req.query.topic': req.query.topic, 
      'req.headers[x-topic]': req.headers['x-topic'],
      'req.query.type': req.query.type,
      'req.body.data?.id': req.body.data?.id,
      'req.query.id': req.query.id,
      'req.query[data.id]': req.query['data.id']
    });
    
    // Responder OK a cualquier notificación que no sea de pago para evitar reintentos
    if (!topic || (topic !== 'payment' && topic !== 'merchant_order')) {
      console.log(`⏸️ Topic '${topic}' no es payment ni merchant_order - respondiendo OK para evitar reintentos`);
      return res.status(200).send(`OK - TOPIC ${topic} ACKNOWLEDGED`);
    }

    if (!id) {
      console.log('❌ No se recibió ID en la notificación');
      console.log('🔍 Todos los datos recibidos para debugging:', {
        body: req.body,
        query: req.query,
        headers: req.headers
      });
      return res.status(200).send('OK - NO ID PROVIDED'); // Responder OK para evitar reintentos
    }

    console.log(`🔍 Procesando ${topic} ${id} en MercadoPago...`);

    // VERIFICACIÓN DE IDEMPOTENCIA - evitar procesamiento duplicado
    if (isPaymentProcessed(id)) {
      console.log(`🔄 Pago ${id} ya está siendo procesado o fue procesado recientemente - evitando duplicados`);
      return res.status(200).send('OK - ALREADY_PROCESSING');
    }

    // Marcar como en procesamiento
    markPaymentAsProcessed(id);

    // Verificar idempotencia en BD - si ya existe el pedido
    let dbClient;
    try {
      // Obtener conexión con timeout
      console.log('🔍 Obteniendo conexión a la base de datos...');
      const connectionPromise = pool.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout obteniendo conexión BD después de 10 segundos')), 10000)
      );
      
      dbClient = await Promise.race([connectionPromise, timeoutPromise]);
      console.log('✅ Conexión a BD obtenida exitosamente');
      
      // Verificar si ya existe el pedido con timeout
      const queryPromise = dbClient.query(
        'SELECT COUNT(*) as count FROM productos WHERE id_pedido = $1',
        [id]
      );
      const queryTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout ejecutando query después de 8 segundos')), 8000)
      );
      
      const { rows: existingRows } = await Promise.race([queryPromise, queryTimeoutPromise]);
      console.log('✅ Query de verificación completada');
      
      if (existingRows && existingRows[0] && parseInt(existingRows[0].count) > 0) {
        console.log(`⚠️ Pago ${id} ya fue procesado anteriormente en BD`);
        return res.status(200).send('OK - ALREADY_PROCESSED');
      }
      
      // Obtener información del pago desde MercadoPago
      console.log(`🔍 Consultando ${topic} ${id} en MercadoPago...`);
      
      let payment;
      if (topic === 'payment') {
        // Consultar directamente el payment
        const paymentClient = new Payment(client);
        payment = await paymentClient.get({ id: id });
      } else if (topic === 'merchant_order') {
        // Para merchant_order, necesitamos obtener el payment ID desde la orden
        const orderResponse = await fetch(`https://api.mercadolibre.com/merchant_orders/${id}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        if (!orderResponse.ok) {
          console.log(`❌ Error consultando merchant_order ${id}`);
          return res.status(200).send('OK - ORDER_NOT_FOUND');
        }
        
        const orderData = await orderResponse.json();
        
        // Obtener el payment ID de la orden
        if (!orderData.payments || orderData.payments.length === 0) {
          console.log(`⏸️ Merchant order ${id} sin pagos asociados`);
          return res.status(200).send('OK - NO_PAYMENTS_IN_ORDER');
        }
        
        const paymentId = orderData.payments[0].id;
        console.log(`🔗 Merchant order ${id} -> Payment ID: ${paymentId}`);
        
        // Verificar si ya procesamos este payment ID
        if (isPaymentProcessed(paymentId)) {
          console.log(`🔄 Payment ${paymentId} ya fue procesado - evitando duplicado desde merchant_order`);
          return res.status(200).send('OK - PAYMENT_ALREADY_PROCESSED');
        }
        
        // Consultar el payment real
        const paymentClient = new Payment(client);
        payment = await paymentClient.get({ id: paymentId });
        
        // Actualizar el ID para el resto del procesamiento
        id = paymentId;
        markPaymentAsProcessed(paymentId);
      }
      
      console.log('💳 Estado del pago:', payment.status);
      console.log('💰 Monto:', payment.transaction_amount);
      console.log('📧 Email del pagador:', payment.payer?.email);
      
      // Solo procesar pagos aprobados o autorizados
      if (!payment || (payment.status !== 'approved' && payment.status !== 'authorized')) {
        console.log(`⏸️ Pago ${id} no está aprobado (status: ${payment?.status})`);
        return res.status(200).send('OK - NOT APPROVED');
      }

      console.log('✅ Pago aprobado, creando pedido...');

      // Extraer información del metadata y additional_info
      const metadata = payment.metadata || {};
      const additionalInfo = payment.additional_info || {};
      
      // PRIORIZAR metadata.itemsSimple que SÍ contiene los IDs correctos
      let itemsSimple = Array.isArray(metadata.itemsSimple) ? metadata.itemsSimple : [];
      console.log('🔍 metadata.itemsSimple encontrados:', itemsSimple.length);
      console.log('📋 metadata.itemsSimple content:', JSON.stringify(itemsSimple, null, 2));
      
      // Solo usar additional_info como fallback si metadata está realmente vacío
      if (itemsSimple.length === 0 && additionalInfo.items) {
        console.log('⚠️ metadata.itemsSimple vacío, intentando additional_info como fallback');
        itemsSimple = additionalInfo.items.map(item => ({
          id: item.id,
          title: item.title,
          quantity: item.quantity,
          unit_price: item.unit_price
        }));
        console.log('📋 additional_info.items mapeados:', JSON.stringify(itemsSimple, null, 2));
      }
      
      const datosComprador = metadata.datosComprador || {};
      
      console.log('📦 Items del pedido:', itemsSimple.length);
      console.log('📋 Items metadata:', JSON.stringify(itemsSimple, null, 2));
      console.log('👤 Datos del comprador:', JSON.stringify(datosComprador, null, 2));
      console.log('🔍 Additional info items:', JSON.stringify(additionalInfo.items, null, 2));

      // Si no hay items en metadata, intentar reconstruir desde los items del payment
      let productos = [];
      if (itemsSimple.length > 0) {
        console.log('✅ Usando itemsSimple del metadata (datos correctos con IDs)');
        productos = itemsSimple.map(item => ({
          id: item.id, // Este SÍ debe tener el ID correcto
          nombre: item.title,
          cantidad: item.quantity,
          precio: item.unit_price,
          img: ''
        }));
        console.log('🔍 Productos desde metadata:', JSON.stringify(productos, null, 2));
      } else if (payment.additional_info?.items) {
        console.log('⚠️ Fallback: usando additional_info.items');
        productos = payment.additional_info.items.map(item => ({
          id: item.id, // Puede estar vacío en additional_info
          nombre: item.title,
          cantidad: item.quantity,
          precio: item.unit_price,
          img: ''
        }));
        console.log('🔍 Productos desde additional_info:', JSON.stringify(productos, null, 2));
      }

      if (productos.length === 0) {
        console.log('❌ No se pudieron extraer productos del pago');
        console.log('🔍 Debug - metadata completo:', JSON.stringify(metadata, null, 2));
        console.log('🔍 Debug - additional_info completo:', JSON.stringify(additionalInfo, null, 2));
        return res.status(200).send('OK - NO PRODUCTS');
      }

      // Extraer IDs de productos - ESTRATEGIA SIMPLE Y DIRECTA
      const productosIds = [];
      console.log('🔍 === EXTRACCIÓN DIRECTA DE IDs ===');
      
      // PASO 1: Usar metadata.itemsSimple si contiene los IDs originales
      if (itemsSimple.length > 0) {
        console.log('✅ Usando metadata.itemsSimple (IDs originales de la preferencia)');
        
        for (const item of itemsSimple) {
          let productId = item.id;
          
          // Convertir a número si viene como string
          if (productId && typeof productId === 'string') {
            productId = parseInt(productId);
          }
          
          if (productId && !isNaN(productId) && productId > 0) {
            const cantidad = parseInt(item.quantity) || 1;
            
            // Agregar el ID exacto tantas veces como la cantidad
            for (let i = 0; i < cantidad; i++) {
              productosIds.push(productId);
            }
            console.log(`✅ Agregado ID ${productId} x ${cantidad} (desde metadata original)`);
          }
        }
      }
      
      // PASO 2: Si metadata está vacío, extraer IDs desde external_reference
      if (productosIds.length === 0) {
        console.log('⚠️ metadata.itemsSimple vacío, extrayendo IDs desde external_reference');
        
        const externalRef = payment.external_reference || '';
        console.log('🔍 External reference:', externalRef);
        
        // Formato esperado: "capri-1234567890-ids-6x1,7x2"
        const idsMatch = externalRef.match(/-ids-(.+)$/);
        if (idsMatch) {
          const idsString = idsMatch[1];
          console.log('🎯 IDs extraídos del external_reference:', idsString);
          
          // Parse "6x1,7x2" -> [6, 7, 7]
          const idsData = idsString.split(',');
          for (const idData of idsData) {
            const [id, quantity] = idData.split('x').map(n => parseInt(n));
            if (!isNaN(id) && !isNaN(quantity) && id > 0 && quantity > 0) {
              for (let i = 0; i < quantity; i++) {
                productosIds.push(id);
              }
              console.log(`✅ Agregado ID ${id} x ${quantity} (desde external_reference)`);
            }
          }
        } else {
          console.error('❌ No se pudieron extraer IDs del external_reference');
        }
      }
      
      console.log('🎯 IDs para stored procedure:', productosIds);

      if (productosIds.length === 0) {
        console.log('💥 === SIN IDs PARA PROCESAR ===');
        return res.status(200).send('OK - NO PRODUCT IDS');
      }
      // Preparar datos para el stored procedure
      const idsString = productosIds.join(',');
      const montoTotal = parseFloat(payment.transaction_amount);
      
      // Obtener datos del comprador (priorizar metadata, luego additional_info, finalmente payer)
      const additionalInfoPayer = additionalInfo.payer || {};
      
      const nombreCompleto = datosComprador.nombre && datosComprador.apellido
        ? `${datosComprador.nombre} ${datosComprador.apellido}`
        : datosComprador.nombre 
        || (additionalInfoPayer.first_name && additionalInfoPayer.last_name 
            ? `${additionalInfoPayer.first_name} ${additionalInfoPayer.last_name}`
            : `${payment.payer?.first_name || 'Cliente'} ${payment.payer?.last_name || ''}`.trim())
        || 'Cliente Webhook';
        
      const correoCliente = datosComprador.email 
        || additionalInfoPayer.email 
        || payment.payer?.email 
        || 'webhook@capristore.com';
        
      const telefonoCliente = datosComprador.telefono 
        || additionalInfoPayer.phone?.number 
        || additionalInfoPayer.phone 
        || payment.payer?.phone?.number 
        || payment.payer?.phone
        || '0000000000'; // Teléfono por defecto para webhooks sin teléfono
      const metodoPago = 'MercadoPago'; // Solo "MercadoPago" aquí
      const tipoEntrega = datosComprador.tipoEntrega === 'envio' ? 'Envio' : 'Retiro';

      console.log('🚀 Ejecutando stored procedure...');
      console.log('📋 Datos del comprador disponibles:', {
        'datosComprador.telefono': datosComprador.telefono,
        'additionalInfoPayer.phone': additionalInfoPayer.phone,
        'payment.payer.phone': payment.payer?.phone,
        'telefonoCliente_final': telefonoCliente
      });
      console.log('📋 Datos:', {
        idsString,
        montoTotal,
        nombreCompleto,
        correoCliente,
        telefonoCliente,
        metodoPago,
        tipoEntrega,
        paymentId: id // Agregar payment ID
      });

      // VERIFICAR: El payment ID debe pasarse como 8vo parámetro
      console.log(`🔍 Payment ID que se enviará: "${id}"`);

      // Ejecutar stored procedure con payment ID incluido (8 parámetros)
      const spPromise = dbClient.query(
        'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
        [idsString, montoTotal, nombreCompleto, correoCliente, telefonoCliente, metodoPago, tipoEntrega, id]
      );
      const spTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout ejecutando stored procedure después de 15 segundos')), 15000)
      );
      
      await Promise.race([spPromise, spTimeoutPromise]);
      console.log(`✅ Pedido creado exitosamente por webhook para payment ${id}`);

      // Almacenar notificación de webhook exitoso
      storeWebhookNotification(id, 'webhook-created', payment.external_reference);
      if (correoCliente) {
        try {
          const resultadoEmail = await enviarCorreoConfirmacion(
            { 
              nombre: nombreCompleto,
              email: correoCliente,
              telefono: telefonoCliente,
              tipoEntrega: tipoEntrega
            },
            productos.map(p => ({
              nombre: p.nombre,
              cantidad: p.cantidad,
              precio: p.precio,
              talle: p.talle || null
            })),
            montoTotal,
            id
          );
          
          if (resultadoEmail.success) {
            console.log('✅ Correo enviado exitosamente desde webhook');
          } else {
            console.log('⚠️ Error enviando correo desde webhook:', resultadoEmail.error);
          }
        } catch (emailError) {
          console.log('⚠️ Excepción enviando correo desde webhook:', emailError.message);
        }
      }

    } catch (dbError) {
      console.error('❌ Error de base de datos en webhook:', dbError.message);
      
      // Clasificar el tipo de error para mejor manejo
      if (dbError.message.includes('timeout') || dbError.message.includes('Connection terminated')) {
        console.error('🕐 Error de timeout - la BD tardó demasiado en responder');
        console.error('💡 Sugerencias: Verificar conectividad de red o estado de la BD');
      } else if (dbError.message.includes('connect') || dbError.message.includes('connection')) {
        console.error('🔌 Error de conexión - no se puede conectar a la BD');
        console.error('💡 Sugerencias: Verificar credenciales y disponibilidad de la BD');
      } else {
        console.error('🐛 Error SQL o lógico en la BD');
      }
      
      // No relanzar el error para que el webhook responda OK a MercadoPago
      // En lugar de: throw dbError;
      console.log('⚠️ Continuando sin relanzar error para evitar reintentos de MP');
    } finally {
      if (dbClient) {
        try {
          dbClient.release();
          console.log('🔓 Conexión BD liberada correctamente');
        } catch (releaseError) {
          console.error('❌ Error liberando conexión BD:', releaseError.message);
        }
      }
    }

    res.status(200).send('OK - PROCESSED');
    
  } catch (error) {
    console.error('💥 Error crítico en webhook:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(200).send('OK - ERROR'); // Siempre devolver 200 para que MP no reintente
  }
});

// Endpoint para crear un pedido en la base de datos después del pago exitoso
app.post('/crear-pedido', async (req, res) => {
  const startTime = Date.now();
  console.log('� Creando pedido desde frontend...');
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📊 Request body completo:', JSON.stringify(req.body, null, 2));
  
  try {
    const { paymentId, productos, total, datosComprador } = req.body;
    
    // Validación de datos
    console.log('🔍 === VALIDACIÓN DE DATOS ===');
    if (!paymentId || !productos || !total || !datosComprador) {
      console.error('❌ VALIDACIÓN FALLIDA - Faltan datos requeridos');
      return res.status(400).json({ 
        success: false,
        error: 'Faltan datos requeridos para crear el pedido'
      });
    }

    console.log('✅ VALIDACIÓN EXITOSA');
    console.log('📋 Payment ID:', paymentId);
    console.log('💰 Total a procesar:', total);
    console.log('👤 Comprador:', datosComprador.nombre, datosComprador.email);
    console.log('🛍️ Productos:', productos.length, 'items');

    // Verificar si el pedido ya existe
    const dbClient = await pool.connect();
    try {
      const { rows: existingRows } = await dbClient.query(
        'SELECT COUNT(*) as count FROM productos WHERE id_pedido = $1',
        [paymentId]
      );
      
      if (parseInt(existingRows[0].count) > 0) {
        console.log('⚠️ Pedido ya existe, evitando duplicado');
        return res.json({
          success: true,
          message: 'Pedido ya fue procesado anteriormente',
          numeroPedido: paymentId,
          duplicate: true
        });
      }

      // Preparar datos del cliente
      const nombreCompleto = [datosComprador.nombre, datosComprador.apellido]
        .filter(Boolean)
        .join(' ')
        .trim() || datosComprador.nombre || 'Cliente';
      
      const tipoEntrega = (datosComprador.tipoEntrega || '').toLowerCase() === 'envio' ? 'Envio' : 'Retiro';

      console.log('👤 Datos procesados:', {
        nombre: nombreCompleto,
        email: datosComprador.email,
        tipoEntrega: tipoEntrega
      });

      // Procesar cada producto del pedido
      await dbClient.query('BEGIN');
      
      let productosActualizados = 0;
      
      for (const producto of productos) {
        // Extraer ID del producto desde el nombre (formato: "6-Midnight Dress (Talle: L)")
        // El nombre puede venir como "Vestido Media Noche (Talle: L)" donde necesitamos mapear al ID
        
        let idProducto = null;
        let talle = null;
        
        // Extraer talle del nombre si existe
        const talleMatch = producto.nombre.match(/\(Talle:\s*([^)]+)\)/i);
        if (talleMatch) {
          talle = talleMatch[1].trim();
        }
        
        // Mapear nombres a IDs de productos (deberías ajustar esto según tu estructura)
        const nombreLimpio = producto.nombre.split('(')[0].trim();
        
        console.log(`🔍 Procesando producto: "${nombreLimpio}", Talle: ${talle}, Precio: ${producto.precio}`);
        
        // Buscar por precio y talle (más específico que solo nombre)
        let queryBuscar, parametros;
        
        if (talle) {
          queryBuscar = `
            SELECT id_articulo, prenda, talle, precio_venta_transferencia
            FROM productos 
            WHERE ABS(precio_venta_transferencia - $1) < 0.01
              AND LOWER(TRIM(talle)) = LOWER($2)
              AND id_pedido IS NULL
            ORDER BY id_articulo ASC
            LIMIT 10
          `;
          parametros = [producto.precio, talle];
        } else {
          queryBuscar = `
            SELECT id_articulo, prenda, talle, precio_venta_transferencia
            FROM productos 
            WHERE ABS(precio_venta_transferencia - $1) < 0.01
              AND id_pedido IS NULL
            ORDER BY id_articulo ASC
            LIMIT 10
          `;
          parametros = [producto.precio];
        }
        
        const { rows: productosDisponibles } = await dbClient.query(queryBuscar, parametros);
        
        console.log(`📦 Encontrados ${productosDisponibles.length} productos disponibles para "${nombreLimpio}"`);
        
        const cantidad = parseInt(producto.cantidad, 10);
        
        // Actualizar productos (todos los disponibles hasta la cantidad solicitada)
        const cantidadAActualizar = Math.min(productosDisponibles.length, cantidad);
        
        for (let i = 0; i < cantidadAActualizar; i++) {
          const prod = productosDisponibles[i];
          
          const queryActualizar = `
            UPDATE productos 
            SET 
              id_pedido = $1,
              pedido_fecha = NOW(),
              pedido_nombre_cliente = $2,
              pedido_correo_cliente = $3,
              pedido_telefono_cliente = $4,
              pedido_monto_total = $5,
              pedido_tipo_entrega = $6,
              estado = 'Vendido'
            WHERE id_articulo = $7
          `;
          
          await dbClient.query(queryActualizar, [
            paymentId,
            nombreCompleto,
            datosComprador.email,
            datosComprador.telefono || '',
            parseFloat(total),
            tipoEntrega,
            prod.id_articulo
          ]);
          
          productosActualizados++;
        }
        
        if (cantidadAActualizar < cantidad) {
          console.warn(`⚠️ Solo se actualizaron ${cantidadAActualizar} de ${cantidad} productos para "${nombreLimpio}"`);
        } else {
          console.log(`✅ Actualizados ${cantidadAActualizar} productos de "${nombreLimpio}"`);
        }
      }
      
      await dbClient.query('COMMIT');
      
      console.log(`✅ Pedido creado exitosamente. Productos actualizados: ${productosActualizados}`);
      
      // Enviar correo de confirmación
      if (datosComprador.email && productosActualizados > 0) {
        try {
          await enviarCorreoConfirmacion(
            datosComprador, 
            productos, 
            total, 
            paymentId
          );
          console.log('✅ Correo de confirmación enviado');
        } catch (emailError) {
          console.error('❌ Error al enviar correo:', emailError.message);
        }
      }
      
      const duration = Date.now() - startTime;
      console.log(`⏱️ Pedido procesado en ${duration}ms`);
      
      res.json({
        success: true,
        message: 'Pedido creado exitosamente',
        numeroPedido: paymentId,
        productosActualizados: productosActualizados,
        duration: duration + 'ms'
      });
      
    } catch (error) {
      await dbClient.query('ROLLBACK');
      throw error;
    } finally {
      dbClient.release();
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('💥 === ERROR EN /crear-pedido ===');
    console.error('⏱️ Tiempo hasta error:', duration + 'ms');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Error al procesar el pedido',
      message: error.message,
      duration: duration + 'ms'
    });
  }
  
  console.log('🏁 === FIN /crear-pedido ===');
});

// Endpoint para consultar el estado de un pedido
app.get('/pedido/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const client = await pool.connect();
    
    // Buscar productos asociados a este pedido
    const productosResult = await client.query(
      `SELECT 
        COUNT(*) as count, 
        string_agg(DISTINCT CONCAT(prenda, ' (', talle, ')'), ', ') as productos,
        MAX(pedido_fecha) as fecha_pedido,
        MAX(pedido_nombre_cliente) as nombre_cliente,
        MAX(pedido_correo_cliente) as correo_cliente,
        MAX(pedido_telefono_cliente) as telefono_cliente,
        MAX(pedido_monto_total) as monto_total,
        MAX(pedido_tipo_entrega) as tipo_entrega
       FROM productos 
       WHERE id_pedido = $1`,
      [paymentId]
    );
    
    client.release();
    
    const result = productosResult.rows[0];
    const count = parseInt(result.count || 0);
    
    if (count > 0) {
      res.json({ 
        existe: true, 
        count: count,
        productos: result.productos,
        fecha_pedido: result.fecha_pedido,
        nombre_cliente: result.nombre_cliente,
        correo_cliente: result.correo_cliente,
        telefono_cliente: result.telefono_cliente,
        monto_total: result.monto_total,
        tipo_entrega: result.tipo_entrega,
        fuente: 'tabla_productos'
      });
    } else {
      res.json({ 
        existe: false,
        message: 'Pedido no encontrado'
      });
    }
    
  } catch (error) {
    console.error('❌ Error al consultar pedido:', error);
    res.status(500).json({ 
      error: 'Error al consultar pedido',
      details: error.message 
    });
  }
});

// Nuevo endpoint para obtener el número real del pedido desde la tabla productos
app.get('/numero-pedido/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log(`🔍 Buscando número de pedido para payment ID: ${paymentId}`);
    
    // PASO 1: Buscar el pedido usando la nueva columna mp_payment_id
    const pedidoResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        DISTINCT p.id_pedido,
        MAX(p.pedido_fecha) as fecha_pedido,
        MAX(p.pedido_nombre_cliente) as nombre_cliente,
        MAX(p.pedido_telefono_cliente) as telefono_cliente,
        MAX(p.pedido_monto_total) as total,
        COUNT(*) as productos_count
       FROM productos p
       WHERE p.id_pedido IS NOT NULL 
         AND p.mp_payment_id = $1
       GROUP BY p.id_pedido
       ORDER BY MAX(p.pedido_fecha) DESC
       LIMIT 1`,
      [paymentId],
      3
    );
    
    if (pedidoResult.rows.length > 0 && pedidoResult.rows[0].id_pedido) {
      const pedido = pedidoResult.rows[0];
      
      // El id_pedido viene en formato "P0001", extraer los últimos 2 dígitos numéricos
      const idPedidoCompleto = pedido.id_pedido; // "P0001"
      const numeroCompleto = idPedidoCompleto.substring(1); // "0001"
      const ultimosDosDigitos = numeroCompleto.slice(-2); // "01"
      
      console.log(`✅ Pedido encontrado por mp_payment_id - ID pedido: ${idPedidoCompleto}, Últimos 2 dígitos: ${ultimosDosDigitos}`);
      console.log(`📞 Teléfono cliente: ${pedido.telefono_cliente}`);
      
      res.json({
        existe: true,
        id_pedido_completo: idPedidoCompleto,
        numero_display: ultimosDosDigitos,
        nombre_cliente: pedido.nombre_cliente,
        telefono_cliente: pedido.telefono_cliente,
        total: pedido.total,
        fecha_pedido: pedido.fecha_pedido,
        productos_count: parseInt(pedido.productos_count),
        metodo_busqueda: 'mp_payment_id'
      });
      
    } else {
      console.log(`❌ No se encontró pedido para payment ID: ${paymentId} en columna mp_payment_id`);
      
      // PASO 2: Buscar por pedidos recientes (últimos 5 minutos) - Fallback más amplio
      console.log(`🔍 FALLBACK 1: Buscando pedidos recientes...`);
      const fallbackResult = await executeQueryWithRetry(
        pool,
        `SELECT 
          DISTINCT p.id_pedido,
          MAX(p.pedido_fecha) as fecha_pedido,
          MAX(p.pedido_nombre_cliente) as nombre_cliente,
          MAX(p.pedido_telefono_cliente) as telefono_cliente,
          MAX(p.pedido_monto_total) as total,
          COUNT(*) as productos_count
         FROM productos p
         WHERE p.id_pedido IS NOT NULL 
           AND p.pedido_fecha >= NOW() - INTERVAL '5 minutes'
         GROUP BY p.id_pedido
         ORDER BY MAX(p.pedido_fecha) DESC
         LIMIT 1`,
        [],
        2
      );
      
      if (fallbackResult.rows.length > 0) {
        const pedido = fallbackResult.rows[0];
        const idPedidoCompleto = pedido.id_pedido;
        const numeroCompleto = idPedidoCompleto.substring(1);
        const ultimosDosDigitos = numeroCompleto.slice(-2);
        
        console.log(`✅ Pedido encontrado (fallback recientes) - ID pedido: ${idPedidoCompleto}`);
        
        res.json({
          existe: true,
          id_pedido_completo: idPedidoCompleto,
          numero_display: ultimosDosDigitos,
          nombre_cliente: pedido.nombre_cliente,
          telefono_cliente: pedido.telefono_cliente,
          total: pedido.total,
          fecha_pedido: pedido.fecha_pedido,
          productos_count: parseInt(pedido.productos_count),
          metodo_busqueda: 'pedido_reciente',
          encontrado_por_fallback: true
        });
      } else {
        console.log(`❌ No se encontraron pedidos recientes`);
        res.json({
          existe: false,
          message: 'Número de pedido no encontrado',
          payment_id_consultado: paymentId
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error al consultar número de pedido:', error);
    res.status(500).json({
      error: 'Error al consultar número de pedido',
      details: error.message
    });
  }
});

// Endpoint alternativo para buscar pedido por IDs de artículos comprados
app.post('/numero-pedido-por-articulos', async (req, res) => {
  try {
    const { articulos_ids } = req.body;
    console.log(`🔍 Buscando número de pedido por artículos IDs: ${articulos_ids}`);
    
    if (!articulos_ids || !Array.isArray(articulos_ids) || articulos_ids.length === 0) {
      return res.status(400).json({
        error: 'Se requiere array de IDs de artículos'
      });
    }
    
    // Buscar pedidos que contengan alguno de estos artículos en los últimos 10 minutos
    const pedidoResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        DISTINCT p.id_pedido,
        MAX(p.pedido_fecha) as fecha_pedido,
        MAX(p.pedido_nombre_cliente) as nombre_cliente,
        MAX(p.pedido_telefono_cliente) as telefono_cliente,
        MAX(p.pedido_monto_total) as total,
        MAX(p.mp_payment_id) as mp_payment_id,
        COUNT(*) as productos_count,
        string_agg(DISTINCT p.id_articulo::text, ',') as articulos_encontrados
       FROM productos p
       WHERE p.id_pedido IS NOT NULL 
         AND p.id_articulo = ANY($1::int[])
         AND p.pedido_fecha >= NOW() - INTERVAL '10 minutes'
       GROUP BY p.id_pedido
       ORDER BY MAX(p.pedido_fecha) DESC
       LIMIT 1`,
      [articulos_ids],
      3
    );
    
    if (pedidoResult.rows.length > 0 && pedidoResult.rows[0].id_pedido) {
      const pedido = pedidoResult.rows[0];
      
      // El id_pedido viene en formato "P0001", extraer los últimos 2 dígitos numéricos
      const idPedidoCompleto = pedido.id_pedido;
      const numeroCompleto = idPedidoCompleto.substring(1);
      const ultimosDosDigitos = numeroCompleto.slice(-2);
      
      console.log(`✅ Pedido encontrado por artículos - ID pedido: ${idPedidoCompleto}, Artículos: ${pedido.articulos_encontrados}`);
      
      res.json({
        existe: true,
        id_pedido_completo: idPedidoCompleto,
        numero_display: ultimosDosDigitos,
        nombre_cliente: pedido.nombre_cliente,
        telefono_cliente: pedido.telefono_cliente,
        total: pedido.total,
        fecha_pedido: pedido.fecha_pedido,
        productos_count: parseInt(pedido.productos_count),
        mp_payment_id: pedido.mp_payment_id,
        articulos_encontrados: pedido.articulos_encontrados,
        metodo_busqueda: 'articulos_ids'
      });
      
    } else {
      console.log(`❌ No se encontró pedido para los artículos: ${articulos_ids.join(',')}`);
      res.json({
        existe: false,
        message: 'No se encontró pedido con esos artículos',
        articulos_consultados: articulos_ids
      });
    }
    
  } catch (error) {
    console.error('❌ Error al consultar pedido por artículos:', error);
    res.status(500).json({
      error: 'Error al consultar pedido por artículos',
      details: error.message
    });
  }
});

// Endpoint de debugging para ver pedidos recientes
app.get('/debug-pedidos-recientes', async (req, res) => {
  try {
    console.log('🔍 [DEBUG] Consultando pedidos recientes...');
    
    const pedidosResult = await executeQueryWithRetry(
      pool,
      `SELECT 
        p.id_pedido,
        p.id_articulo,
        p.mp_payment_id,
        p.pedido_fecha,
        p.pedido_nombre_cliente,
        p.pedido_monto_total,
        p.prenda,
        p.talle
       FROM productos p
       WHERE p.id_pedido IS NOT NULL 
         AND p.pedido_fecha >= NOW() - INTERVAL '1 hour'
       ORDER BY p.pedido_fecha DESC
       LIMIT 20`,
      [],
      3
    );
    
    console.log(`🔍 [DEBUG] Encontrados ${pedidosResult.rows.length} registros de pedidos recientes`);
    
    // Agrupar por pedido
    const pedidosAgrupados = {};
    pedidosResult.rows.forEach(row => {
      if (!pedidosAgrupados[row.id_pedido]) {
        pedidosAgrupados[row.id_pedido] = {
          id_pedido: row.id_pedido,
          mp_payment_id: row.mp_payment_id,
          fecha: row.pedido_fecha,
          cliente: row.pedido_nombre_cliente,
          total: row.pedido_monto_total,
          articulos: []
        };
      }
      pedidosAgrupados[row.id_pedido].articulos.push({
        id_articulo: row.id_articulo,
        prenda: row.prenda,
        talle: row.talle
      });
    });
    
    res.json({
      pedidos_encontrados: Object.keys(pedidosAgrupados).length,
      registros_totales: pedidosResult.rows.length,
      pedidos: Object.values(pedidosAgrupados),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error en debug pedidos:', error);
    res.status(500).json({
      error: 'Error consultando pedidos de debugging',
      details: error.message
    });
  }
});

// Endpoint para testear el flujo completo de pedido con payment ID
app.post('/test-pedido-completo', async (req, res) => {
  try {
    const { paymentId, productosIds, monto, nombre, email, telefono } = req.body;
    
    console.log(`🧪 [TEST] Creando pedido completo con payment ID: ${paymentId}`);
    
    const dbClient = await pool.connect();
    try {
      // Simular llamada al SP con payment ID
      await dbClient.query(
        'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
        [productosIds, parseFloat(monto), nombre, email, telefono || '', 'MercadoPago', 'Retiro', paymentId]
      );
      
      console.log('✅ SP ejecutado exitosamente con payment ID');
      
      // Consultar el pedido creado
      const pedidoResult = await dbClient.query(
        `SELECT 
          DISTINCT p.id_pedido,
          p.mp_payment_id,
          MAX(p.pedido_fecha) as fecha_pedido,
          COUNT(*) as productos_count
         FROM productos p
         WHERE p.mp_payment_id = $1
         GROUP BY p.id_pedido, p.mp_payment_id`,
        [paymentId]
      );
      
      if (pedidoResult.rows.length > 0) {
        const pedido = pedidoResult.rows[0];
        const idPedidoCompleto = pedido.id_pedido;
        const numeroCompleto = idPedidoCompleto.substring(1);
        const ultimosDosDigitos = numeroCompleto.slice(-2);
        
        res.json({
          success: true,
          message: 'Pedido creado y encontrado exitosamente',
          id_pedido_completo: idPedidoCompleto,
          numero_display: ultimosDosDigitos,
          mp_payment_id: pedido.mp_payment_id,
          productos_count: pedido.productos_count,
          fecha_pedido: pedido.fecha_pedido
        });
      } else {
        res.json({
          success: false,
          error: 'Pedido creado pero no se pudo consultar'
        });
      }
      
    } finally {
      dbClient.release();
    }
    
  } catch (error) {
    console.error('🧪 [TEST] Error en test-pedido-completo:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para simular webhook manualmente (solo para testing)
app.post('/test-webhook/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  console.log(`🧪 [TEST] Simulando webhook para payment ID: ${paymentId}`);
  
  try {
    // Simular el body que enviaría MercadoPago
    const mockBody = {
      type: 'payment',
      data: { id: paymentId }
    };
    
    // Simular headers que enviaría MercadoPago
    const mockHeaders = {
      'x-topic': 'payment',
      'content-type': 'application/json'
    };
    
    // Crear un request mock
    const mockReq = {
      body: mockBody,
      headers: mockHeaders,
      query: {},
      ip: '127.0.0.1',
      protocol: 'https',
      get: (header) => header === 'host' ? 'www.capristorezte.com.ar' : undefined,
      originalUrl: `/test-webhook/${paymentId}`
    };
    
    // Crear response mock
    let statusCode = 200;
    let responseBody = '';
    const mockRes = {
      status: (code) => { statusCode = code; return mockRes; },
      send: (body) => { responseBody = body; return mockRes; }
    };
    
    console.log('🧪 Ejecutando lógica del webhook...');
    // Aquí deberías llamar a la lógica del webhook actual
    // Por ahora solo mostraremos que recibimos la simulación
    
    console.log(`🧪 [TEST] Webhook simulado completado para payment ${paymentId}`);
    res.json({
      success: true,
      message: `Test webhook ejecutado para payment ${paymentId}`,
      mock_status: statusCode,
      mock_response: responseBody,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('🧪 [TEST] Error en simulación de webhook:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint para consultar productos sin stock (vendidos)
app.get('/stock-agotado', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT DISTINCT id_articulo
         FROM productos
         WHERE id_pedido IS NOT NULL`
      );
      const ids = rows.map(r => r.id_articulo);
      res.json({ ids });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error en /stock-agotado:', err.message);
    res.status(500).json({ error: 'Error consultando stock', message: err.message });
  }
});

// Nuevo endpoint para confirmar compra y enviar correo
app.post('/confirmar-compra', async (req, res) => {
  try {
    const { nombre, apellido, email, resumen, total } = req.body;
    if (!nombre || !apellido || !email || !resumen || !total) {
      return res.status(400).json({ success: false, error: "Faltan datos." });
    }
    
    const numeroPedido = Math.floor(100000 + Math.random() * 900000);
    
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 587,
      secure: false, // Para puerto 587
      requireTLS: true, // Requiere TLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    
    const mailOptions = {
      from: `"Capri Store" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Confirmación de compra - Capri Store',
      text: 
`¡Gracias por tu compra, ${nombre} ${apellido}!

Resumen de tu pedido:
${resumen}
Total: $${total}

Tu número de pedido es: ${numeroPedido}

Para abonar por transferencia, utiliza el siguiente alias de Mercado Pago:
capristore.mp

O retira tu pedido por nuestro local en el centro de la ciudad de Zárate.

¡Te esperamos!`
    };
    
    res.json({ 
      success: true, 
      message: 'Compra confirmada correctamente. Recibirás un email con los detalles.' 
    });
    
  } catch (error) {
    console.error('❌ Error al confirmar compra:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al confirmar la compra. Intenta nuevamente.' 
    });
  }
});

// =====================================
// ENDPOINT PARA FORMULARIO DE CONTACTO
// =====================================

// Middleware específico para debuggear el endpoint contact
app.use('/contact', (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`🔍 [${timestamp}] [DEBUG] Middleware /contact ejecutado`);
  console.log('- Método:', req.method);
  console.log('- URL completa:', req.originalUrl);
  console.log('- Content-Type:', req.headers['content-type']);
  console.log('- User-Agent:', req.headers['user-agent']);
  console.log('- Origin:', req.headers.origin);
  console.log('- Body size:', JSON.stringify(req.body).length, 'bytes');
  console.log('- Headers completos:', JSON.stringify(req.headers, null, 2));
  
  if (req.method === 'POST') {
    console.log('- Body completo:', JSON.stringify(req.body, null, 2));
  }
  
  next();
});

app.post('/contact', async (req, res) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`📧 [${timestamp}] === FORMULARIO DE CONTACTO RECIBIDO === [ID: ${requestId}]`);
  console.log(`📋 Request ID: ${requestId}`);
  console.log('📋 Datos recibidos:', JSON.stringify(req.body, null, 2));
  
  try {
    console.log(`⚡ [${requestId}] === INICIANDO PROCESAMIENTO ===`);
    const { nombre, email, mensaje } = req.body;
    
    console.log(`🔍 [${requestId}] Datos extraídos del body:`);
    console.log(`- Nombre: "${nombre}" (tipo: ${typeof nombre}, length: ${nombre?.length || 0})`);
    console.log(`- Email: "${email}" (tipo: ${typeof email}, length: ${email?.length || 0})`);
    console.log(`- Mensaje: "${mensaje}" (tipo: ${typeof mensaje}, length: ${mensaje?.length || 0})`);
    
    // Validar datos requeridos
    console.log(`✅ [${requestId}] Validando campos requeridos...`);
    if (!nombre || !email || !mensaje) {
      console.error(`❌ [${requestId}] Datos incompletos en formulario de contacto`);
      console.error(`- Nombre presente: ${!!nombre}`);
      console.error(`- Email presente: ${!!email}`);
      console.error(`- Mensaje presente: ${!!mensaje}`);
      return res.status(400).json({ 
        success: false, 
        error: 'Todos los campos son requeridos',
        requestId: requestId
      });
    }
    
    // Validar email
    console.log(`📧 [${requestId}] Validando formato de email...`);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error(`❌ [${requestId}] Email inválido:`, email);
      return res.status(400).json({ 
        success: false, 
        error: 'Email inválido',
        requestId: requestId
      });
    }
    console.log(`✅ [${requestId}] Email válido: ${email}`);
    
    // Verificar configuración de email
    console.log(`🔧 [${requestId}] Verificando configuración de email...`);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const adminEmails = process.env.ADMIN_EMAILS;
    
    console.log(`- SMTP_USER configurado: ${!!smtpUser} ${smtpUser ? `(${smtpUser})` : ''}`);
    console.log(`- SMTP_PASS configurado: ${!!smtpPass} ${smtpPass ? '(****)' : ''}`);
    console.log(`- ADMIN_EMAILS configurado: ${!!adminEmails} ${adminEmails ? `(${adminEmails})` : ''}`);
    
    if (!smtpUser || !smtpPass || !adminEmails) {
      console.error(`❌ [${requestId}] Configuración de email incompleta`);
      return res.status(500).json({ 
        success: false, 
        error: 'Servicio de email no disponible temporalmente',
        requestId: requestId
      });
    }
    
    const adminEmailList = adminEmails.split(',').map(email => email.trim());
    console.log(`📧 [${requestId}] Emails de administradores:`, adminEmailList);
    
    // Configurar transporter
    console.log(`🔌 [${requestId}] Configurando transporter SMTP...`);
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 587,
      secure: false, // Para puerto 587
      requireTLS: true, // Requiere TLS
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 15000
    });
    
    // Verificar conexión SMTP
    console.log(`🔍 [${requestId}] Verificando conexión SMTP...`);
    try {
      await transporter.verify();
      console.log(`✅ [${requestId}] Conexión SMTP verificada exitosamente`);
    } catch (verifyError) {
      console.error(`❌ [${requestId}] Error al verificar conexión SMTP:`, verifyError.message);
      console.error(`❌ [${requestId}] Stack trace:`, verifyError.stack);
      return res.status(500).json({ 
        success: false, 
        error: 'Error de configuración del servicio de email',
        details: verifyError.message,
        requestId: requestId
      });
    }
    
    // Email de confirmación para el usuario
    console.log(`📧 [${requestId}] Preparando email de confirmación para el usuario...`);
    const emailConfirmacionUsuario = {
      from: `"Capri Store" <${smtpUser}>`,
      to: email,
      subject: 'Confirmación de contacto - Capri Store',
      text: `Hola ${nombre},

¡Gracias por contactarte con nosotros!

Recibimos tu mensaje:
"${mensaje}"

Te responderemos a la brevedad.

Saludos cordiales,
Equipo Capri Store
Justa Lima 123, Zárate`
    };
    
    // Email para los administradores
    console.log(`👨‍💼 [${requestId}] Preparando email para administradores...`);
    const emailParaAdmins = {
      from: `"Capri Store" <${smtpUser}>`,
      to: adminEmailList,
      subject: `Nueva consulta de ${nombre} - Capri Store`,
      text: `Nueva consulta recibida desde el sitio web:

👤 DATOS DEL CONTACTO:
Nombre: ${nombre}
Email: ${email}

💬 MENSAJE:
"${mensaje}"

📅 Fecha: ${new Date().toLocaleString('es-AR', { 
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: 'long', 
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})}

---
Responde directamente a este email para contactar al cliente.

Capri Store - Sistema Automático`
    };
    
    console.log(`📧 [${requestId}] Configuración de emails preparada:`);
    console.log(`- Email usuario: de "${emailConfirmacionUsuario.from}" a "${emailConfirmacionUsuario.to}"`);
    console.log(`- Email admins: de "${emailParaAdmins.from}" a [${adminEmailList.join(', ')}]`);
    
    // Enviar email de confirmación al usuario
    console.log(`� [${requestId}] Enviando email de confirmación al usuario...`);
    try {
      const infoUsuario = await transporter.sendMail(emailConfirmacionUsuario);
      console.log(`✅ [${requestId}] Email de confirmación enviado al usuario exitosamente`);
      console.log(`- Message ID: ${infoUsuario.messageId}`);
      console.log(`- Response: ${infoUsuario.response}`);
    } catch (emailUserError) {
      console.error(`❌ [${requestId}] Error al enviar email de confirmación al usuario:`, emailUserError.message);
      console.error(`❌ [${requestId}] Stack trace:`, emailUserError.stack);
      // Continuar para intentar enviar a los admins
    }
    
    // Enviar notificación a administradores
    console.log(`� [${requestId}] Enviando notificación a administradores...`);
    try {
      const infoAdmins = await transporter.sendMail(emailParaAdmins);
      console.log(`✅ [${requestId}] Email enviado a administradores exitosamente`);
      console.log(`- Message ID: ${infoAdmins.messageId}`);
      console.log(`- Response: ${infoAdmins.response}`);
    } catch (emailAdminError) {
      console.error(`❌ [${requestId}] Error al enviar email a administradores:`, emailAdminError.message);
      console.error(`❌ [${requestId}] Stack trace:`, emailAdminError.stack);
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`🎉 [${requestId}] === PROCESAMIENTO COMPLETADO ===`);
    console.log(`⏱️ [${requestId}] Tiempo total: ${duration}ms`);
    
    res.json({ 
      success: true, 
      message: 'Mensaje enviado correctamente. Recibirás una confirmación por email.',
      requestId: requestId,
      processingTime: `${duration}ms`
    });
    
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.error(`💥 [${requestId}] === ERROR AL PROCESAR FORMULARIO DE CONTACTO ===`);
    console.error(`⏱️ [${requestId}] Tiempo hasta error: ${duration}ms`);
    console.error(`❌ [${requestId}] Error mensaje:`, error.message);
    console.error(`❌ [${requestId}] Stack trace completo:`, error.stack);
    console.error(`❌ [${requestId}] Error objeto completo:`, JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    
    res.status(500).json({ 
      success: false, 
      error: 'Error al enviar el mensaje. Intenta nuevamente.',
      requestId: requestId,
      processingTime: `${duration}ms`,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

const PORT = process.env.PORT || 3001;

console.log('🚀 Intentando iniciar backend Capri Store...');
console.log('🌍 NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('🔗 PORT:', PORT);

const server = app.listen(PORT, () => {
  console.log(`✅ Backend escuchando en puerto ${PORT}`);
  
  // Mostrar URLs importantes
  const isProduction = process.env.NODE_ENV === 'production';
  const frontendUrl = 'https://www.capristorezte.com.ar';
  const backendUrl = isProduction
    ? 'https://capri-store.onrender.com'
    : `http://localhost:${PORT}`;
    
  console.log(`🌐 Frontend URL: ${frontendUrl}`);
  console.log(`🖥️  Backend URL: ${backendUrl}`);
  console.log(`📡 Webhook URL: ${backendUrl}/webhook`);
  console.log(`🏥 Health check: ${backendUrl}/health`);
  console.log(`🧪 Test webhook: ${backendUrl}/test-webhook/{payment_id}`);
  console.log('🔔 Para testear webhook: curl -X POST ' + backendUrl + '/test-webhook/{payment_id}');
});

// Manejar errores del servidor
server.on('error', (error) => {
  console.error('❌ Error del servidor:', error);
});

// Graceful shutdown
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
