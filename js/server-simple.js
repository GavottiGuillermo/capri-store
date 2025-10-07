const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 SERVIDOR SIMPLE INICIANDO...');
console.log('🔧 NODE_ENV:', process.env.NODE_ENV);
console.log('🔧 PORT:', PORT);

// CORS permisivo
app.use(cors());

// Middleware básico
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Endpoints básicos
app.get('/', (req, res) => {
  res.send('✅ Servidor funcionando correctamente!');
});

app.get('/test', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Servidor funcionando',
    timestamp: new Date().toISOString(),
    port: PORT,
    env: process.env.NODE_ENV
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    env_vars: {
      admin_whatsapp: !!process.env.ADMIN_WHATSAPP,
      admin_instagram: !!process.env.ADMIN_INSTAGRAM,
      admin_email: !!process.env.ADMIN_EMAIL
    }
  });
});

app.get('/contact-info', (req, res) => {
  res.json({
    whatsapp: process.env.ADMIN_WHATSAPP,
    instagram: process.env.ADMIN_INSTAGRAM,
    email: process.env.ADMIN_EMAIL,
    business_name: 'Capri Store',
    server: 'SIMPLE'
  });
});

// Catch all para debugging
app.use('*', (req, res) => {
  console.log('❌ Ruta no encontrada:', req.method, req.originalUrl);
  res.status(404).json({
    error: 'Ruta no encontrada',
    method: req.method,
    path: req.originalUrl,
    available_routes: ['/', '/test', '/health', '/contact-info']
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ SERVIDOR SIMPLE funcionando en puerto ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log('📋 Rutas disponibles:');
  console.log('   - GET /');
  console.log('   - GET /test');
  console.log('   - GET /health');
  console.log('   - GET /contact-info');
});