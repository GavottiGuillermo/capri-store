const express = require('express');
const mercadopago = require('mercadopago');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { Preference } = require('mercadopago');

const app = express();
app.use(express.json());
app.use(cors({
  origin: ['https://www.capristorezte.com.ar', 'https://capristorezte.com.ar']
}));

// Configura tu access_token de Mercado Pago (reemplaza por el tuyo real)
const mp = new mercadopago.MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
});

app.post('/crear-preferencia', async (req, res) => {
  try {
    const items = req.body.items;
    console.log('Items recibidos:', items);

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No hay productos en el carrito." });
    }

    // Verifica que todos los items tengan los campos requeridos y unit_price sea número
    for (const item of items) {
      if (
        typeof item.title !== 'string' ||
        typeof item.quantity !== 'number' ||
        typeof item.currency_id !== 'string' ||
        typeof item.unit_price !== 'number'
      ) {
        return res.status(400).json({ error: "Formato de producto inválido." });
      }
    }

    const preference = {
      items,
      back_urls: {
        success: "https://www.capristorezte.com.ar/?status=approved",
        failure: "https://www.capristorezte.com.ar/?status=failure",
        pending: "https://www.capristorezte.com.ar/?status=pending"
      },
      auto_return: "approved"
    };

    console.log('Preference enviada a Mercado Pago:', JSON.stringify(preference, null, 2));

    const preferenceClient = new Preference(mp);
    const response = await preferenceClient.create(preference);
    res.json({ init_point: response.sandbox_init_point || response.init_point || response.body.init_point });
  } catch (error) {
    console.error('Error en /crear-preferencia:', error);
    res.status(500).json({ error: error.message });
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

    // Configura tu transporter de nodemailer (ejemplo con Gmail)
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Email content
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

app.listen(3001, () => console.log('Backend escuchando en puerto 3001'));
