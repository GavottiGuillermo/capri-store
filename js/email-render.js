/**
 * CONFIGURACIÓN SMTP PARA RENDER
 * Múltiples proveedores y configuraciones para evitar bloqueos
 */

const nodemailer = require('nodemailer');

// ===============================
// CONFIGURACIONES SMTP MÚLTIPLES
// ===============================
const SMTP_CONFIGS = [
  // Gmail SSL (puerto 465) - Más confiable en servicios cloud
  {
    name: 'Gmail SSL',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 5000,
    greetingTimeout: 3000,
    socketTimeout: 10000
  },
  
  // Gmail TLS (puerto 587) - Backup
  {
    name: 'Gmail TLS',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 5000,
    greetingTimeout: 3000,
    socketTimeout: 10000
  },
  
  // Outlook/Hotmail - Alternativa
  {
    name: 'Outlook',
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER_OUTLOOK || process.env.SMTP_USER,
      pass: process.env.SMTP_PASS_OUTLOOK || process.env.SMTP_PASS
    },
    connectionTimeout: 5000,
    greetingTimeout: 3000,
    socketTimeout: 10000
  }
];

// ===============================
// FUNCIÓN PARA CREAR TRANSPORTER CON FALLBACK
// ===============================
async function crearTransporterConFallback() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ Credenciales SMTP no configuradas');
    return null;
  }

  for (const config of SMTP_CONFIGS) {
    try {
      console.log(`🔄 Probando configuración: ${config.name} (${config.host}:${config.port})`);
      
      const transporter = nodemailer.createTransporter(config);
      
      // Probar conexión con timeout corto
      await Promise.race([
        transporter.verify(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout verificando ${config.name}`)), 8000)
        )
      ]);
      
      console.log(`✅ ${config.name} funcionando correctamente`);
      return { transporter, config };
      
    } catch (error) {
      console.warn(`⚠️ ${config.name} falló:`, error.message);
      continue;
    }
  }
  
  console.error('❌ Todos los proveedores SMTP fallaron');
  return null;
}

// ===============================
// ENVIAR EMAIL CON MÚLTIPLES INTENTOS
// ===============================
async function enviarEmailConFallback(mailOptions) {
  const startTime = Date.now();
  console.log('📧 === INICIANDO ENVÍO CON FALLBACK ===');
  
  try {
    const transporterInfo = await crearTransporterConFallback();
    
    if (!transporterInfo) {
      throw new Error('No hay transporters SMTP disponibles');
    }
    
    const { transporter, config } = transporterInfo;
    
    console.log(`📤 Enviando email usando: ${config.name}`);
    console.log('📧 Destinatario:', mailOptions.to);
    console.log('📋 Asunto:', mailOptions.subject);
    
    // Enviar con timeout
    const info = await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout enviando email')), 30000)
      )
    ]);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Email enviado exitosamente en ${duration}ms`);
    console.log('📨 Message ID:', info.messageId);
    console.log('📤 Proveedor usado:', config.name);
    
    return { 
      success: true, 
      messageId: info.messageId, 
      provider: config.name,
      duration: `${duration}ms` 
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Error enviando email (${duration}ms):`, error.message);
    
    return { 
      success: false, 
      error: error.message, 
      duration: `${duration}ms` 
    };
  }
}

// ===============================
// FUNCIÓN ESPECÍFICA PARA CONTACTO
// ===============================
async function enviarCorreoContactoRender(nombre, email, mensaje) {
  try {
    // Validar datos
    if (!nombre || !email || !mensaje) {
      throw new Error('Datos incompletos');
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Email inválido');
    }

    // Obtener emails de administradores
    const adminEmails = process.env.ADMIN_EMAILS;
    if (!adminEmails) {
      throw new Error('ADMIN_EMAILS no configurado');
    }

    const adminEmailList = adminEmails.split(',').map(e => e.trim());
    
    // Preparar email
    const mailOptions = {
      from: {
        name: 'Capri Store',
        address: process.env.SMTP_FROM || process.env.SMTP_USER
      },
      to: adminEmailList,
      subject: `Nueva consulta de ${nombre} - Capri Store`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #6b0a0a;">Nueva consulta - Capri Store</h2>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">👤 Datos del contacto:</h3>
            <p><strong>Nombre:</strong> ${nombre}</p>
            <p><strong>Email:</strong> ${email}</p>
          </div>
          
          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #e29ca3;">
            <h3 style="color: #6b0a0a; margin-top: 0;">💬 Mensaje:</h3>
            <p style="line-height: 1.6; white-space: pre-wrap;">${mensaje}</p>
          </div>
          
          <div style="background: #e8f5f8; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #0c5460;">
              <strong>📅 Fecha:</strong> ${new Date().toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
          
          <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
            <p>Responde directamente a este email para contactar al cliente.</p>
            <p>© Capri Store - Sistema Automático</p>
          </div>
        </div>
      `,
      text: `Nueva consulta de ${nombre}

Email: ${email}
Mensaje: ${mensaje}

Fecha: ${new Date().toLocaleString('es-AR')}

Responde directamente a este email para contactar al cliente.
- Capri Store`
    };

    // Enviar usando fallback
    return await enviarEmailConFallback(mailOptions);
    
  } catch (error) {
    console.error('❌ Error en enviarCorreoContactoRender:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  crearTransporterConFallback,
  enviarEmailConFallback,
  enviarCorreoContactoRender,
  SMTP_CONFIGS
};