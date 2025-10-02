/**
 * ENDPOINT DE CONTACTO OPTIMIZADO PARA RENDER
 * Reemplaza el endpoint actual en server.js
 */

// Importar función optimizada para Render
const { enviarCorreoContactoRender } = require('./email-render');

// === ENDPOINT DE CONTACTO PARA RENDER ===
app.post('/contact', async (req, res) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`📧 [${timestamp}] CONTACTO RECIBIDO [${requestId}]`);
  console.log('📋 Datos:', { 
    nombre: req.body.nombre, 
    email: req.body.email, 
    mensaje: req.body.mensaje?.substring(0, 50) + '...' 
  });
  
  try {
    const { nombre, email, mensaje } = req.body;
    
    // Validación rápida
    if (!nombre?.trim() || !email?.trim() || !mensaje?.trim()) {
      console.error(`❌ [${requestId}] Datos incompletos`);
      return res.status(400).json({ 
        success: false, 
        error: 'Todos los campos son requeridos'
      });
    }
    
    // Validar email básico
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error(`❌ [${requestId}] Email inválido`);
      return res.status(400).json({ 
        success: false, 
        error: 'Email inválido'
      });
    }
    
    console.log(`🚀 [${requestId}] Enviando correo...`);
    
    // Enviar correo con sistema de fallback
    const resultado = await enviarCorreoContactoRender(
      nombre.trim(), 
      email.trim(), 
      mensaje.trim()
    );
    
    const duration = Date.now() - startTime;
    
    if (resultado.success) {
      console.log(`✅ [${requestId}] Correo enviado exitosamente (${duration}ms)`);
      console.log(`📤 Proveedor usado: ${resultado.provider || 'N/A'}`);
      
      res.json({ 
        success: true, 
        message: 'Tu consulta fue enviada correctamente. Nos pondremos en contacto contigo a la brevedad.',
        requestId: requestId,
        processingTime: `${duration}ms`,
        provider: resultado.provider
      });
      
    } else {
      console.error(`❌ [${requestId}] Error enviando correo: ${resultado.error}`);
      
      // Si es error de timeout/conexión, dar respuesta más específica
      let errorMessage = 'Error temporal enviando el mensaje. Intenta nuevamente en unos minutos.';
      let statusCode = 503; // Service Temporarily Unavailable
      
      if (resultado.error.includes('timeout') || resultado.error.includes('ETIMEDOUT')) {
        errorMessage = 'Error de conexión temporal. Por favor intenta nuevamente o contáctanos por WhatsApp.';
      } else if (resultado.error.includes('authentication') || resultado.error.includes('535')) {
        errorMessage = 'Error de configuración del servidor. Contáctanos directamente por WhatsApp.';
        statusCode = 500;
      }
      
      return res.status(statusCode).json({ 
        success: false, 
        error: errorMessage,
        requestId: requestId,
        note: 'Para consultas urgentes: WhatsApp +54 9 3487 123456',
        processingTime: `${duration}ms`
      });
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`💥 [${requestId}] Error crítico (${duration}ms):`, error.message);
    
    res.status(500).json({ 
      success: false, 
      error: 'Error del servidor. Contáctanos directamente por WhatsApp.',
      requestId: requestId,
      note: 'WhatsApp: +54 9 3487 123456',
      processingTime: `${duration}ms`
    });
  }
});

// === ENDPOINT DE PRUEBA SMTP ===
app.get('/test-smtp-render', async (req, res) => {
  const { crearTransporterConFallback } = require('./email-render');
  
  console.log('🧪 Probando configuraciones SMTP...');
  
  try {
    const transporterInfo = await crearTransporterConFallback();
    
    if (transporterInfo) {
      res.json({
        success: true,
        message: 'SMTP funcionando correctamente',
        provider: transporterInfo.config.name,
        config: {
          host: transporterInfo.config.host,
          port: transporterInfo.config.port,
          secure: transporterInfo.config.secure
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Todos los proveedores SMTP fallaron',
        providers_tested: ['Gmail SSL', 'Gmail TLS', 'Outlook']
      });
    }
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});