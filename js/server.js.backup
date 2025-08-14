const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

// Cargar variables de entorno desde .env en la carpeta padre
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();

// SIEMPRE PRIMERO
app.use(express.json());

// Middleware de logging para depuración
app.use((req, res, next) => {
  console.log('--- REQUEST INICIO ---');
  console.log('Método:', req.method);
  console.log('URL:', req.originalUrl);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  if (req.method !== 'GET') {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
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
    'http://127.0.0.1:5500' // <--- agrega esta línea
  ]
}));


// Endpoint de salud para verificar que el servidor está funcionando
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    server: 'Capri Store Backend'
  });
});

// Configura Mercado Pago con la nueva sintaxis
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST;
console.log('Access Token configurado:', accessToken ? 'Sí' : 'No');
console.log('Access Token (primeros 20 chars):', accessToken ? accessToken.substring(0, 20) + '...' : 'No disponible');

// Configuración de la base de datos PostgreSQL con variables de entorno
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Máximo número de conexiones en el pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Verificar conexión a la base de datos al iniciar
async function verificarConexionBD() {
  try {
    const client = await pool.connect();
    console.log('✅ Conexión exitosa a PostgreSQL (Neon)');
    await client.query('SELECT NOW()');
    client.release();
  } catch (error) {
    console.error('❌ Error al conectar con PostgreSQL:', error.message);
    // En desarrollo, no es crítico que falle la BD
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

// Endpoint de prueba simple para crear preferencia
app.post('/test-crear-preferencia', async (req, res) => {
  try {
    console.log('=== TEST CREAR PREFERENCIA SIMPLE ===');
    
    const testPreference = {
      items: [{
        title: 'Producto de Prueba',
        quantity: 1,
        currency_id: 'ARS',
        unit_price: 100
      }],
      back_urls: {
        success: 'http://localhost:3001/success.html',
        failure: 'http://localhost:3001/failure.html',
        pending: 'http://localhost:3001/pending.html'
      }
      // Sin auto_return para testing local
    };
    
    console.log('Creando preferencia de prueba...');
    const preferenceObj = new Preference(client);
    const response = await preferenceObj.create({ body: testPreference });
    
    console.log('Respuesta exitosa:', response.init_point);
    res.json({ 
      success: true, 
      init_point: response.init_point,
      id: response.id 
    });
    
  } catch (error) {
    console.error('Error en test:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data 
    });
  }
});

// Endpoint de prueba para el SDK de Mercado Pago
app.get('/test-mp', async (req, res) => {
  try {
    console.log('=== TEST MERCADO PAGO ===');
    
    // Test básico de configuración
    const basicTest = {
      sdk_loaded: !!Preference,
      client_configured: !!client,
      access_token_configured: !!client.accessToken
    };
    
    console.log('Test básico:', basicTest);
    
    // Test de creación de preferencia simple
    try {
      const testPreference = {
        items: [{
          title: 'Test Product',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: 100
        }],
        back_urls: {
          success: 'http://localhost:3001/success.html',
          failure: 'http://localhost:3001/failure.html',
          pending: 'http://localhost:3001/pending.html'
        }
      };
      
      const preferenceObj = new Preference(client);
      const testResponse = await preferenceObj.create({ body: testPreference });
      
      console.log('Test de creación exitoso:', !!testResponse.init_point);
      
      res.json({ 
        status: 'OK',
        ...basicTest,
        preference_creation_test: 'SUCCESS',
        test_init_point: testResponse.init_point
      });
    } catch (prefError) {
      console.error('Error en test de preferencia:', prefError.message);
      res.json({ 
        status: 'PARTIAL_OK',
        ...basicTest,
        preference_creation_test: 'FAILED',
        preference_error: prefError.message
      });
    }
    
  } catch (error) {
    console.error('Error en test-mp:', error);
    res.status(500).json({ 
      status: 'ERROR',
      error: error.message 
    });
  }
});

app.post('/crear-preferencia', async (req, res) => {
  console.log('=== INICIO /crear-preferencia ===');
  console.log('Request body (raw):', JSON.stringify(req.body, null, 2));
  console.log('Tipo de req.body:', typeof req.body, req.body);
  if (req.headers) {
    console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  }
  try {
  const items = req.body.items;
  const datosCompradorMeta = req.body.datosComprador || null; // opcional: nombre, apellido, email, tipoEntrega
    console.log('Items recibidos:', JSON.stringify(items, null, 2));
    // Validación extra de items
    if (!Array.isArray(items) || items.length === 0) {
      const errorResponse = { error: "No hay productos en el carrito.", log: 'Items no válidos', timestamp: new Date().toISOString() };
      res.status(400).type('application/json').json(errorResponse);
      return;
    }
    // Validar que cada item tenga los campos requeridos y sean del tipo correcto
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
        res.status(400).type('application/json').json(errorResponse);
        return;
      }
    }
    // Determinar URL base según el entorno
    const isProduction = process.env.NODE_ENV === 'production';
    const baseUrl = isProduction
      ? 'https://www.capristorezte.com.ar'
      : 'http://localhost:3001';
    
    const preference = {
      items: items.map(item => ({
        title: item.title,
        quantity: item.quantity,
        currency_id: item.currency_id,
        unit_price: item.unit_price
      })),
      metadata: {
        itemsSimple: items.map(i => ({ title: i.title, quantity: i.quantity, unit_price: i.unit_price })),
        datosComprador: datosCompradorMeta || null
      },
      back_urls: {
        success: `${baseUrl}/success.html?status=approved`,
        failure: `${baseUrl}/failure.html?status=failure`,
        pending: `${baseUrl}/pending.html?status=pending`
      },
      // Solo usar auto_return en producción, no en localhost
      ...(isProduction ? { auto_return: "approved" } : {}),
      // Forzar binary_mode false para asegurar que se muestren los enlaces de retorno
      binary_mode: false,
      statement_descriptor: "CAPRI STORE",
      external_reference: "capri-" + Date.now(),
      expires: false, // No expirar la preferencia
      payment_methods: {
        excluded_payment_types: [], // Permitir todos los tipos
        installments: 12 // Permitir hasta 12 cuotas
      },
  // notification_url solo en producción donde MercadoPago pueda acceder
  ...(isProduction ? { notification_url: `${baseUrl}/webhook` } : {})
    };
    console.log('Preference enviada a Mercado Pago:', JSON.stringify(preference, null, 2));
    console.log('🔍 Configuración específica:');
    console.log('- Entorno:', isProduction ? 'PRODUCCIÓN' : 'DESARROLLO');
    console.log('- Base URL:', baseUrl);
    console.log('- Auto return:', preference.auto_return || 'NO CONFIGURADO');
    console.log('- Binary mode:', preference.binary_mode);
    console.log('- Back URLs configuradas:', !!preference.back_urls);
    
    // Crear preferencia con la nueva sintaxis del SDK
    const preferenceObj = new Preference(client);
    console.log('Creando preferencia...');
    console.log('Client configurado:', !!client);
    console.log('Access token presente:', !!client.accessToken);
    
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
        console.error('HTTP Headers:', err.response.headers);
        console.error('Response data:', err.response.data);
      }
      
      if (err.cause) {
        console.error('Error cause:', err.cause);
      }
      
      const errorResponse = { 
        error: 'Error al crear preferencia', 
        log: err.message, 
        details: err.response?.data || 'Sin detalles adicionales',
        timestamp: new Date().toISOString() 
      };
      res.status(500).type('application/json').json(errorResponse);
      return;
    }
    if (!response || !response.init_point) {
      const errorResponse = { error: 'Mercado Pago no devolvió un link de pago válido', log: 'init_point faltante', response, timestamp: new Date().toISOString() };
      res.status(500).type('application/json').json(errorResponse);
      return;
    }
    const result = { 
      init_point: response.init_point,
      id: response.id
    };
    res.type('application/json').json(result);
    console.log('Enviando respuesta al frontend:', JSON.stringify(result, null, 2));
    console.log('=== FIN /crear-preferencia EXITOSO ===');
  } catch (error) {
    console.error('=== ERROR en /crear-preferencia ===');
    console.error('Error completo:', error);
    if (error.response && error.response.data) {
      console.error('Mercado Pago response data:', error.response.data);
    }
    const errorResponse = {
      error: 'Error al procesar el pago',
      message: error.message,
      timestamp: new Date().toISOString(),
      mercadoPagoData: error.response && error.response.data ? error.response.data : null
    };
    try {
      res.status(500).type('application/json').json(errorResponse);
    } catch (jsonErr) {
      res.status(500).type('text/plain').send('Error interno al procesar el pago');
    }
    console.log('=== FIN /crear-preferencia CON ERROR ===');
  }
});

// Nuevo endpoint para confirmar compra y enviar correo
app.post('/confirmar-compra', async (req, res) => {
  try {
    const { nombre, apellido, email, resumen, total } = req.body;
    if (!nombre || !apellido || !email || !resumen || !total) {
      const errorResponse = { success: false, error: "Faltan datos." };
      console.log('Enviando respuesta de error al frontend:', JSON.stringify(errorResponse, null, 2));
      return res.status(400).json(errorResponse);
    }
    // Generar número de pedido único
    const numeroPedido = Math.floor(100000 + Math.random() * 900000);
    // Configura tu transporter de nodemailer (Zoho Mail)
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    //  Email content
    const mailOptions = {
      from: `"Capri Store" <${process.env.EMAIL_USER}>`,
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
    // Enviar el correo
    await transporter.sendMail(mailOptions);
    const successResponse = { success: true, numeroPedido };
    console.log('Enviando respuesta exitosa al frontend:', JSON.stringify(successResponse, null, 2));
    res.json(successResponse);
  } catch (error) {
    const errorResponse = { success: false, error: error.message };
    console.log('Enviando respuesta de error al frontend:', JSON.stringify(errorResponse, null, 2));
    res.status(500).json(errorResponse);
  }
});

const PORT = process.env.PORT || 3001;

// Función para enviar correo de confirmación
async function enviarCorreoConfirmacion(datosComprador, productos, total, numeroPedido) {
  const startTime = Date.now();
  console.log('📧 === INICIANDO ENVÍO DE CORREO ===');
  console.log('⏰ Timestamp:', new Date().toISOString());
  
  try {
    // Verificar credenciales con detalle
    console.log('🔐 === VERIFICACIÓN CREDENCIALES EMAIL ===');
    console.log('EMAIL_USER presente:', !!process.env.EMAIL_USER);
    console.log('EMAIL_USER valor:', process.env.EMAIL_USER ? process.env.EMAIL_USER.substring(0, 10) + '...' : 'NO CONFIGURADO');
    console.log('EMAIL_PASS presente:', !!process.env.EMAIL_PASS);
    console.log('EMAIL_PASS longitud:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length + ' caracteres' : 'NO CONFIGURADO');
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ CREDENCIALES FALTANTES:');
      console.error('- EMAIL_USER:', !!process.env.EMAIL_USER);
      console.error('- EMAIL_PASS:', !!process.env.EMAIL_PASS);
      throw new Error('Credenciales de email no configuradas');
    }

    console.log('✅ Credenciales verificadas correctamente');

    // Validar datos de entrada
    console.log('📋 === VALIDACIÓN DATOS ENTRADA ===');
    console.log('datosComprador:', JSON.stringify(datosComprador, null, 2));
    console.log('productos count:', productos ? productos.length : 'undefined');
    console.log('total:', total, typeof total);
    console.log('numeroPedido:', numeroPedido);

    if (!datosComprador || !datosComprador.email || !datosComprador.nombre) {
      throw new Error('Datos del comprador incompletos para envío de correo');
    }

    // Configurar transporter con logging
    console.log('⚙️ === CONFIGURACIÓN TRANSPORTER ===');
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      debug: true, // Habilitar debug de SMTP
      logger: true // Habilitar logger
    });

    console.log('✅ Transporter configurado');

    // Verificar conexión SMTP
    console.log('🔌 === VERIFICACIÓN CONEXIÓN SMTP ===');
    try {
      await transporter.verify();
      console.log('✅ Conexión SMTP verificada exitosamente');
    } catch (verifyError) {
      console.error('❌ Error en verificación SMTP:', verifyError.message);
      throw new Error(`Error de conexión SMTP: ${verifyError.message}`);
    }

    // Crear resumen de productos con logging
    console.log('📝 === CREACIÓN RESUMEN PRODUCTOS ===');
    let resumenProductos = '';
    let subtotal = 0;
    
    if (!productos || !Array.isArray(productos)) {
      console.error('❌ Productos no válidos para resumen:', productos);
      throw new Error('Lista de productos no válida');
    }
    
    productos.forEach((producto, index) => {
      console.log(`Procesando producto ${index + 1}:`, producto);
      const totalProducto = producto.cantidad * producto.precio;
      subtotal += totalProducto;
      resumenProductos += `${index + 1}. ${producto.nombre}`;
      if (producto.talle) {
        resumenProductos += ` (Talle: ${producto.talle})`;
      }
      resumenProductos += `\n   Cantidad: ${producto.cantidad} x $${producto.precio.toFixed(2)} = $${totalProducto.toFixed(2)}\n`;
    });

    console.log('Resumen productos generado:', resumenProductos);
    console.log('Subtotal calculado:', subtotal);

    // Determinar tipo de entrega
    console.log('🚚 === CONFIGURACIÓN ENTREGA ===');
    const tipoEntrega = datosComprador.tipoEntrega || 'retiro';
    console.log('Tipo de entrega:', tipoEntrega);
    
    let mensajeEntrega = '';
    if (tipoEntrega === 'domicilio') {
      mensajeEntrega = 'Nos comunicaremos contigo para coordinar el envío a tu domicilio.';
    } else {
      mensajeEntrega = 'Podes retirarlo por Justa Lima 123, Zárate.';
    }
    console.log('Mensaje entrega:', mensajeEntrega);

    // Crear contenido del email
    console.log('✍️ === CREACIÓN CONTENIDO EMAIL ===');
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
      from: `"Capri Store" <${process.env.EMAIL_USER}>`,
      to: datosComprador.email,
      subject: `Confirmación de compra #${numeroPedido} - Capri Store`,
      text: emailText
    };

    console.log('📬 === CONFIGURACIÓN FINAL EMAIL ===');
    console.log('From:', mailOptions.from);
    console.log('To:', mailOptions.to);
    console.log('Subject:', mailOptions.subject);
    console.log('Content length:', mailOptions.text.length, 'caracteres');

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
    console.log('📊 Response:', info.response);
    console.log('✅ Email enviado a:', datosComprador.email);
    
    return { 
      success: true, 
      messageId: info.messageId,
      response: info.response,
      duration: duration + 'ms'
    };
    
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.error('💥 === ERROR AL ENVIAR CORREO ===');
    console.error('⏱️ Tiempo hasta error:', duration + 'ms');
    console.error('Error tipo:', error.constructor.name);
    console.error('Error código:', error.code);
    console.error('Error mensaje:', error.message);
    console.error('Error response:', error.response);
    console.error('Error responseCode:', error.responseCode);
    console.error('Error command:', error.command);
    console.error('Error stack:', error.stack);
    
    // No fallar todo el proceso si el email falla
    return { 
      success: false, 
      error: error.message,
      code: error.code,
      duration: duration + 'ms'
    };
  }
}

// Webhook para notificaciones de Mercado Pago (crea el pedido aunque el usuario no vuelva a success)
app.post('/webhook', async (req, res) => {
  try {
    console.log('🔔 Webhook recibido:', JSON.stringify(req.body));

    const topic = req.body.type || req.query.type || req.headers['x-mp-topic'];
    if ((topic || '').toLowerCase() !== 'payment') {
      return res.status(200).send('IGNORED');
    }

    const paymentId = req.body.data?.id || req.query['data.id'];
    if (!paymentId) {
      console.warn('Webhook sin paymentId');
      return res.status(400).send('MISSING PAYMENT ID');
    }

    // Idempotencia: si ya tenemos algún producto con id_pedido asociado a este payment, no reprocesar
    try {
      const cli = await pool.connect();
      try {
        const { rows } = await cli.query(
          `SELECT COUNT(*) as count FROM productos WHERE id_pedido = $1`,
          [paymentId]
        );
        if (rows && rows[0] && parseInt(rows[0].count) > 0) {
          console.log('Webhook idempotente: ya procesado', paymentId);
          return res.status(200).send('ALREADY PROCESSED');
        }
      } finally { cli.release(); }
    } catch (idempotencyError) {
      console.warn('Error en verificación de idempotencia:', idempotencyError.message);
    }

    // Traer pago desde MP y reconstruir datos
    const paymentClient = new Payment(client);
    const mpPayment = await paymentClient.get({ id: paymentId });
    console.log('Pago recuperado MP:', JSON.stringify(mpPayment));

    // Solo procesar pagos aprobados
    if (!mpPayment || (mpPayment.status !== 'approved' && mpPayment.status !== 'authorized')) {
      console.log(`⏸️ Pago no aprobado, status: ${mpPayment?.status || 'unknown'}`);
      return res.status(200).send('PAYMENT NOT APPROVED');
    }

    console.log('✅ Pago aprobado, procesando pedido...');

    const metadata = mpPayment.metadata || {};
    const itemsSimple = Array.isArray(metadata.itemsSimple) ? metadata.itemsSimple : [];
    const datosComprador = metadata.datosComprador || {
      nombre: mpPayment.payer?.first_name || 'Cliente',
      apellido: mpPayment.payer?.last_name || '',
      email: mpPayment.payer?.email || '',
      telefono: '',
      tipoEntrega: 'Retiro'
    };

    console.log('📦 Items reconstruidos:', itemsSimple);
    console.log('👤 Datos del comprador reconstruidos:', datosComprador);

    // Construir productos del pedido desde el metadata
    const productos = itemsSimple.map(it => ({
      nombre: it.title,
      cantidad: it.quantity,
      precio: it.unit_price,
      img: '', 
      txt: ''
    }));

    console.log('🛍️ Productos a procesar:', productos);

    // Obtener datos completos del comprador
    const nombreCompleto = [datosComprador.nombre, datosComprador.apellido]
      .filter(Boolean)
      .join(' ')
      .trim() || datosComprador.nombre || 'Cliente';
    
    const tipoEntrega = (datosComprador.tipoEntrega || '').toLowerCase() === 'envio' ? 'Envio' : 'Retiro';

    console.log('👤 Datos del cliente:', {
      nombre: nombreCompleto,
      email: datosComprador.email,
      tipoEntrega: tipoEntrega
    });

    // Procesar cada producto del pedido
    if (productos.length > 0) {
      const cli = await pool.connect();
      try {
        await cli.query('BEGIN');
        
        let productosActualizados = 0;
        
        for (const producto of productos) {
          // Buscar productos disponibles que coincidan con el nombre y precio
          const nombreLimpio = producto.nombre.split('(')[0].trim(); // Quitar talle del nombre
          const cantidad = parseInt(producto.cantidad, 10);
          
          console.log(`🔍 Buscando ${cantidad} unidades de "${nombreLimpio}" a precio ${producto.precio}`);
          
          const queryBuscar = `
            SELECT id_articulo, prenda, talle, precio_venta_transferencia
            FROM productos 
            WHERE LOWER(TRIM(prenda)) = LOWER($1)
              AND ABS(precio_venta_transferencia - $2) < 0.01
              AND id_pedido IS NULL
              AND estado IS NULL
            ORDER BY id_articulo
            LIMIT $3
          `;
          
          const { rows: productosDisponibles } = await cli.query(queryBuscar, [
            nombreLimpio,
            parseFloat(producto.precio),
            cantidad
          ]);
          
          console.log(`📦 Encontrados ${productosDisponibles.length} productos disponibles`);
          
          if (productosDisponibles.length >= cantidad) {
            // Actualizar los productos encontrados
            for (let i = 0; i < cantidad; i++) {
              const prod = productosDisponibles[i];
              
              const queryActualizar = `
                UPDATE productos 
                SET 
                  id_pedido = $1,
                  pedido_fecha = NOW(),
                  pedido_nombre_cliente = $2,
                  pedido_correo_cliente = $3,
                  pedido_monto_total = $4,
                  pedido_tipo_entrega = $5,
                  estado = 'Vendido'
                WHERE id_articulo = $6
              `;
              
              await cli.query(queryActualizar, [
                paymentId,
                nombreCompleto,
                datosComprador.email,
                parseFloat(mpPayment.transaction_amount),
                tipoEntrega,
                prod.id_articulo
              ]);
              
              productosActualizados++;
            }
            
            console.log(`✅ Actualizados ${cantidad} productos de "${nombreLimpio}"`);
          } else {
            console.warn(`⚠️ Solo se encontraron ${productosDisponibles.length} de ${cantidad} productos solicitados para "${nombreLimpio}"`);
            
            // Actualizar los que se pudieron encontrar
            for (const prod of productosDisponibles) {
              const queryActualizar = `
                UPDATE productos 
                SET 
                  id_pedido = $1,
                  pedido_fecha = NOW(),
                  pedido_nombre_cliente = $2,
                  pedido_correo_cliente = $3,
                  pedido_monto_total = $4,
                  pedido_tipo_entrega = $5,
                  estado = 'Vendido'
                WHERE id_articulo = $6
              `;
              
              await cli.query(queryActualizar, [
                paymentId,
                nombreCompleto,
                datosComprador.email,
                parseFloat(mpPayment.transaction_amount),
                tipoEntrega,
                prod.id_articulo
              ]);
              
              productosActualizados++;
            }
          }
        }
        
        await cli.query('COMMIT');
        console.log(`✅ Pedido creado por webhook. Productos actualizados: ${productosActualizados}`);
        
        // Enviar correo de confirmación también desde el webhook
        if (datosComprador.email && nombreCompleto && productosActualizados > 0) {
          try {
            await enviarCorreoConfirmacion(
              datosComprador, 
              productos, 
              mpPayment.transaction_amount, 
              paymentId
            );
            console.log('✅ Correo enviado desde webhook para payment', paymentId);
          } catch (emailError) {
            console.error('❌ Error al enviar correo desde webhook:', emailError.message);
          }
        }
        
      } catch (e) {
        await cli.query('ROLLBACK');
        console.error('❌ Error al procesar pedido en webhook:', e.message);
        throw e;
      } finally { 
        cli.release(); 
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error en /webhook:', err.message);
    res.status(200).send('ERROR'); // responder 200 para no reintentos infinitos de MP
  }
});

// Endpoint temporal para debugging de stored procedures
app.get('/debug-sp', async (req, res) => {
  try {
    const client = await pool.connect();
    
    // Consultar información del stored procedure con más detalle
    const result = await client.query(`
      SELECT 
        p.proname,
        pg_catalog.pg_get_function_arguments(p.oid) as argumentos,
        p.prokind,
        pg_catalog.oidvectortypes(p.proargtypes) as tipos_argumentos
      FROM pg_proc p 
      WHERE p.proname = 'sp_crear_pedido_web'
    `);
    
    client.release();
    
    res.json({
      procedure_info: result.rows,
      timestamp: new Date().toISOString(),
      total_procedures: result.rows.length
    });
    
  } catch (error) {
    console.error('Error en debug-sp:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para crear un pedido en la base de datos después del pago exitoso
app.post('/crear-pedido', async (req, res) => {
  const startTime = Date.now();
  console.log('🚀 === INICIO /crear-pedido ===');
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
        // Buscar productos disponibles que coincidan
        const nombreLimpio = producto.nombre.split('(')[0].trim(); // Quitar talle del nombre
        const cantidad = parseInt(producto.cantidad, 10);
        
        console.log(`🔍 Buscando ${cantidad} unidades de "${nombreLimpio}" a precio ${producto.precio}`);
        
        const queryBuscar = `
          SELECT id_articulo, prenda, talle, precio_venta_transferencia
          FROM productos 
          WHERE LOWER(TRIM(prenda)) = LOWER($1)
            AND ABS(precio_venta_transferencia - $2) < 0.01
            AND id_pedido IS NULL
            AND estado IS NULL
          ORDER BY id_articulo
          LIMIT $3
        `;
        
        const { rows: productosDisponibles } = await dbClient.query(queryBuscar, [
          nombreLimpio,
          parseFloat(producto.precio),
          cantidad
        ]);
        
        console.log(`📦 Encontrados ${productosDisponibles.length} productos disponibles`);
        
        if (productosDisponibles.length >= cantidad) {
          // Actualizar los productos encontrados
          for (let i = 0; i < cantidad; i++) {
            const prod = productosDisponibles[i];
            
            const queryActualizar = `
              UPDATE productos 
              SET 
                id_pedido = $1,
                pedido_fecha = NOW(),
                pedido_nombre_cliente = $2,
                pedido_correo_cliente = $3,
                pedido_monto_total = $4,
                pedido_tipo_entrega = $5,
                estado = 'Vendido'
              WHERE id_articulo = $6
            `;
            
            await dbClient.query(queryActualizar, [
              paymentId,
              nombreCompleto,
              datosComprador.email,
              parseFloat(total),
              tipoEntrega,
              prod.id_articulo
            ]);
            
            productosActualizados++;
          }
          
          console.log(`✅ Actualizados ${cantidad} productos de "${nombreLimpio}"`);
        } else {
          console.warn(`⚠️ Solo se encontraron ${productosDisponibles.length} de ${cantidad} productos para "${nombreLimpio}"`);
          
          // Actualizar los que se pudieron encontrar
          for (const prod of productosDisponibles) {
            const queryActualizar = `
              UPDATE productos 
              SET 
                id_pedido = $1,
                pedido_fecha = NOW(),
                pedido_nombre_cliente = $2,
                pedido_correo_cliente = $3,
                pedido_monto_total = $4,
                pedido_tipo_entrega = $5,
                estado = 'Vendido'
              WHERE id_articulo = $6
            `;
            
            await dbClient.query(queryActualizar, [
              paymentId,
              nombreCompleto,
              datosComprador.email,
              parseFloat(total),
              tipoEntrega,
              prod.id_articulo
            ]);
            
            productosActualizados++;
          }
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
      
      // Limpiar carrito del localStorage (esto se hace en el frontend)
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
      const parsedId = parseIdFromItem(item);
      const cant = parseInt(item.cantidad || 1, 10);
      if (parsedId) {
        console.log('🆔 ID detectado en nombre:', item.nombre, '=>', parsedId, 'x', cant);
        for (let i = 0; i < cant; i++) idList.push(parsedId);
      } else {
        fallbackItems.push(item);
      }
    }

    if (fallbackItems.length > 0) {
      try {
        console.log('🔎 IDs no detectados en nombre, buscando en BD por descripcion+precio...', fallbackItems.length, 'items');
        const dbClientLookup = await pool.connect();
        try {
          for (const item of fallbackItems) {
            const nombreBase = (item.nombre || '').split('(Talle')[0].trim();
            const precioNum = parseFloat(item.precio);
            const cantidadNum = parseInt(item.cantidad || 1, 10);
            console.log('Buscando coincidencias para:', { nombreBase, precioNum, cantidadNum });

            const query = `
              SELECT id_articulo
              FROM productos
              WHERE lower(descripcion) = lower($1)
                AND ABS(precio - $2) < 0.01
                AND (id_pedido IS NULL)
              LIMIT $3
            `;
            const { rows } = await dbClientLookup.query(query, [nombreBase, precioNum, cantidadNum]);
            if (!rows || rows.length === 0) {
              console.warn('⚠️ No se encontraron coincidencias para', nombreBase, 'con precio', precioNum);
              continue;
            }
            for (const r of rows) idList.push(r.id_articulo);
          }
        } finally {
          dbClientLookup.release();
        }
      } catch (lookupErr) {
        console.error('❌ Error buscando IDs de productos:', lookupErr.message);
      }
    }

    if (idList.length === 0) {
      console.warn('⚠️ No se pudieron resolver IDs de productos; construyendo lista desde nombres como fallback');
    }

    const idProductosTexto = idList.join(',');
    console.log('IDs de productos para SP:', idProductosTexto);

    // Armar nombre completo "Nombre Apellido" si hay apellido
    const nombreCompleto = [datosComprador?.nombre, datosComprador?.apellido]
      .filter(Boolean)
      .join(' ')
      .trim() || datosComprador?.nombre || '';

    const spParams = [
      idProductosTexto,                  // in_id_productos (text) - lista "1,2,3"
      parseFloat(total),                 // in_monto_total (double precision)
      nombreCompleto,                    // in_nombre_cliente (text)
      datosComprador.email,              // in_correo_cliente (text)
      'MercadoPago - ' + paymentId,      // in_metodo_pago (text)
      tipoEntregaSP                      // in_tipo_entrega (text) - "Retiro" o "Envio"
    ];
    console.log('Parámetros para SP:', spParams);

    // Ejecutar stored procedure para crear el pedido
    console.log('💾 === EJECUCIÓN STORED PROCEDURE ===');
    
    let client;
    try {
      console.log('Obteniendo conexión del pool...');
      client = await pool.connect();
      console.log('✅ Conexión a BD establecida exitosamente');
      
      console.log('Iniciando transacción...');
      await client.query('BEGIN');
      console.log('✅ Transacción iniciada');
      
      // Verificar que el stored procedure existe
      console.log('🔍 Verificando existencia del stored procedure...');
      const spCheck = await client.query(
        "SELECT proname FROM pg_proc WHERE proname = 'sp_crear_pedido_web'"
      );
      console.log('SP existe:', spCheck.rows.length > 0, spCheck.rows);
      
      if (spCheck.rows.length === 0) {
        throw new Error('El stored procedure sp_crear_pedido_web no existe en la base de datos');
      }
      
      // Ejecutar el stored procedure
      console.log('⚡ Ejecutando stored procedure sp_crear_pedido_web...');
      console.log('Parámetros finales:', spParams);
      
      await client.query(
        'CALL sp_crear_pedido_web($1::TEXT, $2::DOUBLE PRECISION, $3::TEXT, $4::TEXT, $5::TEXT, $6::TEXT)',
        spParams
      );
      console.log('✅ Stored procedure ejecutado exitosamente');

      // Intentar leer el id_pedido asignado a esos productos
      let numeroPedidoReal = null;
      try {
        if (idList.length > 0) {
          const { rows: pedidoRows } = await client.query(
            `SELECT id_pedido
             FROM productos
             WHERE id_articulo = ANY($1::int[])
               AND id_pedido IS NOT NULL
             LIMIT 1`,
            [idList]
          );
          numeroPedidoReal = (pedidoRows && pedidoRows[0] && pedidoRows[0].id_pedido) || null;
        } else {
          // Fallback: tomar el máximo id_pedido recién asignado
          const { rows: maxRows } = await client.query(
            `SELECT id_pedido
             FROM productos
             WHERE id_pedido IS NOT NULL
             ORDER BY CAST(SUBSTRING(id_pedido FROM 2) AS INT) DESC
             LIMIT 1`
          );
          numeroPedidoReal = (maxRows && maxRows[0] && maxRows[0].id_pedido) || null;
        }
      } catch (readErr) {
        console.error('⚠️ Error leyendo id_pedido luego del SP:', readErr.message);
      }

      await client.query('COMMIT');
      console.log('✅ Transacción confirmada');

      // Enviar correo de confirmación antes de responder
      console.log('📧 === ENVÍO DE CORREO ===');
      try {
        const emailResult = await enviarCorreoConfirmacion(datosComprador, productos, total, numeroPedidoReal || fallbackNumeroPedido);
        if (emailResult.success) {
          console.log('✅ Correo enviado exitosamente:', emailResult.messageId);
        } else {
          console.error('⚠️ Error al enviar correo (continuando):', emailResult.error);
        }
      } catch (emailError) {
        console.error('⚠️ Error crítico en correo (continuando):', emailError.message);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const responseOrderId = numeroPedidoReal || fallbackNumeroPedido;
      console.log('🎉 === PEDIDO CREADO EXITOSAMENTE ===');
      console.log('⏱️ Tiempo total:', duration + 'ms');
      console.log('🔢 Número de pedido:', responseOrderId);
      console.log('💳 Payment ID:', paymentId);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Pedido creado exitosamente',
  orderId: responseOrderId,
        paymentId: paymentId,
  processingTime: duration + 'ms',
  agotados: idList // devolver ids comprados para que el front pueda marcar sin stock
      });
      
    } catch (dbError) {
      console.error('❌ === ERROR EN BASE DE DATOS ===');
      console.error('Error tipo:', dbError.constructor.name);
      console.error('Error código:', dbError.code);
      console.error('Error mensaje:', dbError.message);
      console.error('Error detalle:', dbError.detail);
      console.error('Error stack:', dbError.stack);
      
      if (client) {
        try {
          await client.query('ROLLBACK');
          console.log('✅ Rollback ejecutado');
        } catch (rollbackError) {
          console.error('❌ Error en rollback:', rollbackError.message);
        }
      }
      
      throw dbError;
    } finally {
      if (client) {
        client.release();
        console.log('✅ Conexión BD liberada');
      }
    }
    
  // Nota: el flujo happy path ya retornó dentro del bloque de transacción tras COMMIT
    
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.error('💥 === ERROR CRÍTICO EN /crear-pedido ===');
    console.error('⏱️ Tiempo hasta error:', duration + 'ms');
    console.error('Error tipo:', error.constructor.name);
    console.error('Error mensaje:', error.message);
    console.error('Error código:', error.code);
    console.error('Error stack completo:', error.stack);
    
    res.status(500).json({ 
      success: false,
      error: 'Error interno del servidor al crear pedido',
      details: error.message,
      code: error.code,
      processingTime: duration + 'ms'
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

// Servir archivos estáticos desde la carpeta raíz del proyecto (al final)
app.use(express.static(path.join(__dirname, '..')));

console.log('Intentando iniciar backend Capri Store...');
app.listen(PORT, () => {
  console.log(`Backend escuchando en puerto ${PORT}`);
});
