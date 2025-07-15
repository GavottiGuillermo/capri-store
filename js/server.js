const express = require('express');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
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

// Servir archivos estáticos desde la carpeta raíz del proyecto
app.use(express.static(path.join(__dirname, '..')));

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
    if (!Array.isArray(items) || items.length === 0) {
      console.log('Error: Items no válidos');
      res.status(400).json({ error: "No hay productos en el carrito.", log: 'Items no válidos', timestamp: new Date().toISOString() });
      return;
    }
    let formatoInvalido = false;
    for (const item of items) {
      console.log('Validando item:', item);
      if (
        typeof item.title !== 'string' ||
        typeof item.quantity !== 'number' ||
        typeof item.currency_id !== 'string' ||
        typeof item.unit_price !== 'number'
      ) {
        formatoInvalido = true;
        break;
      }
    }
    if (formatoInvalido) {
      console.log('Error: Formato de producto inválido');
      res.status(400).json({ error: "Formato de producto inválido.", log: 'Formato inválido', timestamp: new Date().toISOString() });
      return;
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
      console.error('Error al crear preferencia:', err);
      res.status(500).json({ error: 'Error al crear preferencia', log: err.message, timestamp: new Date().toISOString() });
      return;
    }
    if (!response || !response.init_point) {
      console.error('Error: No se recibió init_point en la respuesta');
      console.log('Respuesta completa de Mercado Pago:', JSON.stringify(response, null, 2));
      res.status(500).json({ error: 'Mercado Pago no devolvió un link de pago válido', log: 'init_point faltante', response, timestamp: new Date().toISOString() });
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

    // Respuesta de error más específica
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
      return res.status(400).json({ success: false, error: "Faltan datos." });
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

    res.json({ success: true, numeroPedido });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
console.log('Intentando iniciar backend Capri Store...');
app.listen(PORT, () => {
  console.log(`Backend escuchando en puerto ${PORT}`);
});
