/**
 * FUNCIONES DE EMAIL SIMPLIFICADAS PARA CAPRI STORE
 * Basadas en el servidor antiguo que funcionaba correctamente
 */

const nodemailer = require('nodemailer');

// ===============================
// CONFIGURAR TRANSPORTER
// ===============================
function crearTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ Configuración de email incompleta');
    return null;
  }

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT) || 587;
  const smtpSecure = process.env.SMTP_SECURE === 'true';

  console.log('📧 Configurando transporter simplificado:', {
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    user: process.env.SMTP_USER?.substring(0, 10) + '***'
  });

  return nodemailer.createTransporter({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    requireTLS: !smtpSecure, // Solo requerir TLS si no es secure
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 10000, // 10 segundos
    greetingTimeout: 5000,     // 5 segundos
    socketTimeout: 15000       // 15 segundos
  });
}

// ===============================
// ENVIAR CORREO DE CONFIRMACIÓN (COMPRA)
// ===============================
async function enviarCorreoConfirmacion(datosComprador, productos, total, numeroPedido) {
  const startTime = Date.now();
  console.log('📧 === INICIANDO ENVÍO DE CORREO DE CONFIRMACIÓN ===');
  
  try {
    // Crear transporter local
    const transporter = crearTransporter();
    if (!transporter) {
      throw new Error('Transporter no configurado');
    }

    // Validar datos de entrada
    if (!datosComprador || !datosComprador.email || !datosComprador.nombre) {
      throw new Error('Datos del comprador incompletos');
    }

    // Verificar conexión SMTP
    await transporter.verify();
    console.log('✅ Conexión SMTP verificada');

    // Crear resumen de productos
    let resumenProductos = '';
    let subtotal = 0;
    
    if (productos && Array.isArray(productos)) {
      productos.forEach((producto, index) => {
        const totalProducto = producto.cantidad * producto.precio;
        subtotal += totalProducto;
        resumenProductos += `${index + 1}. ${producto.nombre}`;
        if (producto.talle) {
          resumenProductos += ` (Talle: ${producto.talle})`;
        }
        resumenProductos += `\n   Cantidad: ${producto.cantidad} x $${producto.precio.toFixed(2)} = $${totalProducto.toFixed(2)}\n`;
      });
    }

    // Tipo de entrega
    const tipoEntrega = datosComprador.tipoEntrega || 'retiro';
    let mensajeEntrega = '';
    if (tipoEntrega === 'envio') {
      mensajeEntrega = 'Nos comunicaremos contigo para coordinar el envío a tu domicilio.';
    } else {
      mensajeEntrega = 'Podes retirarlo por Justa Lima 123, Zárate.';
    }

    // Crear contenido del email
    const nombreCompleto = [datosComprador.nombre, datosComprador.apellido]
      .filter(Boolean)
      .join(' ')
      .trim() || datosComprador.nombre;

    const emailText = `¡Hola ${nombreCompleto}!

Gracias por tu compra en Capri Store. Tu pedido ha sido confirmado exitosamente.

🛍️ RESUMEN DE TU COMPRA:
${resumenProductos}
-----------------------------------
Subtotal: $${subtotal.toFixed(2)}
${subtotal !== parseFloat(total) ? `Envío: $${(parseFloat(total) - subtotal).toFixed(2)}\n` : ''}Total: $${parseFloat(total).toFixed(2)}

📋 NÚMERO DE PEDIDO: ${numeroPedido}

📍 ENTREGA:
${mensajeEntrega}

📞 CONTACTO:
Si tenes alguna consulta, no dudes en contactarnos.

¡Gracias por elegirnos!

Capri Store
Justa Lima 123, Zárate`;

    const mailOptions = {
      from: `"Capri Store" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: datosComprador.email,
      subject: `Confirmación de compra #${numeroPedido} - Capri Store`,
      text: emailText
    };

    // Enviar el correo
    const info = await transporter.sendMail(mailOptions);
    
    const duration = Date.now() - startTime;
    console.log('🎉 === EMAIL DE CONFIRMACIÓN ENVIADO ===');
    console.log('⏱️ Tiempo:', duration + 'ms');
    console.log('📧 Message ID:', info.messageId);
    
    return { success: true, messageId: info.messageId, duration: duration + 'ms' };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('💥 === ERROR EN EMAIL DE CONFIRMACIÓN ===');
    console.error('⏱️ Tiempo hasta error:', duration + 'ms');
    console.error('Error:', error.message);
    
    return { success: false, error: error.message, duration: duration + 'ms' };
  }
}

// ===============================
// ENVIAR CORREO DE CONTACTO
// ===============================
async function enviarCorreoContacto(nombre, email, mensaje) {
  const startTime = Date.now();
  console.log('📧 === INICIANDO ENVÍO DE CORREO DE CONTACTO ===');
  
  try {
    // Crear transporter local
    const transporter = crearTransporter();
    if (!transporter) {
      throw new Error('Transporter no configurado');
    }

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

    // Email para administradores
    const emailParaAdmins = {
      from: `"Capri Store" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: adminEmailList,
      subject: `Nueva consulta de ${nombre} - Capri Store`,
      text: `Nueva consulta recibida desde el sitio web:

👤 DATOS DEL CONTACTO:
Nombre: ${nombre}
Email: ${email}

💬 MENSAJE:
"${mensaje}"

📅 Fecha: ${new Date().toLocaleString('es-AR', { 
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: 'long', 
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})}

---
Responde directamente a este email para contactar al cliente.

Capri Store - Sistema Automático`
    };

    // Enviar email
    const info = await transporter.sendMail(emailParaAdmins);
    
    const duration = Date.now() - startTime;
    console.log('🎉 === EMAIL DE CONTACTO ENVIADO ===');
    console.log('⏱️ Tiempo:', duration + 'ms');
    console.log('📧 Message ID:', info.messageId);
    
    return { success: true, messageId: info.messageId, duration: duration + 'ms' };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('💥 === ERROR EN EMAIL DE CONTACTO ===');
    console.error('⏱️ Tiempo hasta error:', duration + 'ms');
    console.error('Error:', error.message);
    
    return { success: false, error: error.message, duration: duration + 'ms' };
  }
}

module.exports = {
  crearTransporter,
  enviarCorreoConfirmacion,
  enviarCorreoContacto
};