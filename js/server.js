const express = require('express');
const mercadopago = require('mercadopago');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Configura tu access_token de Mercado Pago (reemplaza por el tuyo real)
mercadopago.configure({
  access_token: ''
});

app.post('https://api.capristorezte.com.ar/crear-preferencia', async (req, res) => {
  try {
    const items = req.body.items; // [{title, quantity, currency_id, unit_price}]
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No hay productos en el carrito." });
    }
    const preference = {
      items,
      back_urls: {
        success: "https://www.capristorezte.com.ar/success",
        failure: "https://www.capristorezte.com.ar/failure",
        pending: "https://www.capristorezte.com.ar/pending"
      },
      auto_return: "approved"
    };
    const response = await mercadopago.preferences.create(preference);
    res.json({ init_point: response.body.init_point });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3001, () => console.log('Backend escuchando en puerto 3001'));
