const express = require('express');
const mercadopago = require('mercadopago');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Configura tu access_token de Mercado Pago (reemplaza por el tuyo real)
mercadopago.configure({
  access_token: 'TU_ACCESS_TOKEN'
});

app.post('/crear-preferencia', async (req, res) => {
  try {
    const items = req.body.items; // [{title, quantity, currency_id, unit_price}]
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No hay productos en el carrito." });
    }
    const preference = {
      items,
      back_urls: {
        success: "http://localhost:3000/success",
        failure: "http://localhost:3000/failure",
        pending: "http://localhost:3000/pending"
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