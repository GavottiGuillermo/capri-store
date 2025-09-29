const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env en la carpeta padre
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('� Capri Store API iniciando...');

// ===============================
// CONFIGURACIÓN DE NODEMAILER
// ===============================
let transporter = null;

console.log('🔍 Verificando configuración SMTP...');
console.log('SMTP_USER:', process.env.SMTP_USER ? 'CONFIGURADO ✅' : 'NO CONFIGURADO ❌');
console.log('SMTP_PASS:', process.env.SMTP_PASS ? 'CONFIGURADO ✅' : 'NO CONFIGURADO ❌');
console.log('SMTP_HOST:', process.env.SMTP_HOST || 'smtp.gmail.com (default)');
console.log('SMTP_PORT:', process.env.SMTP_PORT || '587 (default)');
console.log('SMTP_SECURE:', process.env.SMTP_SECURE || 'false (default)');
console.log('SMTP_FROM:', process.env.SMTP_FROM || 'usando SMTP_USER');

if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  try {
    // Usar TODAS las variables de entorno configuradas en Render
    const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
    const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;
    
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    
    console.log(`✅ Transporter configurado: ${process.env.SMTP_HOST}:${smtpPort} (secure: ${smtpSecure})`);
    console.log('ℹ️  Verificación de conexión SMTP omitida para evitar timeouts');
    
  } catch (configError) {
    console.error('❌ Error configurando transporter:', configError.message);
    transporter = null;
  }
} else {
  console.warn('⚠️ Configuración de email incompleta - emails no serán enviados');
  console.warn('   Variables faltantes:');
  if (!process.env.SMTP_USER) console.warn('   - SMTP_USER');
  if (!process.env.SMTP_PASS) console.warn('   - SMTP_PASS');
}

// ===============================
// VALIDACIÓN DE VARIABLES DE ENTORNO
// ===============================
if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.warn('⚠️ Configuración de email incompleta');
}

if (!process.env.ADMIN_EMAILS) {
  console.warn('⚠️ ADMIN_EMAILS no configurado');
}

const app = express();


// Almacén en memoria para notificaciones de webhook
const webhookNotifications = new Map();
// Bandera para evitar envío duplicado de email por paymentId
const emailSentForPayment = new Set();

// ===============================
// CONFIGURACIÓN DE MIDDLEWARES
// ===============================
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000', 
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'https://capristorezte.com.ar',
    'https://www.capristorezte.com.ar'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware CORS alternativo más explícito
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Servir archivos estáticos desde la carpeta raíz
app.use(express.static(path.join(__dirname, '..')));

// ===============================
// CONFIGURACIÓN DE BASE DE DATOS
// ===============================
let pool;
async function initializeDatabase() {
  try {
    if (process.env.DATABASE_URL) {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
      });
    } else {
      throw new Error('DATABASE_URL no está configurada');
    }

    // Probar la conexión
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();

    // Verificar si existe la columna mp_payment_id
    const client2 = await pool.connect();
    const checkColumn = await client2.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'productos' 
        AND column_name = 'mp_payment_id'
    `);
    client2.release();

    if (checkColumn.rows.length === 0) {
      console.warn('⚠️ Columna mp_payment_id NO existe en tabla productos');
    }

  } catch (error) {
    console.error('❌ Error de conexión a PostgreSQL:', error.message);
    throw error;
  }
}

// ===============================
// CONFIGURACIÓN DE MERCADO PAGO
// ===============================
// Validar token de acceso
if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
  console.error('❌ MERCADOPAGO_ACCESS_TOKEN no configurado - MercadoPago no estará disponible');
  // No terminar el proceso, solo deshabilitar MercadoPago
} else {
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('TEST-') && 
      !process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('APP_USR-')) {
    console.warn('⚠️ Formato de token MercadoPago no reconocido');
  }
}

const client = process.env.MERCADOPAGO_ACCESS_TOKEN ? 
  new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN }) : 
  null;

// ===============================
// FUNCIONES DE EMAIL TEMPLATES
// ===============================

// Template de email para cliente
function createCustomerEmailTemplate(customerData, orderData, paymentInfo) {
  const { nombre, apellido, email, telefono } = customerData;
  const { numeroDisplay, idPedidoCompleto } = orderData;
  const { transaction_amount, id: paymentId } = paymentInfo;
  
  // Obtener productos del payment info
  const items = paymentInfo.additional_info?.items || [];
  let productosHtml = '';
  
  if (items.length > 0) {
    productosHtml = items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e29ca3;">${item.title || 'Producto'}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e29ca3; text-align: center;">${item.quantity || 1}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e29ca3; text-align: right;">$${(item.unit_price || 0).toLocaleString('es-AR')}</td>
      </tr>
    `).join('');
  } else {
    productosHtml = `
      <tr>
        <td colspan="3" style="padding: 10px; text-align: center; color: #666;">Detalles de productos no disponibles</td>
      </tr>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Confirmación de Pedido - Capri Store</title>
    </head>
    <body style="margin: 0; padding: 20px; font-family: 'Montserrat', Arial, sans-serif; background-color: #f8f9fa;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        
        <!-- Header con logo -->
        <div style="background: linear-gradient(135deg, #6b0a0a 0%, #8b1a1a 100%); padding: 30px 20px; text-align: center;">
          <div style="display: inline-flex; align-items: center; justify-content: center; margin-bottom: 10px;">
            <img src="https://capristorezte.com.ar/assets/img/logo-capri.jpg" 
                 alt="Capri Store Logo" 
                 style="width: 50px; height: 50px; margin-right: 15px; border-radius: 50%; object-fit: cover;" />
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Capri Store</h1>
          </div>
          <p style="color: #e29ca3; margin: 0; font-size: 16px;">Moda femenina con estilo único</p>
        </div>

        <!-- Contenido principal -->
        <div style="padding: 30px 20px;">
          <h2 style="color: #6b0a0a; margin-bottom: 20px; text-align: center;">¡Gracias por tu compra!</h2>
          
          <div style="background-color: #f8f9fa; border-left: 4px solid #e29ca3; padding: 20px; margin-bottom: 25px; border-radius: 5px;">
            <h3 style="color: #6b0a0a; margin: 0 0 10px 0;">Tu pedido ha sido confirmado</h3>
            <p style="margin: 0; color: #666; line-height: 1.5;">
              Hola <strong>${nombre}</strong>, hemos recibido tu pedido y está siendo procesado. 
              Te enviaremos actualizaciones sobre el estado de tu compra.
            </p>
          </div>

          <!-- Detalles del pedido -->
          <div style="margin-bottom: 25px;">
            <h3 style="color: #6b0a0a; border-bottom: 2px solid #e29ca3; padding-bottom: 10px; margin-bottom: 15px;">Detalles del Pedido</h3>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
              <span style="color: #666;">Número de Pedido:</span>
              <strong style="color: #6b0a0a; font-size: 18px;">#${numeroDisplay}</strong>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
              <span style="color: #666;">ID de Pago MercadoPago:</span>
              <strong style="color: #6b0a0a;">${paymentId}</strong>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
              <span style="color: #666;">Total:</span>
              <strong style="color: #6b0a0a; font-size: 20px;">$${transaction_amount.toLocaleString('es-AR')} ARS</strong>
            </div>
          </div>

          <!-- Productos -->
          <div style="margin-bottom: 25px;">
            <h3 style="color: #6b0a0a; border-bottom: 2px solid #e29ca3; padding-bottom: 10px; margin-bottom: 15px;">Productos</h3>
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #e29ca3; border-radius: 5px;">
              <thead>
                <tr style="background-color: #6b0a0a; color: white;">
                  <th style="padding: 12px; text-align: left;">Producto</th>
                  <th style="padding: 12px; text-align: center;">Cant.</th>
                  <th style="padding: 12px; text-align: right;">Precio</th>
                </tr>
              </thead>
              <tbody>
                ${productosHtml}
              </tbody>
            </table>
          </div>

          <!-- Información importante -->
          <div style="background-color: #fff8f6; border: 1px solid #e29ca3; border-radius: 5px; padding: 20px; margin-bottom: 25px;">
            <h4 style="color: #6b0a0a; margin: 0 0 10px 0;">📍 Información de Entrega</h4>
            <p style="margin: 0; color: #666; line-height: 1.5;">
              Tu pedido será preparado para <strong>retiro en local</strong>. Te contactaremos pronto para coordinar el retiro.
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #6b0a0a; color: white; padding: 20px; text-align: center;">
          <p style="margin: 0 0 10px 0;">¿Tienes alguna pregunta?</p>
          <p style="margin: 0; color: #e29ca3;">
            📞 +54 9 11 1234 5678 | 📧 <info.capristorezte@gmail.com>
          </p>
          <p style="margin: 15px 0 0 0; font-size: 12px; color: #cccccc;">
            © 2024 Capri Store. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Template de email para administradores
function createAdminEmailTemplate(customerData, orderData, paymentInfo) {
  const { nombre, apellido, email, telefono } = customerData;
  const { numeroDisplay, idPedidoCompleto } = orderData;
  const { transaction_amount, id: paymentId, status, payment_method_id } = paymentInfo;
  
  // Obtener productos del payment info
  const items = paymentInfo.additional_info?.items || [];
  let productosHtml = '';
  
  if (items.length > 0) {
    productosHtml = items.map(item => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.id || 'N/A'}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.title || 'Producto'}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity || 1}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">$${(item.unit_price || 0).toLocaleString('es-AR')}</td>
      </tr>
    `).join('');
  } else {
    productosHtml = `
      <tr>
        <td colspan="4" style="padding: 10px; text-align: center; color: #666;">No hay detalles de productos disponibles</td>
      </tr>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Nueva Venta - Capri Store Admin</title>
    </head>
    <body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f5f5f5;">
      <div style="max-width: 700px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="background-color: #6b0a0a; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">🛍️ Nueva Venta Recibida</h1>
          <p style="margin: 5px 0 0 0; color: #e29ca3;">Capri Store - Panel Administrativo</p>
        </div>

        <!-- Información del cliente -->
        <div style="padding: 20px; border-bottom: 1px solid #eee;">
          <h2 style="color: #6b0a0a; margin: 0 0 15px 0; font-size: 18px;">👤 Datos del Cliente</h2>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div><strong>Nombre:</strong> ${nombre} ${apellido}</div>
            <div><strong>Email:</strong> ${email}</div>
            <div><strong>Teléfono:</strong> ${telefono}</div>
            <div><strong>Tipo Entrega:</strong> Retiro en Local</div>
          </div>
        </div>

        <!-- Información del pedido -->
        <div style="padding: 20px; border-bottom: 1px solid #eee;">
          <h2 style="color: #6b0a0a; margin: 0 0 15px 0; font-size: 18px;">📋 Información del Pedido</h2>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div><strong>Pedido Nº:</strong> #${numeroDisplay} (${idPedidoCompleto})</div>
            <div><strong>Estado Pago:</strong> <span style="color: green;">${status.toUpperCase()}</span></div>
            <div><strong>ID Pago MP:</strong> ${paymentId}</div>
            <div><strong>Método Pago:</strong> ${payment_method_id || 'N/A'}</div>
            <div><strong>Total:</strong> <span style="color: #6b0a0a; font-size: 18px; font-weight: bold;">$${transaction_amount.toLocaleString('es-AR')} ARS</span></div>
          </div>
        </div>

        <!-- Productos -->
        <div style="padding: 20px;">
          <h2 style="color: #6b0a0a; margin: 0 0 15px 0; font-size: 18px;">🛒 Productos Vendidos</h2>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">ID</th>
                <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Producto</th>
                <th style="padding: 10px; text-align: center; border-bottom: 2px solid #ddd;">Cant.</th>
                <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Precio</th>
              </tr>
            </thead>
            <tbody>
              ${productosHtml}
            </tbody>
          </table>
        </div>

        <!-- Acciones recomendadas -->
        <div style="background-color: #f8f9fa; padding: 20px; margin: 20px; border-radius: 5px; border-left: 4px solid #e29ca3;">
          <h3 style="color: #6b0a0a; margin: 0 0 10px 0;">📝 Próximos Pasos</h3>
          <ul style="margin: 0; padding-left: 20px; color: #666;">
            <li>Preparar los productos para retiro</li>
            <li>Contactar al cliente para coordinar horario de retiro</li>
            <li>Verificar stock disponible</li>
            <li>Actualizar estado del pedido en el sistema</li>
          </ul>
        </div>

        <!-- Footer -->
        <div style="background-color: #6b0a0a; color: white; padding: 15px; text-align: center;">
          <p style="margin: 0; font-size: 12px;">
            Este email fue generado automáticamente por el sistema de Capri Store
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ===============================
// FUNCIONES AUXILIARES
// ===============================
async function executeQueryWithRetry(pool, query, params, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(query, params);
        client.release();
        return result;
      } catch (error) {
        client.release();
        throw error;
      }
    } catch (error) {
      console.error(`Intento ${attempt}/${maxRetries} falló:`, error.message);
      lastError = error;
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  throw lastError;
}

// ===============================
// ENDPOINT: VALIDAR STOCK DE CARRITO
// ===============================
app.post('/validar-stock-carrito', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, faltantes: [], error: 'Body vacío o malformado. Enviar JSON con { ids: [...] }' });
    }
    
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.json({ ok: true, faltantes: [], advertencia: 'No se recibieron IDs para validar. Enviar JSON como { "ids": [1,2,3] }' });
    }

    const faltantes = [];
    
    // Para cada ID, verificar stock usando la nueva lógica
    for (const id of ids) {
      try {
        // Obtener datos del producto
        const productQuery = `
          SELECT prenda, color, talle 
          FROM productos 
          WHERE id_articulo = $1 
          LIMIT 1
        `;
        
        const productResult = await executeQueryWithRetry(pool, productQuery, [parseInt(id)], 2);
        
        if (!productResult.rows || productResult.rows.length === 0) {
          // Producto no existe
          faltantes.push(parseInt(id));
          continue;
        }

        const { prenda, color, talle } = productResult.rows[0];

        // Contar stock disponible para esta combinación
        const stockQuery = `
          SELECT COUNT(*) as stock_total
          FROM productos 
          WHERE prenda = $1 
            AND color = $2 
            AND talle = $3 
            AND estado = 'Disponible'
        `;
        
        const stockResult = await executeQueryWithRetry(
          pool, 
          stockQuery, 
          [prenda, color, talle], 
          2
        );

        const stockTotal = parseInt(stockResult.rows[0]?.stock_total || 0);
        
        if (stockTotal === 0) {
          faltantes.push(parseInt(id));
        }
        
      } catch (error) {
        console.error(`❌ Error validando stock para ID ${id}:`, error);
        // En caso de error, por seguridad lo marcamos como faltante
        faltantes.push(parseInt(id));
      }
    }

    res.json({ ok: true, faltantes });
    
  } catch (error) {
    console.error('❌ Error en /validar-stock-carrito:', error);
    res.status(500).json({ ok: false, faltantes: [], error: error.message });
  }
});

// ===============================
// ENDPOINT: OBTENER IDS DE PRODUCTOS SIN STOCK
// ===============================
app.get('/stock-agotado', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  try {
    // Nueva consulta: obtener productos cuya combinación prenda+color+talle no tiene stock disponible
    const query = `
      WITH stock_combinations AS (
        SELECT 
          prenda, 
          color, 
          talle,
          COUNT(*) FILTER (WHERE estado = 'Disponible') as stock_disponible,
          array_agg(id_articulo) as all_ids
        FROM productos 
        WHERE prenda IS NOT NULL 
          AND color IS NOT NULL 
          AND talle IS NOT NULL
        GROUP BY prenda, color, talle
      )
      SELECT DISTINCT unnest(all_ids) as id_articulo
      FROM stock_combinations 
      WHERE stock_disponible = 0
    `;
    
    const result = await executeQueryWithRetry(pool, query, [], 2);
    
    const idsAgotados = result.rows.map(row => parseInt(row.id_articulo));
    
    res.json({ 
      ok: true, 
      ids: idsAgotados,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error en /stock-agotado:', error);
    res.status(500).json({ 
      ok: false, 
      ids: [], 
      error: error.message 
    });
  }
});

// ===============================
// ENDPOINT: CREAR PREFERENCIA DE MERCADO PAGO
// ===============================
app.post('/crear-preferencia', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  // Verificar si MercadoPago está configurado
  if (!client || !process.env.MERCADOPAGO_ACCESS_TOKEN) {
    console.error('❌ MercadoPago no configurado - no se puede crear preferencia');
    return res.status(503).json({
      error: 'Servicio no disponible',
      message: 'MercadoPago no está configurado correctamente',
      details: 'El token de acceso de MercadoPago no está configurado en el servidor'
    });
  }
  
  try {
    const { items, datosComprador } = req.body;
    console.log('📋 Crear preferencia - Items:', items.length, 'productos');
    console.log('📋 Cliente:', datosComprador.nombre, datosComprador.apellido, '- Total:', items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0), 'ARS');

    // Validar datos requeridos
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error('❌ /crear-preferencia: Items requeridos no presentes');
      return res.status(400).json({
        error: 'Items requeridos',
        message: 'Se requiere al menos un item',
        received: req.body
      });
    }

    if (!datosComprador || !datosComprador.email) {
      console.error('❌ /crear-preferencia: Datos del comprador incompletos');
      return res.status(400).json({
        error: 'Datos del comprador incompletos',
        message: 'Email del comprador es requerido',
        received_data: datosComprador
      });
    }

    // Validar que cada item tenga los campos requeridos por MercadoPago
    const itemsMP = items.map((item, idx) => {
      if (!item.id_articulo && !item.id) {
        console.error(`❌ /crear-preferencia: Item en posición ${idx} sin ID`);
        throw new Error(`El item en posición ${idx} no tiene id_articulo ni id`);
      }
      
      const precio = Number(item.precio || item.unit_price || 0);
      const cantidad = Number(item.cantidad || item.quantity || 1);
      
      if (precio <= 0) {
        throw new Error(`El item en posición ${idx} tiene precio inválido: ${precio}`);
      }
      
      if (cantidad <= 0) {
        throw new Error(`El item en posición ${idx} tiene cantidad inválida: ${cantidad}`);
      }
      
      const mapped = {
        id: String(item.id_articulo || item.id),
        title: (item.nombre || item.title || 'Producto Capri').substring(0, 256), // Limitar título
        description: `Producto de Capri Store - ${item.nombre || 'Sin descripción'}`.substring(0, 600),
        quantity: cantidad,
        currency_id: 'ARS',
        unit_price: precio,
        category_id: 'fashion'  // Categoría para ropa
      };
      
      return mapped;
    });

    for (const [idx, item] of itemsMP.entries()) {
      if (!item.id || !item.title || !item.unit_price || !item.quantity) {
        console.error(`❌ /crear-preferencia: Item en posición ${idx} incompleto`);
        return res.status(400).json({
          error: 'Item inválido',
          message: `El item en posición ${idx} no tiene todos los campos requeridos`,
          item
        });
      }
    }

    // Crear la preferencia en MercadoPago
    const preference = new Preference(client);
    const preferenceData = {
      items: itemsMP,
      payer: {
        name: datosComprador.nombre || '',
        surname: datosComprador.apellido || '',
        email: datosComprador.email,
        phone: {
          area_code: '11',
          number: (datosComprador.telefono || '').replace(/[^\d]/g, '').slice(-8)
        }
        // Remover identification temporalmente - puede estar causando el rechazo
        // identification: {
        //   type: 'DNI',
        //   number: '12345678'
        // }
      },
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 6  // Reducir a 6 cuotas por si 12 causa problemas
      },
      shipments: {
        mode: 'not_specified'
      },
      external_reference: JSON.stringify({
        email: datosComprador.email,
        nombre: datosComprador.nombre,
        apellido: datosComprador.apellido,
        telefono: datosComprador.telefono
      }),
      statement_descriptor: 'CAPRI STORE',
      auto_return: 'approved',
      binary_mode: false,
      back_urls: {
        success: 'https://capristorezte.com.ar/success.html',
        failure: 'https://capristorezte.com.ar/failure.html',
        pending: 'https://capristorezte.com.ar/pending.html'
      },
      notification_url: 'https://capri-store.onrender.com/webhook'
      // Remover campos que pueden causar conflictos
      // expires: false,
      // expiration_date_from: null,
      // expiration_date_to: null
    };

    console.log('🚀 Creando preferencia MP - ID items:', itemsMP.map(item => item.id).join(', '));

    const result = await preference.create({ body: preferenceData });
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({
      preference_id: result.id,
      init_point: result.init_point
    });
  } catch (error) {
    console.error('❌ Error al crear preferencia:', error.message);
    console.error('❌ Stack trace:', error.stack);
    console.error('❌ Error completo:', error);
    console.error('❌ Datos recibidos:', JSON.stringify(req.body, null, 2));
    
    try {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(500).json({
        error: 'Error inesperado al crear preferencia',
        message: error.message || String(error),
        stack: error.stack || null,
        details: 'Ver logs del servidor para más información'
      });
    } catch (err2) {
      console.error('❌ Error al intentar enviar respuesta de error:', err2);
      res.end();
    }
  }
});

// ===============================
// ENDPOINT: WEBHOOK DE MERCADO PAGO  
// ===============================
app.post('/webhook', async (req, res) => {
  const timestamp = new Date().toISOString();
  let paymentId = null;
  let shouldProcess = false;
  
  console.log(`[${timestamp}] 🔔 WEBHOOK RECIBIDO`);
  
  try {
    const { type, data, action, topic, resource } = req.body;
    console.log(`[${timestamp}] Webhook - Type: ${type}, Action: ${action}, Topic: ${topic}`);
    
    if (type === 'payment' && data?.id) {
      paymentId = data.id;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Payment webhook ID: ${paymentId}`);
    } else if (action === 'payment.created' && data?.id) {
      paymentId = data.id;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Payment created webhook ID: ${paymentId}`);
    } else if (topic === 'payment' && resource) {
      paymentId = resource;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook topic 'payment' con resource: ${paymentId}`);
    } else {
      console.log(`[${timestamp}] ❌ Webhook ignorado - type: ${type}, action: ${action}, topic: ${topic}, resource: ${resource}`);
      return res.status(200).send('OK - Ignored (not payment)');
    }
    if (shouldProcess && paymentId) {
      let pedidoExistenteAntes = null;
      try {
        const pedidoExistente = await executeQueryWithRetry(
          pool,
          `SELECT id_pedido FROM productos WHERE (mp_payment_id = $1 OR mp_payment_id = $2) AND id_pedido IS NOT NULL AND id_pedido != '' LIMIT 1`,
          [paymentId, paymentId.toString()],
          2
        );
        if (pedidoExistente && pedidoExistente.rows && pedidoExistente.rows.length > 0) {
          pedidoExistenteAntes = pedidoExistente.rows[0].id_pedido;
          console.log(`[${timestamp}] Pago ${paymentId} ya tiene pedido en BD (${pedidoExistenteAntes}) - Ignorado`);
          return res.status(200).send('OK - Already processed in DB');
        }
      } catch (err) {
        console.log(`[${timestamp}] Error al consultar pedido existente en BD para pago ${paymentId}`);
        return res.status(200).send('OK - DB check error');
      }
      if (webhookNotifications.has(paymentId)) {
        console.log(`[${timestamp}] Pago ${paymentId} ya fue procesado anteriormente (memoria) - Ignorado`);
        return res.status(200).send('OK - Already processed (memory)');
      }
      webhookNotifications.set(paymentId, true);
      // Procesamiento normal (sin logs detallados)
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: paymentId });
      if (paymentInfo.status === 'approved') {
        // Extraer información del external_reference
        let customerData = {};
        try {
          if (paymentInfo.external_reference) {
            customerData = JSON.parse(paymentInfo.external_reference);
          }
        } catch (error) {}
        let productIds = '';
        const items = paymentInfo.additional_info?.items || [];
        if (items.length > 0) {
          productIds = (items.map(item => item.id).filter(Boolean) || []).join(',');
        }
        if (!productIds) productIds = 'MANUAL';

        // NUEVO: Chequeo en BD si el paymentId ya existe
        let idsArray = [];
        if (productIds !== 'MANUAL') {
          idsArray = productIds.split(',').map(id => id.trim()).filter(Boolean);
        }
        let faltantes = [];
        if (idsArray.length > 0) {
          try {
            const query = `SELECT id_articulo FROM productos WHERE id_articulo = ANY($1) AND estado != 'Disponible'`;
            const result = await executeQueryWithRetry(
              pool,
              query,
              [idsArray],
              2
            );
            faltantes = result.rows.map(row => row.id_articulo);
          } catch (error) {
            // Si hay error en la consulta, por seguridad, considerar como faltantes todos
            try {
              const result = await executeQueryWithRetry(
                pool,
                `SELECT COUNT(*) AS count FROM productos WHERE mp_payment_id = $1`,
                [paymentId],
                2
              );
              if (result.rows[0].count && Number(result.rows[0].count) > 0) {
                console.log(`[${timestamp}] Webhook ignorado: paymentId ${paymentId} ya existe en BD (productos.mp_payment_id)`);
                return res.status(200).send('OK');
              }
            } catch (err) {
              console.error(`[${timestamp}] Error al consultar BD para paymentId ${paymentId}:`, err);
              // Si hay error en la consulta, sigue con la lógica normal para no perder el webhook
            }
            faltantes = idsArray;
          }
        }

        if (faltantes.length > 0) {
          // Hay productos no disponibles, NO crear pedido, enviar correo de aviso
          try {
            if ((customerData.email || paymentInfo.payer?.email) && process.env.SMTP_USER && process.env.SMTP_PASS) {
              const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
                secure: false,
                auth: {
                  user: process.env.SMTP_USER,
                  pass: process.env.SMTP_PASS
                }
              });
              const toEmails = [customerData.email || paymentInfo.payer?.email];
              if (process.env.ADMIN_EMAILS) {
                toEmails.push(...process.env.ADMIN_EMAILS.split(','));
              }
              // Email al cliente y admins
              const mailOptions = {
                from: process.env.SMTP_USER,
                to: toEmails.join(','),
                subject: `Problema con tu compra en Capri Store` ,
                text: `Hola,\n\nLamentablemente uno o más artículos de tu compra ya no están disponibles.\n\nArtículos sin stock: ${faltantes.join(', ')}\n\nNo se ha generado el pedido automáticamente. Nos comunicaremos a la brevedad para resolver el inconveniente.\n\nDisculpa las molestias.\n\n-- Capri Store` 
              };
              await transporter.sendMail(mailOptions);
            }
          } catch (mailError) {}
          console.log(`[${timestamp}] Pago ${paymentId} recibido pero artículos sin stock (${faltantes.join(', ')}), se notificó por email.`);
        } else {
          // Todos los productos disponibles, crear pedido normalmente
          let pedidoExistenteDespues = null;
          let idPedidoCompleto = null;
          let numeroDisplay = null;
          let pedidoCreado = false;
          try {
            const spParams = [
              productIds,
              paymentInfo.transaction_amount,
              `${customerData.nombre || ''} ${customerData.apellido || ''}`.trim() || paymentInfo.payer?.first_name || 'Cliente Web',
              customerData.email || paymentInfo.payer?.email || 'cliente@web.com',
              customerData.telefono || '',
              'MercadoPago',
              'Retiro',
              paymentId
            ];
            
            console.log(`[${timestamp}] 🔧 Ejecutando sp_crear_pedido_web con parámetros:`);
            console.log(`[${timestamp}]   - IDs productos: ${spParams[0]}`);
            console.log(`[${timestamp}]   - Monto: $${spParams[1]} ARS`);
            console.log(`[${timestamp}]   - Cliente: ${spParams[2]}`);
            console.log(`[${timestamp}]   - Email: ${spParams[3]}`);
            console.log(`[${timestamp}]   - Teléfono: ${spParams[4]}`);
            console.log(`[${timestamp}]   - Payment ID: ${spParams[7]}`);
            
            await executeQueryWithRetry(
              pool,
              'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
              spParams
            );
            const pedidoResult = await executeQueryWithRetry(
              pool,
              `SELECT id_pedido FROM productos WHERE mp_payment_id = $1 OR mp_payment_id = $2 AND id_pedido IS NOT NULL AND id_pedido != '' ORDER BY pedido_fecha DESC LIMIT 1`,
              [paymentId, paymentId.toString()],
              2
            );
            if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
              pedidoExistenteDespues = pedidoResult.rows[0].id_pedido;
              idPedidoCompleto = pedidoExistenteDespues;
              numeroDisplay = idPedidoCompleto && idPedidoCompleto.length >= 2 ? idPedidoCompleto.slice(-2) : idPedidoCompleto;
              pedidoCreado = !pedidoExistenteAntes && !!pedidoExistenteDespues;
            }
          } catch (err) {}
          if (pedidoCreado && !pedidoExistenteAntes) {
            // Enviar emails de confirmación
            try {
              if (process.env.SMTP_USER && process.env.SMTP_PASS) {
                // Usar TODAS las variables de entorno de Render
                const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
                const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;
                
                const transporter = nodemailer.createTransport({
                  host: process.env.SMTP_HOST || 'smtp.gmail.com',
                  port: smtpPort,
                  secure: smtpSecure,
                  auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                  }
                });

                const orderData = {
                  numeroDisplay,
                  idPedidoCompleto
                };

                // EMAIL AL CLIENTE
                if (customerData.email || paymentInfo.payer?.email) {
                  const customerEmail = customerData.email || paymentInfo.payer?.email;
                  const customerHtml = createCustomerEmailTemplate(
                    {
                      nombre: customerData.nombre || paymentInfo.payer?.first_name || 'Cliente',
                      apellido: customerData.apellido || paymentInfo.payer?.last_name || '',
                      email: customerEmail,
                      telefono: customerData.telefono || ''
                    },
                    orderData,
                    paymentInfo
                  );

                  const customerMailOptions = {
                    from: {
                      name: 'Capri Store',
                      address: process.env.SMTP_FROM || process.env.SMTP_USER
                    },
                    to: customerEmail,
                    subject: `✅ Confirmación de Pedido #${numeroDisplay} - Capri Store`,
                    html: customerHtml,
                    text: `¡Gracias por tu compra!\n\nTu número de pedido es: #${numeroDisplay}\nID Pago MercadoPago: ${paymentInfo.id}\nMonto: $${paymentInfo.transaction_amount} ARS\n\nTe contactaremos pronto para coordinar el retiro.\n\n-- Capri Store`
                  };

                  await transporter.sendMail(customerMailOptions);
                  console.log(`[${timestamp}] ✅ Email de confirmación enviado al cliente: ${customerEmail}`);
                }

                // EMAIL A ADMINISTRADORES
                if (process.env.ADMIN_EMAILS) {
                  const adminEmails = process.env.ADMIN_EMAILS.split(',').map(email => email.trim());
                  const adminHtml = createAdminEmailTemplate(
                    {
                      nombre: customerData.nombre || paymentInfo.payer?.first_name || 'Cliente',
                      apellido: customerData.apellido || paymentInfo.payer?.last_name || '',
                      email: customerData.email || paymentInfo.payer?.email || 'No disponible',
                      telefono: customerData.telefono || 'No disponible'
                    },
                    orderData,
                    paymentInfo
                  );

                  const adminMailOptions = {
                    from: {
                      name: 'Capri Store Sistema',
                      address: process.env.SMTP_FROM || process.env.SMTP_USER
                    },
                    to: adminEmails.join(','),
                    subject: `🛍️ Nueva Venta #${numeroDisplay} - $${paymentInfo.transaction_amount} ARS`,
                    html: adminHtml,
                    text: `Nueva venta recibida!\n\nPedido: #${numeroDisplay}\nCliente: ${customerData.nombre || ''} ${customerData.apellido || ''}\nEmail: ${customerData.email || paymentInfo.payer?.email}\nTeléfono: ${customerData.telefono}\nTotal: $${paymentInfo.transaction_amount} ARS\n\nID Pago MP: ${paymentInfo.id}`
                  };

                  await transporter.sendMail(adminMailOptions);
                  console.log(`[${timestamp}] ✅ Email de notificación enviado a administradores: ${adminEmails.join(', ')}`);
                }

                // Marcar como enviado para evitar duplicados
                emailSentForPayment.add(paymentId);
              }
            } catch (mailError) {
              console.error(`[${timestamp}] ❌ Error enviando emails:`, mailError.message);
            }
          }
          console.log(`[${timestamp}] Pago ${paymentId} procesado correctamente`);
        }
      } else {
        console.log(`[${timestamp}] Pago ${paymentId} no aprobado (estado: ${paymentInfo.status})`);
      }
    } else {
      console.log(`[${timestamp}] Webhook recibido sin paymentId válido`);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[${timestamp}] Error en webhook:`, error);
    res.status(500).send('Error interno del servidor');
  }
});

// ===============================
// ENDPOINT: STATUS DEL WEBHOOK
// ===============================
app.get('/webhook-status/:paymentId', (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  const { paymentId } = req.params;
  const processed = webhookNotifications.has(paymentId);
  
  res.json({ processed, payment_id: paymentId });
});

// ===============================
// ENDPOINT PRINCIPAL: CONSULTAR PEDIDO POR MP_PAYMENT_ID
// ===============================
app.get('/numero-pedido/:paymentId', async (req, res) => {
  // Headers CORS explícitos
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  
  const { paymentId } = req.params;
  
  // Intentar hasta MAX_TRIES veces esperando entre intentos (para dar tiempo al webhook)
  const MAX_TRIES = 3;
  const RETRY_DELAY_MS = 2000; // 2 segundos
  let intento = 0;
  let pedidoEncontrado = null;
  
  try {
    while (intento < MAX_TRIES && !pedidoEncontrado) {
      intento++;
      
      
      try {
        const pedidoResult = await executeQueryWithRetry(
          pool,
          'SELECT p.id_pedido, p.pedido_fecha, p.pedido_nombre_cliente, p.pedido_monto_total, p.mp_payment_id FROM productos p WHERE (p.mp_payment_id = $1 OR p.mp_payment_id = $2) AND p.id_pedido IS NOT NULL AND p.id_pedido != \'\' ORDER BY p.pedido_fecha DESC LIMIT 1',
          [paymentId, paymentId.toString()],
          2
        );
        
        if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
          pedidoEncontrado = pedidoResult.rows[0];
          break;
        }
      } catch (err) {
        console.error(`⚠️ Error al consultar pedido (intento ${intento}):`, err.message);
      }
      
      if (!pedidoEncontrado && intento < MAX_TRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    
    if (pedidoEncontrado) {
      const numeroDisplay = pedidoEncontrado.id_pedido && pedidoEncontrado.id_pedido.length >= 2 ? 
        pedidoEncontrado.id_pedido.slice(-2) : pedidoEncontrado.id_pedido;
      
      
      res.json({
        success: true,
        pedido_encontrado: true,
        numero_pedido: pedidoEncontrado.id_pedido,
        numero_display: numeroDisplay,
        fecha: pedidoEncontrado.pedido_fecha,
        cliente: pedidoEncontrado.pedido_nombre_cliente,
        monto: pedidoEncontrado.pedido_monto_total,
        payment_id: paymentId
      });
    } else {
      console.warn(`⚠️ Pedido no encontrado para payment_id: ${paymentId} después de ${MAX_TRIES} intentos`);
      
      res.json({
        success: false,
        pedido_encontrado: false,
        numero_pedido: null,
        message: 'Pedido no encontrado. Es posible que aún se esté procesando.',
        payment_id: paymentId,
        intentos_realizados: MAX_TRIES
      });
    }
  } catch (error) {
    console.error('❌ Error en /numero-pedido:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      payment_id: paymentId
    });
  }
});

// ===============================
// ENDPOINT: OBTENER STOCK DE PRODUCTO ESPECÍFICO
// ===============================
app.get('/stock-producto/:id', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ ok: false, error: 'ID de producto requerido' });
    }

    // Primero obtener los datos del producto base (prenda, color, talle)
    const productQuery = `
      SELECT prenda, color, talle 
      FROM productos 
      WHERE id_articulo = $1 
      LIMIT 1
    `;
    
    const productResult = await executeQueryWithRetry(pool, productQuery, [parseInt(id)], 2);
    
    if (!productResult.rows || productResult.rows.length === 0) {
      return res.json({ ok: true, stock: 0, disponible: false, producto_no_encontrado: true });
    }

    const { prenda, color, talle } = productResult.rows[0];

    // Ahora contar todos los productos con la misma combinación prenda+color+talle que estén disponibles
    const stockQuery = `
      SELECT COUNT(*) as stock_total
      FROM productos 
      WHERE prenda = $1 
        AND color = $2 
        AND talle = $3 
        AND estado = 'Disponible'
    `;
    
    const stockResult = await executeQueryWithRetry(
      pool, 
      stockQuery, 
      [prenda, color, talle], 
      2
    );

    const stockTotal = parseInt(stockResult.rows[0]?.stock_total || 0);
    
    res.json({
      ok: true,
      stock: stockTotal,
      disponible: stockTotal > 0,
      prenda,
      color,
      talle,
      producto_id: id
    });

  } catch (error) {
    console.error('❌ Error en /stock-producto:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error interno del servidor',
      message: error.message 
    });
  }
});

// ===============================
// ENDPOINT DE EMERGENCIA: PROCESAR PAGO MANUAL
// ===============================
app.post('/procesar-pago-manual/:paymentId', async (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Type', 'application/json; charset=utf-8');
  
  const { paymentId } = req.params;
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] 🚨 PROCESAMIENTO MANUAL para pago: ${paymentId}`);
  
  try {
    // Simular el procesamiento del webhook manualmente
    const payment = new Payment(client);
    const paymentInfo = await payment.get({ id: paymentId });
    
    console.log(`[${timestamp}] 📋 Info del pago:`, JSON.stringify(paymentInfo, null, 2));
    
    if (paymentInfo.status === 'approved') {
      // Extraer información del external_reference
      let customerData = {};
      try {
        if (paymentInfo.external_reference) {
          customerData = JSON.parse(paymentInfo.external_reference);
        }
      } catch (error) {}
      
      let productIds = '';
      const items = paymentInfo.additional_info?.items || [];
      if (items.length > 0) {
        productIds = (items.map(item => item.id).filter(Boolean) || []).join(',');
      }
      if (!productIds) productIds = 'MANUAL';
      
      // Crear pedido en la base de datos
      try {
        const spParams = [
          productIds,
          paymentInfo.transaction_amount,
          `${customerData.nombre || ''} ${customerData.apellido || ''}`.trim() || paymentInfo.payer?.first_name || 'Cliente Web',
          customerData.email || paymentInfo.payer?.email || 'cliente@web.com',
          customerData.telefono || '',
          'MercadoPago',
          'Retiro',
          paymentId
        ];
        
        console.log(`[${timestamp}] 🔧 Ejecutando sp_crear_pedido_web (manual) con parámetros:`);
        console.log(`[${timestamp}]   - IDs productos: ${spParams[0]}`);
        console.log(`[${timestamp}]   - Monto: $${spParams[1]} ARS`);
        console.log(`[${timestamp}]   - Cliente: ${spParams[2]}`);
        console.log(`[${timestamp}]   - Email: ${spParams[3]}`);
        console.log(`[${timestamp}]   - Teléfono: ${spParams[4]}`);
        console.log(`[${timestamp}]   - Payment ID: ${spParams[7]}`);
        
        await executeQueryWithRetry(
          pool,
          'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
          spParams
        );
        
        console.log(`[${timestamp}] ✅ Pedido creado manualmente para pago ${paymentId}`);
        
        res.json({
          success: true,
          message: 'Pago procesado manualmente',
          payment_id: paymentId,
          status: paymentInfo.status
        });
        
      } catch (dbError) {
        console.error(`[${timestamp}] ❌ Error creando pedido manual:`, dbError);
        res.status(500).json({
          success: false,
          error: 'Error creando pedido en base de datos',
          payment_id: paymentId
        });
      }
      
    } else {
      res.json({
        success: false,
        message: `Pago no aprobado. Estado: ${paymentInfo.status}`,
        payment_id: paymentId,
        status: paymentInfo.status
      });
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error procesando pago manual:`, error);
    res.status(500).json({
      success: false,
      error: 'Error procesando pago manual',
      message: error.message,
      payment_id: paymentId
    });
  }
});

// ===============================
// ENDPOINTS BÁSICOS
// ===============================

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime() 
  });
});

// Endpoint para probar configuración de email
app.get('/test-email-config', async (req, res) => {
  const timestamp = new Date().toISOString();
  
  try {
    if (!transporter) {
      return res.json({
        status: 'ERROR',
        message: 'Transporter no configurado',
        smtp_configured: false,
        env_vars: {
          SMTP_USER: !!process.env.SMTP_USER,
          SMTP_PASS: !!process.env.SMTP_PASS,
          SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com (default)',
          SMTP_PORT: process.env.SMTP_PORT || '587 (default)',
          ADMIN_EMAILS: !!process.env.ADMIN_EMAILS
        }
      });
    }
    
    console.log(`[${timestamp}] 🧪 Probando configuración de email...`);
    
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout verificando conexión')), 15000)
      )
    ]);
    
    console.log(`[${timestamp}] ✅ Configuración de email OK`);
    
    res.json({
      status: 'OK',
      message: 'Configuración de email funcionando correctamente',
      smtp_configured: true,
      connection_verified: true,
      env_vars: {
        SMTP_USER: !!process.env.SMTP_USER,
        SMTP_PASS: !!process.env.SMTP_PASS,
        SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com (default)',
        SMTP_PORT: process.env.SMTP_PORT || '587 (default)',
        ADMIN_EMAILS: !!process.env.ADMIN_EMAILS
      }
    });
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error probando email:`, error.message);
    
    res.json({
      status: 'ERROR',
      message: 'Error en configuración de email',
      smtp_configured: true,
      connection_verified: false,
      error: error.message,
      env_vars: {
        SMTP_USER: !!process.env.SMTP_USER,
        SMTP_PASS: !!process.env.SMTP_PASS,
        SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com (default)',
        SMTP_PORT: process.env.SMTP_PORT || '587 (default)',
        ADMIN_EMAILS: !!process.env.ADMIN_EMAILS
      }
    });
  }
});

// Manejo de errores global
app.use((error, req, res, next) => {
  console.error('� Error global capturado:', error);
  res.status(500).json({ 
    error: 'Error interno del servidor', 
    message: error.message,
    timestamp: new Date().toISOString() 
  });
});

// ===============================
// SERVIDOR HTTP
// ===============================
const PORT = process.env.PORT || 3000;

let server;

// Inicializar la aplicación
async function startServer() {
  try {
    await initializeDatabase();
    server = app.listen(PORT, () => {
      console.log(`🚀 Capri Store API escuchando en puerto ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
}

// === ENDPOINT DE CONTACTO ===
app.post('/contact', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📧 Solicitud de contacto recibida`);
  
  try {
    const { nombre, email, mensaje } = req.body;
    
    // Validar datos requeridos
    if (!nombre || !email || !mensaje) {
      console.log(`[${timestamp}] ❌ Datos faltantes en formulario de contacto`);
      return res.status(400).json({
        success: false,
        error: 'Todos los campos son requeridos'
      });
    }
    
    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log(`[${timestamp}] ❌ Email inválido: ${email}`);
      return res.status(400).json({
        success: false,
        error: 'Formato de email inválido'
      });
    }
    
    // Solo proceder si el transporter está configurado
    if (!transporter) {
      console.log(`[${timestamp}] ⚠️ Transporter no configurado - email no disponible`);
      
      return res.status(503).json({
        success: false,
        error: 'Sistema de email temporalmente no disponible. Por favor contáctanos por teléfono: +54 9 11 1234 5678'
      });
    }
    
    // No necesitamos verificar conexión aquí, ya se verificó al inicio
    // Si el transporter funciona para webhooks, funcionará para contacto
    
    // Crear email para administradores
    const adminSubject = `Nueva consulta de ${nombre}`;
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #6b0a0a 0%, #8b1538 100%); color: white; padding: 20px; text-align: center;">
          <h2>💌 Nueva Consulta - Capri Store</h2>
        </div>
        
        <div style="padding: 30px; background: #f8f9fa;">
          <h3 style="color: #6b0a0a; margin-bottom: 20px;">Información del Cliente:</h3>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #e29ca3;">
            <p style="margin: 10px 0;"><strong>Nombre:</strong> ${nombre}</p>
            <p style="margin: 10px 0;"><strong>Email:</strong> ${email}</p>
          </div>
          
          <h3 style="color: #6b0a0a; margin-bottom: 15px;">Mensaje:</h3>
          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #6b0a0a;">
            <p style="line-height: 1.6; margin: 0;">${mensaje}</p>
          </div>
          
          <div style="margin-top: 30px; text-align: center;">
            <a href="mailto:${email}" style="background: #6b0a0a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Responder al Cliente
            </a>
          </div>
        </div>
        
        <div style="background: #6b0a0a; color: white; padding: 15px; text-align: center; font-size: 12px;">
          <p>© 2024 Capri Store - Sistema de Contacto Automático</p>
        </div>
      </div>
    `;
    
    let adminEmailSent = false;
    let clientEmailSent = false;
    
    try {
      // Enviar email a administradores con timeout
      const adminMailOptions = {
        from: {
          name: 'Capri Store - Sistema',
          address: process.env.SMTP_FROM || process.env.SMTP_USER
        },
        to: process.env.ADMIN_EMAILS || process.env.SMTP_USER,
        subject: adminSubject,
        html: adminHtml
      };
      
      await transporter.sendMail(adminMailOptions);
      
      console.log(`[${timestamp}] ✅ Email de consulta enviado a administradores`);
      adminEmailSent = true;
      
    } catch (emailError) {
      console.error(`[${timestamp}] ❌ Error enviando email de administradores:`, emailError.message);
      
      // Si falla el email de admin, fallar inmediatamente
      return res.status(500).json({
        success: false,
        error: 'Error enviando el mensaje. Por favor intenta más tarde o contáctanos por teléfono: +54 9 11 1234 5678'
      });
    }
    
    try {
      // Enviar confirmación al cliente
      const clientSubject = `Gracias por contactarnos, ${nombre}`;
      const clientHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #6b0a0a 0%, #8b1538 100%); color: white; padding: 20px; text-align: center;">
            <h2>✉️ Mensaje Recibido - Capri Store</h2>
          </div>
          
          <div style="padding: 30px; background: #f8f9fa;">
            <h3 style="color: #6b0a0a;">¡Hola ${nombre}!</h3>
            
            <p style="line-height: 1.6; color: #333;">
              Gracias por contactarnos. Hemos recibido tu mensaje y nuestro equipo te responderá a la brevedad.
            </p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #e29ca3;">
              <h4 style="color: #6b0a0a; margin-top: 0;">Tu mensaje:</h4>
              <p style="color: #555; line-height: 1.6; margin-bottom: 0;">${mensaje}</p>
            </div>
            
            <p style="line-height: 1.6; color: #333;">
              Mientras tanto, puedes seguir explorando nuestros productos en 
              <a href="https://capristorezte.com.ar" style="color: #6b0a0a;">capristorezte.com.ar</a>
            </p>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="https://capristorezte.com.ar" style="background: #6b0a0a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Ver Productos
              </a>
            </div>
          </div>
          
          <div style="background: #6b0a0a; color: white; padding: 15px; text-align: center; font-size: 12px;">
            <p>© 2024 Capri Store - Zárate, Buenos Aires</p>
            <p>📧 contacto@capristore.com.ar | 📱 +54 9 11 1234 5678</p>
          </div>
        </div>
      `;
      
      const clientMailOptions = {
        from: {
          name: 'Capri Store',
          address: process.env.SMTP_FROM || process.env.SMTP_USER
        },
        to: email,
        subject: clientSubject,
        html: clientHtml
      };
      
      await transporter.sendMail(clientMailOptions);
      
      console.log(`[${timestamp}] ✅ Email de confirmación enviado al cliente: ${email}`);
      clientEmailSent = true;
      
    } catch (emailError) {
      console.error(`[${timestamp}] ❌ Error enviando email al cliente:`, emailError.message);
      
      // Si falla el email del cliente, también fallar la operación completa
      return res.status(500).json({
        success: false,
        error: 'Error enviando confirmación. Por favor intenta más tarde o contáctanos por teléfono: +54 9 11 1234 5678'
      });
    }
    
    // Solo responder éxito si ambos emails se enviaron correctamente
    if (adminEmailSent && clientEmailSent) {
      res.json({
        success: true,
        message: 'Mensaje enviado exitosamente. Te responderemos pronto.'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Error enviando el mensaje. Por favor intenta más tarde o contáctanos por teléfono: +54 9 11 1234 5678'
      });
    }
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en endpoint de contacto:`, error);
    res.status(500).json({
      success: false,
      error: 'Error temporal del servicio. Por favor intenta más tarde o contáctanos por teléfono.'
    });
  }
});

// Manejo de cierre del servidor
process.on('SIGTERM', () => {
  console.log('📴 Recibida señal SIGTERM, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado exitosamente');
  });
});

process.on('SIGINT', () => {
  console.log('📴 Recibida señal SIGINT, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado exitosamente');
  });
});

// Iniciar el servidor
startServer();
