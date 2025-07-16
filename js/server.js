const express = require('express');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();

// Middleware de logging para depuración
app.use((req, res, next) => {
  console.log('--- REQUEST INICIO ---');
  console.log('Método:', req.method);
  console.log('URL:', req.originalUrl);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  if (req.method !== 'GET') {
    let bodyData = req.body;
    // Si el body está vacío, intentar leer el raw body
    if (!bodyData || Object.keys(bodyData).length === 0) {
      let rawBody = [];
      req.on('data', chunk => rawBody.push(chunk));
      req.on('end', () => {
        try {
          const rawString = Buffer.concat(rawBody).toString();
          console.log('Raw Body:', rawString);
        } catch (e) {
          console.log('Error leyendo raw body:', e.message);
        }
        next();
      });
      return;
    } else {
      console.log('Body:', JSON.stringify(bodyData, null, 2));
    }
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
app.use(express.json());
app.use(cors({
  origin: ['https://www.capristorezte.com.ar', 'https://capristorezte.com.ar', 'http://localhost:3000', 'http://localhost:8080', 'http://localhost:3001']
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
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST || 'TEST-4916429126604774-122016-29a7e1b7c38cb7a5c96b0962b4e6ec1b-2142598569';
console.log('Access Token configurado:', accessToken ? 'Sí' : 'No');

const client = new MercadoPagoConfig({
  accessToken: accessToken,
  options: {
    timeout: 10000,
    idempotencyKey: 'capri-store-' + Date.now()
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
          success: 'https://www.capristorezte.com.ar/success.html',
          failure: 'https://www.capristorezte.com.ar/failure.html',
          pending: 'https://www.capristorezte.com.ar/pending.html'
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
  if (req.headers) {
    console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  }
  try {
    const items = req.body.items;
    console.log('Items recibidos:', JSON.stringify(items, null, 2));
    // Validación extra de items
    if (!Array.isArray(items) || items.length === 0) {
      const errorResponse = { error: "No hay productos en el carrito.", log: 'Items no válidos', timestamp: new Date().toISOString() };
      console.log('Enviando respuesta de error al frontend:', JSON.stringify(errorResponse, null, 2));
      return res.status(400).json(errorResponse);
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
        console.log('Enviando respuesta de error al frontend:', JSON.stringify(errorResponse, null, 2));
        return res.status(400).json(errorResponse);
      }
    }
    // Determinar URL base según el entorno
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://www.capristorezte.com.ar' 
      : 'http://localhost:3001';
    const preference = {
      items: items.map(item => ({
        title: item.title,
        quantity: item.quantity,
        currency_id: item.currency_id,
        unit_price: item.unit_price
      })),
      back_urls: {
        success: `${baseUrl}/success.html?status=approved`,
        failure: `${baseUrl}/failure.html?status=failure`,
        pending: `${baseUrl}/pending.html?status=pending`
      },
      auto_return: "approved",
      statement_descriptor: "CAPRI STORE",
      external_reference: "capri-" + Date.now(),
      payment_methods: {
        excluded_payment_types: [], // Permitir todos los tipos
        installments: 12 // Permitir hasta 12 cuotas
      }
    };
    console.log('Preference enviada a Mercado Pago:', JSON.stringify(preference, null, 2));
    // Crear preferencia con la nueva sintaxis del SDK
    const preferenceObj = new Preference(client);
    console.log('Creando preferencia...');
    let response;
    try {
      response = await Promise.race([
        preferenceObj.create({ body: preference }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout al crear preferencia')), 15000)
        )
      ]);
    } catch (err) {
      const errorResponse = { error: 'Error al crear preferencia', log: err.message, timestamp: new Date().toISOString() };
      console.log('Enviando respuesta de error al frontend:', JSON.stringify(errorResponse, null, 2));
      res.status(500).json(errorResponse);
      return;
    }
    if (!response || !response.init_point) {
      const errorResponse = { error: 'Mercado Pago no devolvió un link de pago válido', log: 'init_point faltante', response, timestamp: new Date().toISOString() };
      console.log('Enviando respuesta de error al frontend:', JSON.stringify(errorResponse, null, 2));
      res.status(500).json(errorResponse);
      return;
    }
    const result = { 
      init_point: response.init_point,
      id: response.id
    };
    console.log('Enviando respuesta al frontend:', JSON.stringify(result, null, 2));
    res.json(result);
    console.log('=== FIN /crear-preferencia EXITOSO ===');
  } catch (error) {
    console.error('=== ERROR en /crear-preferencia ===');
    console.error('Error completo:', error);
    if (error.response && error.response.data) {
      console.error('Mercado Pago response data:', error.response.data);
    }
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    const errorResponse = {
      error: 'Error al procesar el pago',
      message: error.message,
      timestamp: new Date().toISOString(),
      mercadoPagoData: error.response && error.response.data ? error.response.data : null
    };
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error.stack;
    }
    try {
      console.log('Enviando respuesta de error al frontend:', JSON.stringify(errorResponse, null, 2));
      res.status(500).json(errorResponse);
    } catch (jsonErr) {
      console.error('Error al enviar respuesta JSON:', jsonErr);
      res.status(500).send('Error interno al procesar el pago');
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
    const transporter = nodemailer.createTransporter({
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
// Servir archivos estáticos desde la carpeta raíz del proyecto (al final)
app.use(express.static(path.join(__dirname, '..')));

console.log('Intentando iniciar backend Capri Store...');
app.listen(PORT, () => {
  console.log(`Backend escuchando en puerto ${PORT}`);
});
