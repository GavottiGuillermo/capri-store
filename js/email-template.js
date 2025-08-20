// Nueva función mejorada para envío de correos con template HTML elegante
const nodemailer = require('nodemailer');

async function enviarCorreoConfirmacion(datosComprador, productos, total, numeroPedido) {
  const startTime = Date.now();
  console.log('📧 === INICIANDO ENVÍO DE CORREO ===');
  console.log('⏰ Timestamp:', new Date().toISOString());
  
  try {
    // Verificar credenciales
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('❌ Credenciales de email no configuradas');
      throw new Error('Credenciales de email no configuradas');
    }

    // Validar datos de entrada
    if (!datosComprador || !datosComprador.email || !datosComprador.nombre) {
      throw new Error('Datos del comprador incompletos para envío de correo');
    }

    // Configurar transporter con Gmail SMTP
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 15000
    });

    // Verificar conexión SMTP
    console.log('🔍 Verificando conexión SMTP...');
    await transporter.verify();
    console.log('✅ Conexión SMTP verificada exitosamente');

    // Crear resumen de productos para HTML
    let productosHtml = '';
    let subtotal = 0;
    
    if (!productos || !Array.isArray(productos)) {
      throw new Error('Lista de productos no válida');
    }
    
    productos.forEach((producto, index) => {
      const totalProducto = producto.cantidad * producto.precio;
      subtotal += totalProducto;
      const talleInfo = producto.talle ? ` - Talle: ${producto.talle}` : '';
      
      productosHtml += `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eee; color: #333;">
            <strong>${producto.nombre}</strong>${talleInfo}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center; color: #333;">
            ${producto.cantidad}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right; color: #333;">
            $${producto.precio.toFixed(2)}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold; color: #6b0a0a;">
            $${totalProducto.toFixed(2)}
          </td>
        </tr>`;
    });

    // Extraer últimos 2 dígitos del número de pedido para mostrar prominentemente
    const numeroCorto = numeroPedido.slice(-2);
    
    // Determinar tipo de entrega
    const tipoEntrega = datosComprador.tipoEntrega || 'retiro';
    let mensajeEntrega = '';
    let iconoEntrega = '';
    
    if (tipoEntrega === 'envio') {
      mensajeEntrega = 'Nos comunicaremos contigo para coordinar el envío a tu domicilio.';
      iconoEntrega = '🚚';
    } else {
      mensajeEntrega = 'Podés retirarlo en nuestro local en Justa Lima 123, Zárate.';
      iconoEntrega = '🏪';
    }

    const nombreCompleto = [datosComprador.nombre, datosComprador.apellido]
      .filter(Boolean)
      .join(' ')
      .trim() || datosComprador.nombre;

    // Crear email HTML elegante con colores de Capri
    const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Confirmación de Compra - Capri Store</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f8f9fa;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #6b0a0a 0%, #8b1538 100%); color: white; padding: 30px 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">
            ✨ CAPRI STORE ✨
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">
            Confirmación de Compra
          </p>
        </div>

        <!-- Contenido Principal -->
        <div style="padding: 30px 20px;">
          
          <!-- Saludo -->
          <div style="margin-bottom: 25px;">
            <h2 style="color: #6b0a0a; font-size: 24px; margin: 0 0 10px 0;">
              ¡Hola ${nombreCompleto}! 👋
            </h2>
            <p style="color: #666; font-size: 16px; line-height: 1.5; margin: 0;">
              Gracias por tu compra en <strong style="color: #6b0a0a;">Capri Store</strong>. 
              Tu pedido ha sido confirmado exitosamente y está siendo procesado.
            </p>
          </div>

          <!-- Número de Pedido Destacado -->
          <div style="background: linear-gradient(135deg, #e29ca3 0%, #f5c6cb 100%); 
                      border-radius: 15px; padding: 20px; margin: 25px 0; text-align: center; 
                      border: 2px solid #6b0a0a;">
            <h3 style="color: #6b0a0a; margin: 0 0 10px 0; font-size: 18px;">
              📋 Número de Pedido
            </h3>
            <div style="font-size: 36px; font-weight: bold; color: #6b0a0a; 
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.1); margin: 5px 0;">
              ${numeroCorto}
            </div>
            <p style="color: #8b1538; font-size: 14px; margin: 5px 0 0 0;">
              (Pedido completo: ${numeroPedido})
            </p>
          </div>

          <!-- Resumen de Compra -->
          <div style="margin: 25px 0;">
            <h3 style="color: #6b0a0a; font-size: 20px; margin: 0 0 15px 0; 
                       border-bottom: 2px solid #e29ca3; padding-bottom: 10px;">
              🛍️ Resumen de tu Compra
            </h3>
            
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
              <thead>
                <tr style="background-color: #f8f9fa;">
                  <th style="padding: 15px 12px; text-align: left; color: #6b0a0a; 
                             border-bottom: 2px solid #e29ca3;">Producto</th>
                  <th style="padding: 15px 12px; text-align: center; color: #6b0a0a; 
                             border-bottom: 2px solid #e29ca3;">Cant.</th>
                  <th style="padding: 15px 12px; text-align: right; color: #6b0a0a; 
                             border-bottom: 2px solid #e29ca3;">Precio</th>
                  <th style="padding: 15px 12px; text-align: right; color: #6b0a0a; 
                             border-bottom: 2px solid #e29ca3;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${productosHtml}
              </tbody>
            </table>

            <!-- Totales -->
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 10px; margin-top: 15px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="color: #666; font-size: 16px; padding: 5px 0;">Subtotal:</td>
                  <td style="color: #333; font-size: 16px; font-weight: bold; text-align: right; padding: 5px 0;">$${subtotal.toFixed(2)}</td>
                </tr>
                ${subtotal !== parseFloat(total) ? `
                <tr>
                  <td style="color: #666; font-size: 16px; padding: 5px 0;">Envío:</td>
                  <td style="color: #333; font-size: 16px; text-align: right; padding: 5px 0;">$${(parseFloat(total) - subtotal).toFixed(2)}</td>
                </tr>` : ''}
                <tr style="border-top: 2px solid #e29ca3;">
                  <td style="color: #6b0a0a; font-size: 20px; font-weight: bold; padding: 15px 0 5px 0;">TOTAL:</td>
                  <td style="color: #6b0a0a; font-size: 20px; font-weight: bold; text-align: right; padding: 15px 0 5px 0;">$${parseFloat(total).toFixed(2)}</td>
                </tr>
              </table>
            </div>
          </div>

          <!-- Información de Entrega -->
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 10px; 
                      padding: 20px; margin: 25px 0;">
            <h3 style="color: #6b0a0a; margin: 0 0 10px 0; font-size: 18px;">
              ${iconoEntrega} Información de Entrega
            </h3>
            <p style="color: #856404; margin: 0; font-size: 16px; line-height: 1.5;">
              ${mensajeEntrega}
            </p>
          </div>

          <!-- Información de Contacto -->
          <div style="background-color: #e3f2fd; border: 1px solid #90caf9; border-radius: 10px; 
                      padding: 20px; margin: 25px 0;">
            <h3 style="color: #6b0a0a; margin: 0 0 15px 0; font-size: 18px;">
              📞 ¿Tenés alguna consulta?
            </h3>
            <div style="color: #1565c0; font-size: 15px; line-height: 1.6;">
              <p style="margin: 8px 0;">
                <strong>📱 WhatsApp:</strong> 
                <a href="https://wa.me/5491112345678" style="color: #25d366; text-decoration: none; font-weight: bold;">
                  +54 9 11 1234 5678
                </a>
              </p>
              <p style="margin: 8px 0;">
                <strong>📧 Email:</strong> 
                <a href="mailto:contacto@capristorezte.com.ar" style="color: #6b0a0a; text-decoration: none;">
                  contacto@capristorezte.com.ar
                </a>
              </p>
              <p style="margin: 8px 0;">
                <strong>📍 Dirección:</strong> Justa Lima 123, Zárate, Buenos Aires
              </p>
              <p style="margin: 8px 0;">
                <strong>📸 Instagram:</strong> 
                <a href="https://www.instagram.com/capri.store" style="color: #e1306c; text-decoration: none; font-weight: bold;">
                  @capri.store
                </a>
              </p>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div style="background-color: #6b0a0a; color: white; padding: 25px 20px; text-align: center;">
          <p style="margin: 0 0 10px 0; font-size: 18px; font-weight: bold;">
            ¡Gracias por elegirnos! 💖
          </p>
          <p style="margin: 0; font-size: 14px; opacity: 0.9;">
            <strong>Capri Store</strong> - Tu tienda de moda favorita<br>
            Justa Lima 123, Zárate • Buenos Aires, Argentina
          </p>
        </div>
        
      </div>
    </body>
    </html>`;

    // Versión texto plano como fallback
    const emailText = `¡Hola ${nombreCompleto}!

Gracias por tu compra en Capri Store. Tu pedido ha sido confirmado exitosamente.

NÚMERO DE PEDIDO: ${numeroCorto} (Completo: ${numeroPedido})

RESUMEN DE TU COMPRA:
${productos.map((p, i) => `${i+1}. ${p.nombre}${p.talle ? ` (Talle: ${p.talle})` : ''}\n   Cantidad: ${p.cantidad} x $${p.precio.toFixed(2)} = $${(p.cantidad * p.precio).toFixed(2)}`).join('\n')}

Subtotal: $${subtotal.toFixed(2)}
${subtotal !== parseFloat(total) ? `Envío: $${(parseFloat(total) - subtotal).toFixed(2)}\n` : ''}Total: $${parseFloat(total).toFixed(2)}

ENTREGA:
${mensajeEntrega}

CONTACTO:
- WhatsApp: +54 9 11 1234 5678
- Email: contacto@capristorezte.com.ar
- Dirección: Justa Lima 123, Zárate
- Instagram: @capri.store

¡Gracias por elegirnos!

Capri Store`;

    const mailOptions = {
      from: `"Capri Store 💖" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: datosComprador.email,
      subject: `✨ Confirmación de Compra #${numeroCorto} - Capri Store`,
      text: emailText,
      html: emailHtml
    };

    // Enviar el correo
    console.log('🚀 === ENVIANDO EMAIL ===');
    const info = await transporter.sendMail(mailOptions);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('🎉 === EMAIL ENVIADO EXITOSAMENTE ===');
    console.log('⏱️ Tiempo de envío:', duration + 'ms');
    console.log('📧 Message ID:', info.messageId);
    console.log('✅ Email enviado a:', datosComprador.email);
    console.log('🏷️ Número de pedido mostrado:', numeroCorto);
    
    return { 
      success: true, 
      messageId: info.messageId,
      duration: duration + 'ms',
      numeroMostrado: numeroCorto
    };
    
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.error('💥 === ERROR AL ENVIAR CORREO ===');
    console.error('⏱️ Tiempo hasta error:', duration + 'ms');
    console.error('Error mensaje:', error.message);
    
    return { 
      success: false, 
      error: error.message,
      duration: duration + 'ms'
    };
  }
}

module.exports = { enviarCorreoConfirmacion };
