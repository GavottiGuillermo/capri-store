const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// ===============================
// CONFIGURACIÓN DE MERCADO PAGO
// ===============================
if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
  console.error('❌ MERCADOPAGO_ACCESS_TOKEN no configurado - MercadoPago no estará disponible');
  // No terminar el proceso, solo deshabilitar MercadoPago
} else if (!process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('TEST-') &&
    !process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('APP_USR-')) {
  console.warn('⚠️ Formato de token MercadoPago no reconocido');
}

const client = process.env.MERCADOPAGO_ACCESS_TOKEN ?
  new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN }) :
  null;

module.exports = {
  client,
  Preference,
  Payment
};
