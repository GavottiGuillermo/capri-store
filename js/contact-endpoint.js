/**
 * ENDPOINT DE CONTACTO SIMPLIFICADO
 * Copia y pega este código para reemplazar el endpoint de contacto en server.js
 */

// Importar las funciones de email simplificadas
const { enviarCorreoContacto } = require('./email-utils');

// === ENDPOINT DE CONTACTO SIMPLIFICADO ===
app.post('/contact', async (req, res) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`📧 [${timestamp}] === FORMULARIO DE CONTACTO === [ID: ${requestId}]`);
  console.log('📋 Datos:', { nombre: req.body.nombre, email: req.body.email });
  
  try {
    const { nombre, email, mensaje } = req.body;
    
    // Validar datos requeridos
    if (!nombre || !email || !mensaje) {
      console.error(`❌ [${requestId}] Datos incompletos`);
      return res.status(400).json({ 
        success: false, 
        error: 'Todos los campos son requeridos',
        requestId: requestId
      });
    }
    
    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error(`❌ [${requestId}] Email inválido:`, email);
      return res.status(400).json({ 
        success: false, 
        error: 'Email inválido',
        requestId: requestId
      });
    }
    
    // Enviar correo usando función simplificada
    const resultado = await enviarCorreoContacto(nombre, email, mensaje);
    
    if (resultado.success) {
      const duration = Date.now() - startTime;
      console.log(`🎉 [${requestId}] === CONTACTO EXITOSO === (${duration}ms)`);
      
      res.json({ 
        success: true, 
        message: 'Tu consulta fue enviada correctamente. Nos pondremos en contacto contigo a la brevedad.',
        requestId: requestId,
        processingTime: `${duration}ms`
      });
    } else {
      console.error(`❌ [${requestId}] Error enviando correo:`, resultado.error);
      
      return res.status(500).json({ 
        success: false, 
        error: 'Error al enviar la consulta. Intenta nuevamente.',
        requestId: requestId,
        details: process.env.NODE_ENV === 'development' ? resultado.error : undefined
      });
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`💥 [${requestId}] === ERROR GENERAL === (${duration}ms)`);
    console.error('Error:', error.message);
    
    res.status(500).json({ 
      success: false, 
      error: 'Error al enviar el mensaje. Intenta nuevamente.',
      requestId: requestId,
      processingTime: `${duration}ms`,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});