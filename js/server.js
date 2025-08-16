const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env en la carpeta padre
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();

// SIEMPRE PRIMERO
app.use(express.json());

// Middleware de logs simplificado
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Manejo global de errores no capturados
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Middleware
app.use(cors({
  origin: [
    'https://www.capristorezte.com.ar',
    'https://capristorezte.com.ar',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://localhost:3001',
    'http://127.0.0.1:5500'
  ]
}));




// Configura Mercado Pago
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN_TEST;

// Configuración de la base de datos PostgreSQL con variables de entorno
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Verificar conexión a la base de datos al iniciar
async function verificarConexionBD() {
  try {
    const client = await pool.connect();
    console.log('✅ Conexión exitosa a PostgreSQL (Neon)');
    await client.query('SELECT NOW()');
    console.log('✅ Stored procedure sp_crear_pedido_web disponible en BD');
    client.release();
  } catch (error) {
    console.error('❌ Error al conectar con PostgreSQL:', error.message);
    if (process.env.NODE_ENV === 'development') {
      console.log('⚠️ Modo desarrollo: Continuando sin base de datos...');
    }
  }
}

// Verificar conexión al iniciar el servidor
verificarConexionBD();

const client = new MercadoPagoConfig({
  accessToken: accessToken,
  options: {
    timeout: 10000,
    idempotencyKey: 'capri-store-' + Date.now()
  }
});

app.post('/crear-preferencia', async (req, res) => {
  console.log('=== INICIO /crear-preferencia ===');
  console.log('Request body (raw):', JSON.stringify(req.body, null, 2));
  
  try {
    const items = req.body.items;
    const datosCompradorMeta = req.body.datosComprador || null;
    
    console.log('Items recibidos:', JSON.stringify(items, null, 2));
    console.log('Datos comprador:', JSON.stringify(datosCompradorMeta, null, 2));
    
    // Validación de items
    if (!Array.isArray(items) || items.length === 0) {
      const errorResponse = { 
        error: "No hay productos en el carrito.", 
        log: 'Items no válidos', 
        timestamp: new Date().toISOString() 
      };
      res.status(400).json(errorResponse);
      return;
    }
    
    // Validar cada item
    for (const [i, item] of items.entries()) {
      if (
        !item ||
        typeof item.title !== 'string' || !item.title.trim() ||
        typeof item.quantity !== 'number' || item.quantity < 1 ||
        typeof item.currency_id !== 'string' || item.currency_id !== 'ARS' ||
        typeof item.unit_price !== 'number' || isNaN(item.unit_price) || item.unit_price < 0
      ) {
        const errorResponse = {
          error: `Formato de producto inválido en el item #${i + 1}`,
          log: `Item inválido: ${JSON.stringify(item)}`,
          timestamp: new Date().toISOString()
        };
        res.status(400).json(errorResponse);
        return;
      }
    }
    
    // Determinar URL base según el entorno
    const isProduction = process.env.NODE_ENV === 'production';
    const baseUrl = isProduction
      ? 'https://www.capristorezte.com.ar'
      : 'http://localhost:3001';
    
    const preference = {
      items: items.map(item => ({
        title: item.title,
        quantity: item.quantity,
        currency_id: item.currency_id,
        unit_price: item.unit_price
      })),
      metadata: {
        itemsSimple: items.map(i => ({ 
          title: i.title, 
          quantity: i.quantity, 
          unit_price: i.unit_price 
        })),
        datosComprador: datosCompradorMeta || null
      },
      back_urls: {
        success: `${baseUrl}/success.html?status=approved`,
        failure: `${baseUrl}/failure.html?status=failure`,
        pending: `${baseUrl}/pending.html?status=pending`
      },
      site_id: "MLA",
      purpose: "wallet_purchase",
      ...(isProduction ? { auto_return: "approved" } : {}),
      binary_mode: false,
      statement_descriptor: "CAPRI STORE",
      marketplace: "NONE",
      marketplace_fee: 0,
      external_reference: "capri-" + Date.now(),
      expires: false,
      payer: {
        name: "Cliente",
        surname: "Capri Store"
      },
      additional_info: {
        items: items.map(item => ({
          id: item.id || "ITEM-" + Date.now(),
          title: item.title,
          description: item.title,
          picture_url: item.picture_url || "",
          category_id: "fashion",
          quantity: item.quantity,
          unit_price: item.unit_price
        })),
        payer: {
          first_name: "Cliente",
          last_name: "Capri Store"
        },
        shipments: {
          receiver_address: {
            zip_code: "2800",
            state_name: "Buenos Aires",
            city_name: "Zárate",
            street_name: "Justa Lima 123"
          }
        }
      },
      payment_methods: {
        excluded_payment_types: [],
        installments: 12
      },
      ...(isProduction ? { notification_url: `${baseUrl}/webhook` } : {})
    };
    
    console.log('Preference enviada a Mercado Pago:', JSON.stringify(preference, null, 2));
    console.log('🔍 Configuración específica:');
    console.log('- Entorno:', isProduction ? 'PRODUCCIÓN' : 'DESARROLLO');
    console.log('- Base URL:', baseUrl);
    console.log('- Auto return:', preference.auto_return || 'NO CONFIGURADO');
    console.log('- Binary mode:', preference.binary_mode);
    console.log('- Notification URL:', preference.notification_url || 'NO CONFIGURADO');
    
    // Crear preferencia
    const preferenceObj = new Preference(client);
    console.log('Creando preferencia...');
    
    let response;
    try {
      response = await Promise.race([
        preferenceObj.create({ body: preference }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout al crear preferencia después de 15 segundos')), 15000)
        )
      ]);
      console.log('Respuesta de MercadoPago recibida:', JSON.stringify(response, null, 2));
    } catch (err) {
      console.error('=== ERROR DETALLADO AL CREAR PREFERENCIA ===');
      console.error('Error message:', err.message);
      console.error('Error stack:', err.stack);
      
      if (err.response) {
        console.error('HTTP Status:', err.response.status);
        console.error('Response data:', err.response.data);
      }
      
      const errorResponse = { 
        error: 'Error al crear preferencia', 
        log: err.message, 
        details: err.response?.data || 'Sin detalles adicionales',
        timestamp: new Date().toISOString() 
      };
      res.status(500).json(errorResponse);
      return;
    }
    
    if (!response || !response.init_point) {
      const errorResponse = { 
        error: 'Mercado Pago no devolvió un link de pago válido', 
        log: 'init_point faltante', 
        response, 
        timestamp: new Date().toISOString() 
      };
      res.status(500).json(errorResponse);
      return;
    }
    
    const result = { 
      init_point: response.init_point,
      id: response.id
    };
    
    res.json(result);
    console.log('Enviando respuesta al frontend:', JSON.stringify(result, null, 2));
    console.log('=== FIN /crear-preferencia EXITOSO ===');
    
  } catch (error) {
    console.error('=== ERROR en /crear-preferencia ===');
    console.error('Error completo:', error);
    
    const errorResponse = {
      error: 'Error al procesar el pago',
      message: error.message,
      timestamp: new Date().toISOString()
    };
    
    res.status(500).json(errorResponse);
    console.log('=== FIN /crear-preferencia CON ERROR ===');
  }
});

// Función para enviar correo de confirmación
async function enviarCorreoConfirmacion(datosComprador, productos, total, numeroPedido) {
  const startTime = Date.now();
  console.log('📧 === INICIANDO ENVÍO DE CORREO ===');
  console.log('⏰ Timestamp:', new Date().toISOString());
  
  try {
    // Verificar credenciales
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ Credenciales de email no configuradas');
      throw new Error('Credenciales de email no configuradas');
    }

    // Validar datos de entrada
    if (!datosComprador || !datosComprador.email || !datosComprador.nombre) {
      throw new Error('Datos del comprador incompletos para envío de correo');
    }

    // Configurar transporter
    const transporter = nodemailer.createTransporter({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Verificar conexión SMTP
    await transporter.verify();
    console.log('✅ Conexión SMTP verificada exitosamente');

    // Crear resumen de productos
    let resumenProductos = '';
    let subtotal = 0;
    
    if (!productos || !Array.isArray(productos)) {
      throw new Error('Lista de productos no válida');
    }
    
    productos.forEach((producto, index) => {
      const totalProducto = producto.cantidad * producto.precio;
      subtotal += totalProducto;
      resumenProductos += `${index + 1}. ${producto.nombre}`;
      if (producto.talle) {
        resumenProductos += ` (Talle: ${producto.talle})`;
      }
      resumenProductos += `\n   Cantidad: ${producto.cantidad} x $${producto.precio.toFixed(2)} = $${totalProducto.toFixed(2)}\n`;
    });

    // Determinar tipo de entrega
    const tipoEntrega = datosComprador.tipoEntrega || 'retiro';
    let mensajeEntrega = '';
    if (tipoEntrega === 'envio') {
      mensajeEntrega = 'Nos comunicaremos contigo para coordinar el envío a tu domicilio.';
    } else {
      mensajeEntrega = 'Podes retirarlo por Justa Lima 123, Zárate.';
    }

    // Crear contenido del email
    const nombreCompletoSaludo = [datosComprador.nombre, datosComprador.apellido]
      .filter(Boolean)
      .join(' ')
      .trim() || datosComprador.nombre;

    const emailText = `¡Hola ${nombreCompletoSaludo}!

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
      from: `"Capri Store" <${process.env.EMAIL_USER}>`,
      to: datosComprador.email,
      subject: `Confirmación de compra #${numeroPedido} - Capri Store`,
      text: emailText
    };

    // Enviar el correo con timeout
    console.log('🚀 === ENVIANDO EMAIL ===');
    const emailPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout al enviar email después de 30 segundos')), 30000)
    );

    const info = await Promise.race([emailPromise, timeoutPromise]);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('🎉 === EMAIL ENVIADO EXITOSAMENTE ===');
    console.log('⏱️ Tiempo de envío:', duration + 'ms');
    console.log('📧 Message ID:', info.messageId);
    console.log('✅ Email enviado a:', datosComprador.email);
    
    return { 
      success: true, 
      messageId: info.messageId,
      duration: duration + 'ms'
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

// Test endpoint para verificar conectividad
app.get('/webhook', (req, res) => {
  console.log('📞 GET request al webhook - MercadoPago puede estar probando conectividad');
  res.status(200).send('Webhook endpoint is reachable');
});

// Webhook para notificaciones de Mercado Pago
app.post('/webhook', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`🔔 [${timestamp}] Webhook recibido desde IP: ${req.ip || req.connection.remoteAddress}`);
  console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📦 Body:', JSON.stringify(req.body, null, 2));

  try {
    // Validación de signature (opcional para debugging)
    const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    
    const topic = req.body.type || req.query.type || req.headers['x-mp-topic'];
    
    if ((topic || '').toLowerCase() !== 'payment') {
      return res.status(200).send('IGNORED - Not a payment topic');
    }

    const paymentId = req.body.data?.id || req.query['data.id'];
    
    if (!paymentId) {
      return res.status(400).send('MISSING PAYMENT ID');
    }

    // Verificar idempotencia
    try {
      const cli = await pool.connect();
      try {
        const { rows } = await cli.query(
          `SELECT COUNT(*) as count FROM productos WHERE id_pedido = $1`,
          [paymentId]
        );
        if (rows && rows[0] && parseInt(rows[0].count) > 0) {
          return res.status(200).send('ALREADY PROCESSED');
        }
      } finally { 
        cli.release(); 
      }
    } catch (idempotencyError) {
      console.error('Error verificando idempotencia:', idempotencyError.message);
    }

    // Obtener detalles del pago desde MercadoPago
    const paymentClient = new Payment(client);
    const mpPayment = await paymentClient.get({ id: paymentId });
    console.log('Pago recuperado MP:', JSON.stringify(mpPayment));

    // Solo procesar pagos aprobados
    if (!mpPayment || (mpPayment.status !== 'approved' && mpPayment.status !== 'authorized')) {
      console.log(`⏸️ Pago no aprobado, status: ${mpPayment?.status || 'unknown'}`);
      return res.status(200).send('PAYMENT NOT APPROVED');
    }

    console.log('✅ Pago aprobado, procesando pedido...');

    // Extraer datos del metadata
    const metadata = mpPayment.metadata || {};
    const itemsSimple = Array.isArray(metadata.itemsSimple) ? metadata.itemsSimple : [];
    
    // Priorizar datos del checkout guardados en metadata sobre los del payer de MP
    const datosComprador = metadata.datosComprador || {
      nombre: mpPayment.payer?.first_name || 'Cliente',
      apellido: mpPayment.payer?.last_name || '',
      email: mpPayment.payer?.email || '',
      telefono: '',
      tipoEntrega: 'Retiro'
    };

    console.log('📦 Items reconstruidos:', itemsSimple);
    console.log('👤 Datos del comprador desde metadata (checkout):', datosComprador);

    // Construir productos del pedido
    const productos = itemsSimple.map(it => ({
      nombre: it.title,
      cantidad: it.quantity,
      precio: it.unit_price,
      img: '', 
      txt: ''
    }));

    // Obtener datos completos del comprador
    const nombreCompleto = [datosComprador.nombre, datosComprador.apellido]
      .filter(Boolean)
      .join(' ')
      .trim() || datosComprador.nombre || 'Cliente';
    
    const tipoEntrega = (datosComprador.tipoEntrega || '').toLowerCase() === 'envio' ? 'Envio' : 'Retiro';

    console.log('👤 Datos del cliente:', {
      nombre: nombreCompleto,
      email: datosComprador.email,
      tipoEntrega: tipoEntrega
    });

    // Procesar cada producto del pedido usando stored procedure
    if (productos.length > 0) {
      const cli = await pool.connect();
      try {
        console.log('🚀 Procesando pedido con stored procedure...');
        
        // Buscar IDs de productos disponibles
        const productosIds = [];
        
        for (const producto of productos) {
          // Limpiar nombre del producto
          const nombreLimpio = producto.nombre.split('(')[0].trim();
          const cantidad = parseInt(producto.cantidad, 10);
          
          console.log(`🔍 Buscando ${cantidad} unidades de "${nombreLimpio}" a precio ${producto.precio}`);
          
          // Buscar productos disponibles por nombre y precio
          const queryBuscar = `
            SELECT id_articulo
            FROM productos 
            WHERE LOWER(TRIM(prenda)) = LOWER($1)
              AND ABS(precio_venta_transferencia - $2) < 0.01
              AND id_pedido IS NULL
              AND estado IS NULL
            ORDER BY id_articulo
            LIMIT $3
          `;
          
          const { rows: productosDisponibles } = await cli.query(queryBuscar, [
            nombreLimpio,
            parseFloat(producto.precio),
            cantidad
          ]);
          
          console.log(`📦 Encontrados ${productosDisponibles.length} productos disponibles para "${nombreLimpio}"`);
          
          // Agregar IDs encontrados
          productosDisponibles.forEach(prod => {
            productosIds.push(prod.id_articulo);
          });
        }
        
        if (productosIds.length === 0) {
          console.warn('❌ No se encontraron productos disponibles para el pedido');
          return res.status(200).send('NO PRODUCTS AVAILABLE');
        }
        
        console.log(`🆔 IDs de productos encontrados: ${productosIds.join(',')}`);
        
        // Preparar datos para el stored procedure
        const idsProductos = productosIds.join(',');
        const montoTotal = parseFloat(mpPayment.transaction_amount);
        const nombreCliente = nombreCompleto;
        const correoCliente = datosComprador.email || 'cliente@webhook.com';
        const telefonoCliente = datosComprador.telefono || '';
        const metodoPago = 'MercadoPago';
        const tipoEntregaSP = tipoEntrega; // 'Retiro' o 'Envio'
        
        console.log('📋 Datos para SP:', {
          idsProductos,
          montoTotal,
          nombreCliente,
          correoCliente,
          telefonoCliente,
          metodoPago,
          tipoEntregaSP
        });
        
        // Ejecutar stored procedure con teléfono
        await cli.query(
          'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7)',
          [idsProductos, montoTotal, nombreCliente, correoCliente, telefonoCliente, metodoPago, tipoEntregaSP]
        );
        
        console.log(`✅ Pedido creado exitosamente por webhook usando SP. Payment ID: ${paymentId}`);
        
        // Enviar correo de confirmación
        if (correoCliente && nombreCliente) {
          try {
            await enviarCorreoConfirmacion(
              datosComprador, 
              productos, 
              montoTotal, 
              paymentId
            );
            console.log('✅ Correo enviado desde webhook para payment', paymentId);
          } catch (emailError) {
            console.error('❌ Error al enviar correo desde webhook:', emailError.message);
          }
        }
        
      } catch (e) {
        console.error('❌ Error procesando pedido con SP:', e.message);
        throw e;
      } finally { 
        cli.release(); 
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error en /webhook:', err.message);
    res.status(200).send('ERROR');
  }
});

// Endpoint para crear un pedido en la base de datos después del pago exitoso
app.post('/crear-pedido', async (req, res) => {
  const startTime = Date.now();
  console.log('� Creando pedido desde frontend...');
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📊 Request body completo:', JSON.stringify(req.body, null, 2));
  
  try {
    const { paymentId, productos, total, datosComprador } = req.body;
    
    // Validación de datos
    console.log('🔍 === VALIDACIÓN DE DATOS ===');
    if (!paymentId || !productos || !total || !datosComprador) {
      console.error('❌ VALIDACIÓN FALLIDA - Faltan datos requeridos');
      return res.status(400).json({ 
        success: false,
        error: 'Faltan datos requeridos para crear el pedido'
      });
    }

    console.log('✅ VALIDACIÓN EXITOSA');
    console.log('📋 Payment ID:', paymentId);
    console.log('💰 Total a procesar:', total);
    console.log('👤 Comprador:', datosComprador.nombre, datosComprador.email);
    console.log('🛍️ Productos:', productos.length, 'items');

    // Verificar si el pedido ya existe
    const dbClient = await pool.connect();
    try {
      const { rows: existingRows } = await dbClient.query(
        'SELECT COUNT(*) as count FROM productos WHERE id_pedido = $1',
        [paymentId]
      );
      
      if (parseInt(existingRows[0].count) > 0) {
        console.log('⚠️ Pedido ya existe, evitando duplicado');
        return res.json({
          success: true,
          message: 'Pedido ya fue procesado anteriormente',
          numeroPedido: paymentId,
          duplicate: true
        });
      }

      // Preparar datos del cliente
      const nombreCompleto = [datosComprador.nombre, datosComprador.apellido]
        .filter(Boolean)
        .join(' ')
        .trim() || datosComprador.nombre || 'Cliente';
      
      const tipoEntrega = (datosComprador.tipoEntrega || '').toLowerCase() === 'envio' ? 'Envio' : 'Retiro';

      console.log('👤 Datos procesados:', {
        nombre: nombreCompleto,
        email: datosComprador.email,
        tipoEntrega: tipoEntrega
      });

      // Procesar cada producto del pedido
      await dbClient.query('BEGIN');
      
      let productosActualizados = 0;
      
      for (const producto of productos) {
        // Extraer ID del producto desde el nombre (formato: "6-Midnight Dress (Talle: L)")
        // El nombre puede venir como "Vestido Media Noche (Talle: L)" donde necesitamos mapear al ID
        
        let idProducto = null;
        let talle = null;
        
        // Extraer talle del nombre si existe
        const talleMatch = producto.nombre.match(/\(Talle:\s*([^)]+)\)/i);
        if (talleMatch) {
          talle = talleMatch[1].trim();
        }
        
        // Mapear nombres a IDs de productos (deberías ajustar esto según tu estructura)
        const nombreLimpio = producto.nombre.split('(')[0].trim();
        
        console.log(`🔍 Procesando producto: "${nombreLimpio}", Talle: ${talle}, Precio: ${producto.precio}`);
        
        // Buscar por precio y talle (más específico que solo nombre)
        let queryBuscar, parametros;
        
        if (talle) {
          queryBuscar = `
            SELECT id_articulo, prenda, talle, precio_venta_transferencia
            FROM productos 
            WHERE ABS(precio_venta_transferencia - $1) < 0.01
              AND LOWER(TRIM(talle)) = LOWER($2)
              AND id_pedido IS NULL
            ORDER BY id_articulo ASC
            LIMIT 10
          `;
          parametros = [producto.precio, talle];
        } else {
          queryBuscar = `
            SELECT id_articulo, prenda, talle, precio_venta_transferencia
            FROM productos 
            WHERE ABS(precio_venta_transferencia - $1) < 0.01
              AND id_pedido IS NULL
            ORDER BY id_articulo ASC
            LIMIT 10
          `;
          parametros = [producto.precio];
        }
        
        const { rows: productosDisponibles } = await dbClient.query(queryBuscar, parametros);
        
        console.log(`📦 Encontrados ${productosDisponibles.length} productos disponibles para "${nombreLimpio}"`);
        
        const cantidad = parseInt(producto.cantidad, 10);
        
        // Actualizar productos (todos los disponibles hasta la cantidad solicitada)
        const cantidadAActualizar = Math.min(productosDisponibles.length, cantidad);
        
        for (let i = 0; i < cantidadAActualizar; i++) {
          const prod = productosDisponibles[i];
          
          const queryActualizar = `
            UPDATE productos 
            SET 
              id_pedido = $1,
              pedido_fecha = NOW(),
              pedido_nombre_cliente = $2,
              pedido_correo_cliente = $3,
              pedido_telefono_cliente = $4,
              pedido_monto_total = $5,
              pedido_tipo_entrega = $6,
              estado = 'Vendido'
            WHERE id_articulo = $7
          `;
          
          await dbClient.query(queryActualizar, [
            paymentId,
            nombreCompleto,
            datosComprador.email,
            datosComprador.telefono || '',
            parseFloat(total),
            tipoEntrega,
            prod.id_articulo
          ]);
          
          productosActualizados++;
        }
        
        if (cantidadAActualizar < cantidad) {
          console.warn(`⚠️ Solo se actualizaron ${cantidadAActualizar} de ${cantidad} productos para "${nombreLimpio}"`);
        } else {
          console.log(`✅ Actualizados ${cantidadAActualizar} productos de "${nombreLimpio}"`);
        }
      }
      
      await dbClient.query('COMMIT');
      
      console.log(`✅ Pedido creado exitosamente. Productos actualizados: ${productosActualizados}`);
      
      // Enviar correo de confirmación
      if (datosComprador.email && productosActualizados > 0) {
        try {
          await enviarCorreoConfirmacion(
            datosComprador, 
            productos, 
            total, 
            paymentId
          );
          console.log('✅ Correo de confirmación enviado');
        } catch (emailError) {
          console.error('❌ Error al enviar correo:', emailError.message);
        }
      }
      
      const duration = Date.now() - startTime;
      console.log(`⏱️ Pedido procesado en ${duration}ms`);
      
      res.json({
        success: true,
        message: 'Pedido creado exitosamente',
        numeroPedido: paymentId,
        productosActualizados: productosActualizados,
        duration: duration + 'ms'
      });
      
    } catch (error) {
      await dbClient.query('ROLLBACK');
      throw error;
    } finally {
      dbClient.release();
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('💥 === ERROR EN /crear-pedido ===');
    console.error('⏱️ Tiempo hasta error:', duration + 'ms');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Error al procesar el pedido',
      message: error.message,
      duration: duration + 'ms'
    });
  }
  
  console.log('🏁 === FIN /crear-pedido ===');
});

// Endpoint para consultar el estado de un pedido
app.get('/pedido/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const client = await pool.connect();
    
    // Buscar productos asociados a este pedido
    const productosResult = await client.query(
      `SELECT 
        COUNT(*) as count, 
        string_agg(DISTINCT CONCAT(prenda, ' (', talle, ')'), ', ') as productos,
        MAX(pedido_fecha) as fecha_pedido,
        MAX(pedido_nombre_cliente) as nombre_cliente,
        MAX(pedido_correo_cliente) as correo_cliente,
        MAX(pedido_telefono_cliente) as telefono_cliente,
        MAX(pedido_monto_total) as monto_total,
        MAX(pedido_tipo_entrega) as tipo_entrega
       FROM productos 
       WHERE id_pedido = $1`,
      [paymentId]
    );
    
    client.release();
    
    const result = productosResult.rows[0];
    const count = parseInt(result.count || 0);
    
    if (count > 0) {
      res.json({ 
        existe: true, 
        count: count,
        productos: result.productos,
        fecha_pedido: result.fecha_pedido,
        nombre_cliente: result.nombre_cliente,
        correo_cliente: result.correo_cliente,
        telefono_cliente: result.telefono_cliente,
        monto_total: result.monto_total,
        tipo_entrega: result.tipo_entrega,
        fuente: 'tabla_productos'
      });
    } else {
      res.json({ 
        existe: false,
        message: 'Pedido no encontrado'
      });
    }
    
  } catch (error) {
    console.error('❌ Error al consultar pedido:', error);
    res.status(500).json({ 
      error: 'Error al consultar pedido',
      details: error.message 
    });
  }
});

// Endpoint para consultar productos sin stock (vendidos)
app.get('/stock-agotado', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT DISTINCT id_articulo
         FROM productos
         WHERE id_pedido IS NOT NULL`
      );
      const ids = rows.map(r => r.id_articulo);
      res.json({ ids });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error en /stock-agotado:', err.message);
    res.status(500).json({ error: 'Error consultando stock', message: err.message });
  }
});

// Nuevo endpoint para confirmar compra y enviar correo
app.post('/confirmar-compra', async (req, res) => {
  try {
    const { nombre, apellido, email, resumen, total } = req.body;
    if (!nombre || !apellido || !email || !resumen || !total) {
      return res.status(400).json({ success: false, error: "Faltan datos." });
    }
    
    const numeroPedido = Math.floor(100000 + Math.random() * 900000);
    
    const transporter = nodemailer.createTransporter({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
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
    
    await transporter.sendMail(mailOptions);
    res.json({ success: true, numeroPedido });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para crear pedido con stored procedure
app.post('/crear-pedido-sp', async (req, res) => {
  console.log('🚀 Request a /crear-pedido-sp');
  console.log('📋 Body completo:', JSON.stringify(req.body, null, 2));
  
  try {
    const { productos, monto_total, nombre_cliente, correo_cliente, telefono_cliente, metodo_pago = 'MercadoPago', tipo_entrega = 'Retiro' } = req.body;
    
    console.log('📦 Productos recibidos:', productos?.length || 0);
    console.log('💰 Monto total:', monto_total);
    console.log('📞 Teléfono cliente:', telefono_cliente);
    
    if (!productos?.length || !monto_total || !nombre_cliente || !correo_cliente) {
      return res.status(400).json({ success: false, error: 'Faltan datos requeridos' });
    }

    // Extraer IDs de productos directamente del carrito
    const productosIds = [];
    
    console.log('🔍 === ANÁLISIS DETALLADO DE PRODUCTOS ===');
    productos.forEach((prod, index) => {
      console.log(`Producto ${index + 1}:`, JSON.stringify(prod, null, 2));
    });
    
    for (const prod of productos) {
      console.log(`\n🔎 Procesando producto:`, {
        id: prod.id,
        nombre: prod.nombre,
        img: prod.img,
        cantidad: prod.cantidad
      });
      
      // El ID del producto puede venir de varias fuentes
      let idProducto = prod.id;
      
      // 1. Intentar extraer del campo id directo
      if (!idProducto && prod.nombre) {
        // 2. Extraer del nombre (formato: "123-Nombre del producto")
        const matchNombre = prod.nombre.match(/^(\d+)-/);
        if (matchNombre) {
          idProducto = parseInt(matchNombre[1]);
          console.log(`📝 ID extraído del nombre: ${idProducto}`);
        }
      }
      
      // 3. Extraer de la imagen (formato: "/123-producto.jpg" o "assets/img/portfolio/123-producto.jpg")
      if (!idProducto && prod.img) {
        const matchImg = prod.img.match(/\/(\d+)-[^/]+\.(jpg|jpeg|png|webp)/i);
        if (matchImg) {
          idProducto = parseInt(matchImg[1]);
          console.log(`📝 ID extraído de la imagen: ${idProducto} desde ${prod.img}`);
        }
      }
      
      // 4. Extraer del título si tiene formato "123-Nombre" (para compatibilidad con títulos de MercadoPago)
      if (!idProducto && prod.title) {
        const matchTitle = prod.title.match(/^(\d+)-/);
        if (matchTitle) {
          idProducto = parseInt(matchTitle[1]);
          console.log(`📝 ID extraído del título: ${idProducto}`);
        }
      }
      
      // 5. Último intento: buscar cualquier número al inicio del nombre
      if (!idProducto && prod.nombre) {
        const matchNumero = prod.nombre.match(/(\d+)/);
        if (matchNumero) {
          idProducto = parseInt(matchNumero[1]);
          console.log(`📝 ID extraído como primer número del nombre: ${idProducto}`);
        }
      }
      
      if (idProducto) {
        const cantidad = parseInt(prod.cantidad) || 1;
        console.log(`✅ Agregando ${cantidad} unidades del producto ID: ${idProducto}`);
        
        // Agregar el ID tantas veces como cantidad se solicite
        for (let i = 0; i < cantidad; i++) {
          productosIds.push(idProducto);
        }
      } else {
        console.error(`❌ No se pudo extraer ID del producto:`, {
          nombre: prod.nombre,
          img: prod.img,
          id: prod.id
        });
      }
    }
    
    if (productosIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No se pudieron extraer los IDs de los productos del carrito' 
      });
    }
    
    const idsString = productosIds.join(',');
    console.log('🆔 IDs de productos para SP:', idsString);
    
    const dbClient = await pool.connect();
    try {
      // Llamar al stored procedure directamente con los IDs del carrito incluyendo teléfono
      await dbClient.query(
        'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7)',
        [idsString, parseFloat(monto_total), nombre_cliente, correo_cliente, telefono_cliente || '', metodo_pago, tipo_entrega]
      );
      
      console.log('✅ Stored procedure ejecutado exitosamente');
      console.log('✅ Productos procesados:', productosIds.length);
      
      res.json({
        success: true,
        mensaje: 'Pedido creado exitosamente con stored procedure',
        productosIds: idsString,
        cliente: nombre_cliente,
        productos_procesados: productosIds.length
      });
      
    } finally {
      dbClient.release();
    }
    
  } catch (error) {
    console.error('❌ Error en crear-pedido-sp:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Error al ejecutar stored procedure'
    });
  }
});

// Servir archivos estáticos desde la carpeta raíz del proyecto
app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 3001;

console.log('Intentando iniciar backend Capri Store...');
app.listen(PORT, () => {
  console.log(`Backend escuchando en puerto ${PORT}`);
});
