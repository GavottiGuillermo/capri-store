const express = require('express');
const path = require('path');

const db = require('../db');
const mpService = require('../services/mercadopago');
const whatsappBusiness = require('../services/whatsapp');
const whatsappApiService = require('../whatsapp-api-service');

const router = express.Router();

const PORT = process.env.PORT || 3000;
const BUSINESS_NAME = whatsappBusiness.BUSINESS_NAME;

// Almacén en memoria para notificaciones de webhook ya procesados
const webhookNotifications = new Map();

function cleanupOldWebhookNotifications() {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  let cleaned = 0;
  for (const [key, timestamp] of webhookNotifications.entries()) {
    if (typeof timestamp === 'number' && timestamp < oneHourAgo) {
      webhookNotifications.delete(key);
      cleaned++;
    } else if (typeof timestamp !== 'number') {
      webhookNotifications.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Limpiadas ${cleaned} notificaciones webhook antiguas`);
  }
  return cleaned;
}

// Endpoint básico de prueba
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'index.html'));
});

// Endpoint de texto plano para verificar que el servidor funciona
router.get('/test', (req, res) => {
  res.send('Servidor funcionando correctamente!');
});

// === ENDPOINT DE SALUD ===
router.get('/health', async (req, res) => {
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();

  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsapp_api: apiStatus.configured ? 'configured' : 'not_configured',
    business_name: BUSINESS_NAME,
    env_vars: {
      admin_whatsapp: !!process.env.ADMIN_WHATSAPP,
      admin_instagram: !!process.env.ADMIN_INSTAGRAM,
      mercadopago_token: !!process.env.MERCADOPAGO_ACCESS_TOKEN,
      render_instance_id: process.env.RENDER_INSTANCE_ID || 'local'
    },
    deployment: {
      simplified: true,
      single_instance: true,

    },
    keep_alive_info: {
      no_db_queries: true,
      auto_reconnect: 'Deshabilitado desde keep-alive para ahorrar recursos Neon',
      reconnect_trigger: 'WhatsApp se reconecta automáticamente en nuevas ventas'
    }
  });
});

// === ENDPOINT DE SALUD SILENCIOSO (para keep-alive) ===
router.get('/ping', async (req, res) => {
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    whatsapp_api_ready: apiStatus.configured
  });
});

// ===============================
// ENDPOINT PARA KEEP-ALIVE CON MENSAJE WHATSAPP
// ===============================
router.get('/whatsapp-keep-alive', async (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 💚 Keep-Alive ejecutándose (solo API)...`);

  try {
    // Verificar estado de WhatsApp API
    const apiStatus = whatsappApiService.getWhatsAppApiStatus();
    console.log(`[${timestamp}] 📊 Estado WhatsApp API:`, apiStatus);

    // Procesar notificaciones pendientes
    let pendientesProcessed = false;
    if (apiStatus.configured) {
      console.log(`[${timestamp}] 📦 Procesando notificaciones pendientes...`);
      try {
        await whatsappBusiness.procesarNotificacionesPendientes();
        pendientesProcessed = true;
        console.log(`[${timestamp}] ✅ Notificaciones pendientes procesadas`);
      } catch (pendientesErr) {
        console.error(`[${timestamp}] ❌ Error procesando pendientes:`, pendientesErr.message);
      }
    } else {
      console.log(`[${timestamp}] ⏭️ Saltando procesamiento de pendientes (API no configurada)`);
    }

    // Garbage collection
    if (global.gc) {
      console.log(`[${timestamp}] 🧹 Ejecutando garbage collection...`);
      global.gc();
    }

    res.json({
      success: true,
      timestamp,
      whatsapp_api: apiStatus.configured ? 'configured' : 'not_configured',
      api_status: apiStatus,
      pendientes_processed: pendientesProcessed,
      gc_available: Boolean(global.gc)
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en keep-alive:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp
    });
  }
});

// === ESTADO WHATSAPP ===
router.get('/whatsapp-status', async (req, res) => {
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();
  res.json({
    mode: 'api_only',
    whatsapp_api: apiStatus,
    timestamp: new Date().toISOString()
  });
});

// === PRUEBA DE PLANTILLA WHATSAPP CLOUD API ===
router.post('/whatsapp-test-template', async (req, res) => {
  const timestamp = new Date().toISOString();

  try {
    const whatsappApiStatus = whatsappApiService.getWhatsAppApiStatus();
    const useCloudApi = whatsappApiService.shouldUseWhatsAppApi();
    const templateName = process.env.WHATSAPP_API_TEMPLATE_NAME;
    const templateLanguage = process.env.WHATSAPP_API_TEMPLATE_LANGUAGE || 'es';

    if (!useCloudApi) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp Cloud API no habilitada o mal configurada',
        status: whatsappApiStatus
      });
    }

    if (!templateName) {
      return res.status(400).json({
        success: false,
        error: 'Falta WHATSAPP_API_TEMPLATE_NAME en variables de entorno'
      });
    }

    const toRaw = req.body?.to || req.body?.telefono || req.body?.numero || process.env.ADMIN_WHATSAPP;
    const to = whatsappBusiness.normalizePhoneNumber(String(toRaw || '').trim());
    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Número destino inválido. Envía { "to": "549..." } o configura ADMIN_WHATSAPP'
      });
    }

    const requestParameters = Array.isArray(req.body?.parameters) ? req.body.parameters : null;

    const nombreRaw = requestParameters?.[0] ?? req.body?.nombre ?? 'Guillermo';
    const pedidoRaw = requestParameters?.[1] ?? req.body?.pedido ?? '07';
    const fechaRaw = requestParameters?.[2] ?? req.body?.fecha ?? new Date().toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    const totalRaw = requestParameters?.[3] ?? req.body?.total ?? '$69.000';
    const productosRaw = requestParameters?.[4] ?? req.body?.productos ??
      '* Spicy\n* Vestido valen\n* Musculosa escote V\n* Mini short flecos'

    const nombre = whatsappBusiness.sanitizeTemplateText(nombreRaw, 'Guillermo');
    const pedido = whatsappBusiness.sanitizeTemplateText(pedidoRaw, '07');
    const fecha = whatsappBusiness.sanitizeTemplateText(fechaRaw);
    const total = whatsappBusiness.formatTemplateTotal(totalRaw, '$69.000');
    const productos = whatsappBusiness.normalizeProductsForTemplate(productosRaw, 'Spicy, Vestido valen, Musculosa escote V, Mini short flecos');

    const parametros = [nombre, pedido, fecha, total, productos];

    console.log(`[${timestamp}] 🧪 Enviando plantilla de prueba vía Cloud API a ${to}`);
    console.log(`[${timestamp}] 🧪 Plantilla: ${templateName} (${templateLanguage})`);

    const resultado = await whatsappApiService.sendWhatsAppApiTemplateMessage(
      to,
      templateName,
      templateLanguage,
      parametros,
      { test: true }
    );

    // Log detallado de error si falla
    if (!resultado.success) {
      console.error(`[${timestamp}] ❌ WhatsApp Cloud API error detail:`, JSON.stringify(resultado, null, 2));
    }

    let pedidoUpdate = null;
    const paymentIdToUpdate = req.body?.paymentId || req.body?.payment_id || req.body?.mp_payment_id || req.body?.id_pago;
    if (resultado.success && paymentIdToUpdate) {
      await whatsappBusiness.actualizarEstadoWhatsApp(paymentIdToUpdate, true);
      pedidoUpdate = {
        payment_id: db.normalizePaymentId(paymentIdToUpdate),
        whatsapp_notificado: 'True'
      };
    }

    return res.status(resultado.success ? 200 : 500).json({
      success: resultado.success,
      template_name: templateName,
      template_language: templateLanguage,
      to,
      parametros,
      resultado,
      pedido_update: pedidoUpdate,
      error_detail: resultado.details || resultado.error || null
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en /whatsapp-test-template: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// === ENDPOINT DEPRECADO - YA NO SE USA QR ===
router.get('/whatsapp-regenerar-qr', async (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Endpoint deprecado',
    message: 'Este sistema ahora usa WhatsApp Cloud API exclusivamente. No se requiere conexión QR.',
    api_status: whatsappApiService.getWhatsAppApiStatus(),
    instructions: [
      '☁️ Este sistema ahora usa WhatsApp Cloud API',
      '📊 Verifica /whatsapp-status para ver el estado de la API',
      '⚙️ Configura las variables: WHATSAPP_API_PHONE_NUMBER_ID, WHATSAPP_API_TOKEN, USE_WHATSAPP_API=true'
    ]
  });
});

// === MONITOR DE MEMORIA ===
router.get('/memory-status', (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const mbUsed = Math.round(memUsage.heapUsed / 1024 / 1024);
    const mbTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
    const mbRss = Math.round(memUsage.rss / 1024 / 1024);
    const mbExternal = Math.round(memUsage.external / 1024 / 1024);

    // Render free tier tiene 512MB de límite
    const renderLimit = 512;
    const usagePercent = Math.round((mbRss / renderLimit) * 100);

    // Auto-limpieza si el uso está muy alto
    if (usagePercent >= 85 && whatsappService && whatsappService.limpiarMemoriaProactiva) {
      console.log(`🚨 Uso de memoria alto (${usagePercent}%) - Activando limpieza automática`);
      whatsappService.limpiarMemoriaProactiva();
    }

    const status = {
      memory_usage: {
        heap_used_mb: mbUsed,
        heap_total_mb: mbTotal,
        rss_mb: mbRss,
        external_mb: mbExternal,
        usage_percent: usagePercent
      },
      limits: {
        render_limit_mb: renderLimit,
        warning_threshold: 85,  // Reducido de 90 a 85
        critical_threshold: 95
      },
      alerts: {
        memory_warning: usagePercent > 90,
        memory_critical: usagePercent > 95
      },
      timestamp: new Date().toISOString()
    };

    // Log si estamos cerca del límite
    if (usagePercent > 80) {
      console.warn(`⚠️ Uso de memoria alto: ${usagePercent}% (${mbRss}MB/${renderLimit}MB)`);
    }

    res.json(status);

  } catch (error) {
    console.error('❌ Error obteniendo estado de memoria:', error);
    res.status(500).json({
      error: 'Error obteniendo memoria',
      timestamp: new Date().toISOString()
    });
  }
});

// === LIMPIEZA MANUAL DE MEMORIA ===
router.post('/cleanup-memory', (req, res) => {
  try {
    console.log('🧹 Limpieza manual de memoria solicitada desde:', req.ip);

    if (whatsappService && whatsappService.limpiarMemoriaProactiva) {
      whatsappService.limpiarMemoriaProactiva();

      // Esperar un momento y obtener nueva información de memoria
      setTimeout(() => {
        const memUsage = process.memoryUsage();
        const mbRss = Math.round(memUsage.rss / 1024 / 1024);
        const usagePercent = Math.round((mbRss / 512) * 100);

        res.json({
          success: true,
          message: 'Limpieza de memoria ejecutada',
          memory_after_cleanup: {
            rss_mb: mbRss,
            usage_percent: usagePercent
          },
          timestamp: new Date().toISOString()
        });
      }, 1000);
    } else {
      res.status(503).json({
        success: false,
        error: 'Servicio de limpieza no disponible'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// === DEBUG INFO ===
router.get('/debug', (req, res) => {
  res.json({
    app_name: 'Capri Store API',
    version: '4.1 - Memory Optimized',
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    uptime_seconds: Math.floor(process.uptime()),
    memory_usage: {
      heap_used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      heap_total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'
    },
    services: {
      whatsapp_api: whatsappApiService.getWhatsAppApiStatus().configured ? 'configured' : 'not_configured',
      mercadopago_configured: !!process.env.MERCADOPAGO_ACCESS_TOKEN
    },
    env_status: {
      admin_whatsapp: !!process.env.ADMIN_WHATSAPP,
      admin_instagram: !!process.env.ADMIN_INSTAGRAM,
      render_instance: process.env.RENDER_INSTANCE_ID || 'local'
    },
    deployment: {
      type: 'simplified_single_instance',
      feature_lock_removed: true,
      postgresql_sessions: true
    },
    timestamp: new Date().toISOString()
  });
});

// === INFORMACIÓN DE CONTACTO ===
router.get('/contact-info', (req, res) => {
  try {
    const contactInfo = {
      whatsapp: process.env.CONSULTAS_WHATSAPP || null, // Solo número de consultas, NUNCA el de API
      instagram: process.env.ADMIN_INSTAGRAM,
      business_name: BUSINESS_NAME,
      location: 'Zárate, Buenos Aires, Argentina'
    };

    // Log para debugging
    console.log('📄 Enviando información de contacto:', {
      whatsapp: contactInfo.whatsapp ? `${contactInfo.whatsapp.substring(0, 4)}****` : 'NO CONFIGURADO',
      instagram: contactInfo.instagram ? 'CONFIGURADO' : 'NO CONFIGURADO'
    });

    // Validar que al menos uno de los contactos esté configurado
    if (!contactInfo.whatsapp && !contactInfo.instagram) {
      console.warn('⚠️ Ninguna variable de contacto está configurada');
      return res.status(500).json({
        error: 'No hay información de contacto configurada',
        message: 'Variables de entorno ADMIN_WHATSAPP, ADMIN_INSTAGRAM no están configuradas'
      });
    }

    res.json(contactInfo);
  } catch (error) {
    console.error('❌ Error en endpoint /contact-info:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// === STOCK AGOTADO ===
router.get('/stock-agotado', async (req, res) => {
  try {
    console.log('📦 Solicitando stock agotado...');

    // Si no hay base de datos, retornar array vacío
    if (!db.pool) {
      console.warn('⚠️ Base de datos no disponible - retornando stock vacío');
      return res.json({ ids: [] });
    }

    // Consultar productos que NO están disponibles
    // Según la estructura de la tabla: estado != 'Disponible' significa agotado/vendido/reservado
    const result = await db.pool.query(`
      SELECT id_articulo
      FROM ${db.PRODUCTOS_TABLE}
      WHERE estado IS NULL OR estado != 'Disponible'
      ORDER BY id_articulo
    `);

    const ids = result.rows.map(row => row.id_articulo);

    console.log(`✅ Stock agotado: ${ids.length} productos no disponibles`);

    res.json({ ids });

  } catch (error) {
    console.error('❌ Error obteniendo stock agotado:', error.message);
    console.error('Stack trace:', error.stack);

    // En caso de error, retornar array vacío en lugar de fallar
    res.json({ ids: [] });
  }
});

// === STOCK DE PRODUCTO ESPECÍFICO ===
router.get('/stock-producto/:id', async (req, res) => {
  try {
    const idArticulo = parseInt(req.params.id, 10);
    console.log(`📦 Consultando stock del producto ID: ${idArticulo}`);

    // Validar que el ID sea un número válido
    if (isNaN(idArticulo)) {
      console.error('❌ ID de artículo inválido:', req.params.id);
      return res.status(400).json({
        error: 'ID de artículo inválido',
        disponible: false,
        stock: 0
      });
    }

    // Si no hay base de datos, asumir que está disponible (modo degradado)
    if (!db.pool) {
      console.warn('⚠️ Base de datos no disponible - retornando disponible por defecto');
      return res.json({
        disponible: true,
        stock: 1,
        estado: 'Disponible (sin verificación)'
      });
    }

    // Consultar el producto específico
    const result = await db.pool.query(`
      SELECT id_articulo, estado, publicado_en_web
      FROM ${db.PRODUCTOS_TABLE}
      WHERE id_articulo = $1
    `, [idArticulo]);

    if (result.rows.length === 0) {
      console.log(`⚠️ Producto no encontrado en BD: ${idArticulo}`);
      return res.json({
        disponible: false,
        stock: 0,
        estado: 'No encontrado'
      });
    }

    const producto = result.rows[0];
    const estadoDisponible = producto.estado === 'Disponible';
    const publicado = producto.publicado_en_web === 'True' || producto.publicado_en_web === true;

    // El producto está disponible si su estado es "Disponible"
    const disponible = estadoDisponible && publicado;
    const stock = disponible ? 1 : 0; // Asumimos stock de 1 unidad si está disponible

    console.log(`✅ Producto ${idArticulo} - Estado: ${producto.estado}, Publicado: ${publicado}, Disponible: ${disponible}`);

    res.json({
      disponible,
      stock,
      estado: producto.estado
    });

  } catch (error) {
    console.error('❌ Error consultando stock del producto:', error.message);
    console.error('Stack trace:', error.stack);

    // En caso de error, retornar no disponible por seguridad
    res.status(500).json({
      disponible: false,
      stock: 0,
      error: 'Error al consultar stock'
    });
  }
});

// === VARIANTES DE UN PRODUCTO (COLOR + TALLE AGRUPADOS) ===
// Dado un id_articulo cualquiera, busca su "prenda" y devuelve todas las
// filas relacionadas (mismo nombre de prenda) agrupadas por color y talle,
// indicando el stock disponible de cada combinación y los id_articulo
// puntuales que se pueden vender para esa combinación.
router.get('/variantes-producto/:id', async (req, res) => {
  try {
    const idArticulo = parseInt(req.params.id, 10);
    console.log(`🎨 Consultando variantes del producto ID: ${idArticulo}`);

    if (isNaN(idArticulo)) {
      console.error('❌ ID de artículo inválido:', req.params.id);
      return res.status(400).json({
        error: 'ID de artículo inválido',
        prenda: null,
        variantes: []
      });
    }

    if (!db.pool) {
      console.warn('⚠️ Base de datos no disponible - retornando sin variantes');
      return res.json({
        prenda: null,
        variantes: []
      });
    }

    // 1. Obtener la prenda (nombre) del producto de referencia
    const refResult = await db.pool.query(`
      SELECT prenda
      FROM ${db.PRODUCTOS_TABLE}
      WHERE id_articulo = $1
    `, [idArticulo]);

    if (refResult.rows.length === 0) {
      console.log(`⚠️ Producto no encontrado en BD: ${idArticulo}`);
      return res.json({
        prenda: null,
        variantes: []
      });
    }

    const prenda = refResult.rows[0].prenda;

    // 2. Traer todas las filas (todos los colores/talles) de esa misma prenda
    //    publicadas en la web. publicado_en_web se guarda como texto ('True'/'False').
    const result = await db.pool.query(`
      SELECT id_articulo, color, talle, estado, publicado_en_web
      FROM ${db.PRODUCTOS_TABLE}
      WHERE prenda = $1
      ORDER BY color, talle, id_articulo
    `, [prenda]);

    // 3. Agrupar por color -> talle, contando solo filas Disponible y publicadas
    const coloresMap = new Map();

    result.rows.forEach(row => {
      const publicado = row.publicado_en_web === 'True' || row.publicado_en_web === true;
      if (!publicado) return;

      const color = row.color || 'Sin color';
      const talle = row.talle || 'Único';
      const disponible = row.estado === 'Disponible';

      if (!coloresMap.has(color)) {
        coloresMap.set(color, new Map());
      }
      const tallesMap = coloresMap.get(color);

      if (!tallesMap.has(talle)) {
        tallesMap.set(talle, { talle, stock: 0, ids: [] });
      }
      if (disponible) {
        const entradaTalle = tallesMap.get(talle);
        entradaTalle.stock += 1;
        entradaTalle.ids.push(row.id_articulo);
      }
    });

    const variantes = Array.from(coloresMap.entries()).map(([color, tallesMap]) => ({
      color,
      talles: Array.from(tallesMap.values())
    }));

    console.log(`✅ Variantes de "${prenda}": ${variantes.length} colores`);

    res.json({
      prenda,
      variantes
    });

  } catch (error) {
    console.error('❌ Error consultando variantes del producto:', error.message);
    console.error('Stack trace:', error.stack);

    res.status(500).json({
      error: 'Error al consultar variantes',
      prenda: null,
      variantes: []
    });
  }
});

// === VALIDAR STOCK DE CARRITO (MÚLTIPLES PRODUCTOS) ===
router.post('/validar-stock-carrito', express.json(), async (req, res) => {
  try {
    const { ids } = req.body;
    console.log(`🛒 Validando stock de carrito para ${ids?.length || 0} productos`);

    // Validar que ids sea un array válido
    if (!Array.isArray(ids) || ids.length === 0) {
      console.error('❌ IDs inválidos:', ids);
      return res.json({
        ok: false,
        error: 'IDs de productos inválidos',
        faltantes: []
      });
    }

    // Si no hay base de datos, asumir que todo está disponible (modo degradado)
    if (!db.pool) {
      console.warn('⚠️ Base de datos no disponible - asumiendo disponibilidad');
      return res.json({
        ok: true,
        faltantes: [],
        mensaje: 'Validación en modo degradado'
      });
    }

    // Consultar productos en la base de datos
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const query = `
      SELECT id_articulo, estado, publicado_en_web
      FROM ${db.PRODUCTOS_TABLE}
      WHERE id_articulo IN (${placeholders})
    `;

    const result = await db.pool.query(query, ids);

    // Productos que NO están disponibles
    const productosNoDisponibles = result.rows.filter(p =>
      p.estado !== 'Disponible' || p.publicado_en_web !== 'True'
    );

    // IDs de productos en la BD que NO están disponibles
    const idsNoDisponibles = productosNoDisponibles.map(p => p.id_articulo);

    // IDs que no se encontraron en la BD (también sin stock)
    const idsEncontrados = result.rows.map(p => p.id_articulo);
    const idsNoEncontrados = ids.filter(id => !idsEncontrados.includes(parseInt(id)));

    // Combinar: no disponibles + no encontrados
    const faltantes = [...idsNoDisponibles, ...idsNoEncontrados];

    console.log(`✅ Validación de carrito: ${ids.length} solicitados, ${faltantes.length} sin stock`);

    res.json({
      ok: true,
      faltantes,
      total_validados: ids.length,
      sin_stock: faltantes.length
    });

  } catch (error) {
    console.error('❌ Error validando stock del carrito:', error.message);
    console.error('Stack trace:', error.stack);

    // En caso de error, retornar ok pero sin faltantes para no bloquear compras
    res.json({
      ok: true,
      faltantes: [],
      error: 'Error al validar stock, asumiendo disponibilidad'
    });
  }
});

// === CREAR PREFERENCIA DE MERCADOPAGO ===
router.post('/crear-preferencia', express.json(), async (req, res) => {
  try {
    const { items, datosComprador } = req.body;
    console.log('💳 Creando preferencia de MercadoPago');
    console.log('Items:', items?.length || 0, 'productos');
    console.log('Comprador:', datosComprador?.nombre, datosComprador?.telefono);

    // Validar que haya items
    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error('❌ No hay items en la preferencia');
      return res.status(400).json({
        error: 'No hay productos en el carrito'
      });
    }

    // Validar que MercadoPago esté configurado
    if (!mpService.client) {
      console.error('❌ MercadoPago no está configurado');
      return res.status(500).json({
        error: 'Sistema de pagos no disponible'
      });
    }

    // Validar datos del comprador
    if (!datosComprador || !datosComprador.telefono) {
      console.error('❌ Datos del comprador incompletos');
      return res.status(400).json({
        error: 'Datos del comprador incompletos - Se requiere teléfono'
      });
    }

    // Normalizar teléfono del comprador y agregar +54 si falta
    let telefonoInput = String(datosComprador.telefono || '').replace(/\D/g, ''); // Solo dígitos

    // Agregar 54 (Argentina) si no está presente
    if (!telefonoInput.startsWith('54')) {
      // Si empieza con 9 (WhatsApp), agregar 54 antes
      if (telefonoInput.startsWith('9')) {
        telefonoInput = '54' + telefonoInput;
      } else {
        // Si es número local (ej: 1165031329), agregar 549
        telefonoInput = '549' + telefonoInput;
      }
      console.log('🔄 Teléfono sin código país, agregando 54:', telefonoInput);
    }

    const telefonoNormalizado = whatsappBusiness.normalizePhoneNumber(telefonoInput);
    if (!telefonoNormalizado) {
      console.error('❌ Formato de teléfono inválido:', datosComprador.telefono);
      return res.status(400).json({
        error: 'Formato de teléfono inválido. Use formato: 549 + código área + número'
      });
    }

    // Actualizar datos del comprador con teléfono normalizado
    datosComprador.telefono = telefonoNormalizado;
    console.log('📱 Teléfono comprador normalizado:', telefonoNormalizado);

    // Determinar URLs de retorno según el ambiente
    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://capristorezte.com.ar'
      : 'http://localhost:3000';

    console.log('🌐 URLs de retorno configuradas para:', baseUrl);

    // Crear la preferencia de MercadoPago
    const preference = new mpService.Preference(mpService.client);

    // Función helper para sanitizar strings (remover caracteres que pueden causar problemas con CSP)
    const sanitizeString = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/[<>]/g, '') // Remover < >
        .replace(/["'`]/g, '') // Remover comillas
        .replace(/\\/g, '') // Remover backslashes
        .replace(/[():;]/g, '') // Remover paréntesis, dos puntos
        .trim()
        .substring(0, 600); // Limitar longitud
    };

    // Separar código de país del teléfono
    // Formato MercadoPago: area_code='54', number='9 + código área + número'
    // Ejemplo: 5491165031329 -> area_code: '54', number: '91165031329'
    const telefonoStr = String(datosComprador.telefono || '').replace(/\D/g, '');
    let areaCode = '54'; // Código de país Argentina
    let phoneNumber = telefonoStr;

    // Si el teléfono ya incluye el código de país 54, separarlo
    if (telefonoStr.startsWith('54')) {
      // Remover solo '54' del inicio, dejar el resto (incluyendo el 9 de WhatsApp)
      phoneNumber = telefonoStr.substring(2); // '5491165031329' -> '91165031329'
    }

    const preferenceData = {
      items: items.map(item => ({
        id: String(item.id || 'producto').substring(0, 50),
        title: sanitizeString(item.title || item.nombre || 'Producto').substring(0, 256),
        quantity: Number(item.quantity || item.cantidad || 1),
        currency_id: 'ARS',
        unit_price: Number(item.unit_price || item.precio || 0)
      })),
      payer: {
        name: sanitizeString(datosComprador.nombre || '').substring(0, 256),
        surname: sanitizeString(datosComprador.apellido || '').substring(0, 256),
        email: datosComprador.email || `cliente${telefonoStr}@mp.com.ar`, // Email real del usuario o fallback
        phone: {
          area_code: areaCode,
          number: phoneNumber.substring(0, 15)
        }
      },
      back_urls: {
        success: `${baseUrl}/success.html`,
        failure: `${baseUrl}/failure.html`,
        pending: `${baseUrl}/pending.html`
      },
      auto_return: 'approved',
      notification_url: `https://capri-store.onrender.com/webhook`,
      // Metadata simplificado para identificación en webhook
      metadata: {
        telefono: String(datosComprador.telefono).replace(/\D/g, '').substring(0, 15),
        email: String(datosComprador.email || '').trim().toLowerCase().substring(0, 254),
        nombre: String(datosComprador.nombre || datosComprador.first_name || '').trim().substring(0, 50),
        apellido: String(datosComprador.apellido || datosComprador.last_name || '').trim().substring(0, 50)
      },
      // External reference para tracking adicional
      external_reference: `TEL${datosComprador.telefono}_${Date.now()}`
    };

    // LOG DETALLADO DE LA PREFERENCIA
    console.log('=== PREFERENCIA PARA MERCADOPAGO ===');
    console.log('📋 Total items:', preferenceData.items.length);
    preferenceData.items.forEach((item, idx) => {
      console.log(`  Item ${idx + 1}:`, JSON.stringify(item));
      // Verificar caracteres problemáticos
      const problematicos = item.title.match(/[^\x00-\x7F]/g);
      if (problematicos) {
        console.warn(`  ⚠️ Caracteres no-ASCII en item ${idx + 1}:`, problematicos);
      }
    });
    console.log('👤 Payer:', JSON.stringify(preferenceData.payer));
    console.log('🔙 Back URLs:', preferenceData.back_urls);
    console.log('📦 Metadata:', JSON.stringify(preferenceData.metadata));
    console.log('🔗 External ref:', preferenceData.external_reference);
    console.log('====================================');

    const result = await preference.create({ body: preferenceData });

    console.log('✅ Preferencia creada:', result.id);
    console.log('🔗 Init point:', result.init_point);

    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });

  } catch (error) {
    console.error('❌ Error creando preferencia:', error.message);
    console.error('Stack trace:', error.stack);

    res.status(500).json({
      error: 'Error al crear preferencia de pago',
      details: error.message
    });
  }
});

// ===============================
// ENDPOINT: WEBHOOK DE MERCADO PAGO
// ===============================
router.post('/webhook', async (req, res) => {
  const timestamp = new Date().toISOString();
  let paymentIdRaw = null;
  let paymentIdContext = null;
  let shouldProcess = false;

  console.log(`[${timestamp}] 📬 WEBHOOK RECIBIDO:`);
  // Headers omitidos para reducir logs - solo mostrar info relevante
  console.log(`[${timestamp}] User-Agent: ${req.headers['user-agent']}`);
  console.log(`[${timestamp}] Body:`, JSON.stringify(req.body, null, 2));

  try {
    const { type, data, action, topic, resource } = req.body;

    // Detectar el payment ID desde diferentes formatos de webhook
    if (type === 'payment' && data?.id) {
      paymentIdRaw = data.id;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook tipo 'payment' detectado (raw ID: ${paymentIdRaw})`);
    } else if (action === 'payment.created' && data?.id) {
      paymentIdRaw = data.id;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook action 'payment.created' detectado (raw ID: ${paymentIdRaw})`);
    } else if (topic === 'payment' && resource) {
      paymentIdRaw = resource;
      shouldProcess = true;
      console.log(`[${timestamp}] ✅ Webhook topic 'payment' detectado (resource: ${paymentIdRaw})`);
    } else {
      console.log(`[${timestamp}] ⚠️ Webhook ignorado - type: ${type}, action: ${action}, topic: ${topic}, resource: ${resource}`);
      return res.status(200).send('OK - Ignored (not payment)');
    }

    if (shouldProcess && paymentIdRaw) {
      paymentIdContext = db.buildPaymentIdContext(paymentIdRaw);
      const paymentKey = paymentIdContext?.normalized;
      if (!paymentKey) {
        console.log(`[${timestamp}] ❌ No se pudo normalizar paymentId recibido: ${paymentIdRaw}`);
        return res.status(400).send('paymentId inválido en webhook');
      }
      const [dbPaymentKey, dbPaymentFallback] = paymentIdContext.dbParams;

      // Verificar si ya existe el pedido en BD
      let pedidoExistente = null;
      try {
        const checkPedido = await db.executeQueryWithRetry(
          db.pool,
          `SELECT id_pedido FROM ${db.PRODUCTOS_TABLE} WHERE (mp_payment_id = $1 OR mp_payment_id = $2) AND id_pedido IS NOT NULL AND id_pedido != '' LIMIT 1`,
          [dbPaymentKey, dbPaymentFallback],
          2
        );
        if (checkPedido && checkPedido.rows && checkPedido.rows.length > 0) {
          pedidoExistente = checkPedido.rows[0].id_pedido;
          console.log(`[${timestamp}] ✅ Pago ${paymentKey} ya tiene pedido en BD: ${pedidoExistente} - Ignorado`);
          return res.status(200).send('OK - Already processed');
        }
      } catch (err) {
        console.error(`[${timestamp}] ⚠️ Error al verificar pedido existente:`, err.message);
      }

      // Verificar en memoria si ya se procesó
      if (webhookNotifications.has(paymentKey)) {
        console.log(`[${timestamp}] ⚠️ Pago ${paymentKey} ya procesado en memoria - Ignorado`);
        return res.status(200).send('OK - Already processed (memory)');
      }

      // Marcar como procesado en memoria
      webhookNotifications.set(paymentKey, Date.now());

      // Obtener información completa del pago de MercadoPago
      const payment = new mpService.Payment(mpService.client);
      const paymentInfo = await payment.get({ id: paymentIdContext.sdkId });

      console.log(`[${timestamp}] 💳 Estado del pago (${paymentKey}): ${paymentInfo.status}`);
      paymentInfo.normalized_payment_id = paymentKey;

      if (paymentInfo.status === 'approved') {
        // Extraer datos del comprador desde metadata o payer
        let customerData = {};
        try {
          if (paymentInfo.metadata) {
            customerData = {
              nombre: paymentInfo.metadata.nombre || paymentInfo.payer?.first_name || '',
              apellido: paymentInfo.metadata.apellido || paymentInfo.payer?.last_name || '',
              email: paymentInfo.metadata.email || paymentInfo.payer?.email || '',
              telefono: paymentInfo.metadata.telefono || paymentInfo.payer?.phone?.number || ''
            };
          }
        } catch (error) {
          console.error(`[${timestamp}] ⚠️ Error extrayendo customer data:`, error.message);
        }

        const emailCliente = customerData.email || paymentInfo.metadata?.email || paymentInfo.payer?.email || `cliente${String(customerData.telefono || '').replace(/\D/g, '')}@mp.com.ar`;

        // Extraer IDs de productos
        let productIds = '';
        const items = paymentInfo.additional_info?.items || [];
        if (items.length > 0) {
          productIds = items.map(item => item.id).filter(Boolean).join(',');
        }
        if (!productIds) productIds = 'MANUAL';

        console.log(`[${timestamp}] 📦 Productos: ${productIds}`);

        // Verificar stock de productos
        let idsArray = [];
        if (productIds !== 'MANUAL') {
          idsArray = productIds.split(',').map(id => id.trim()).filter(Boolean);
        }

        let faltantes = [];
        if (idsArray.length > 0 && db.pool) {
          try {
            const placeholders = idsArray.map((_, i) => `$${i + 1}`).join(',');
            const query = `SELECT id_articulo FROM ${db.PRODUCTOS_TABLE} WHERE id_articulo IN (${placeholders}) AND estado != 'Disponible'`;
            const result = await db.executeQueryWithRetry(db.pool, query, idsArray, 2);
            faltantes = result.rows.map(row => row.id_articulo);
          } catch (error) {
            console.error(`[${timestamp}] ⚠️ Error verificando stock:`, error.message);
            // En caso de error, asumir que todos están disponibles para no perder la venta
          }
        }

        if (faltantes.length > 0) {
          console.log(`[${timestamp}] ⚠️ Productos sin stock: ${faltantes.join(', ')}`);
          // Notificación de productos no disponibles (solo por API si está configurada)
          const apiStatus = whatsappApiService.getWhatsAppApiStatus();
          if (apiStatus.configured && process.env.ADMIN_WHATSAPP) {
            try {
              const mensaje = `⚠️ *PROBLEMA CON COMPRA*\n\n` +
                `💳 Pago ID: ${paymentKey}\n` +
                `💰 Monto: $${paymentInfo.transaction_amount}\n` +
                `📦 Productos sin stock: ${faltantes.join(', ')}\n\n` +
                `👤 Cliente: ${customerData.nombre} ${customerData.apellido}\n` +
                ` Tel: ${customerData.telefono}\n\n` +
                `⚠️ No se creó el pedido automáticamente. Revisar y contactar al cliente.`;

              await whatsappApiService.sendWhatsAppApiMessage(process.env.ADMIN_WHATSAPP, mensaje, { type: 'stock_alert' });
            } catch (whatsappError) {
              console.error(`[${timestamp}] ❌ Error enviando WhatsApp API:`, whatsappError.message);
            }
          }
        } else {
          // Crear pedido en la base de datos
          console.log(`[${timestamp}] 📝 Creando pedido en BD...`);

          try {
            // Llamar al stored procedure para crear el pedido
            await db.executeQueryWithRetry(
              db.pool,
              'CALL sp_crear_pedido_web($1, $2, $3, $4, $5, $6, $7, $8)',
              [
                productIds,
                paymentInfo.transaction_amount,
                [customerData.nombre, customerData.apellido].filter(Boolean).join(' ') || paymentInfo.payer?.first_name || 'Cliente Web',
                emailCliente,
                customerData.telefono || paymentInfo.payer?.phone?.number || '',
                'MercadoPago',
                'Retiro', // Tipo de entrega por defecto
                paymentKey
              ],
              2
            );

            // Obtener el ID del pedido creado
            const pedidoResult = await db.executeQueryWithRetry(
              db.pool,
              `SELECT id_pedido, pedido_fecha FROM ${db.PRODUCTOS_TABLE} WHERE (mp_payment_id = $1 OR mp_payment_id = $2) AND id_pedido IS NOT NULL AND id_pedido != '' ORDER BY pedido_fecha DESC LIMIT 1`,
              [dbPaymentKey, dbPaymentFallback],
              2
            );

            if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
              const { id_pedido: idPedidoCompleto, pedido_fecha: fechaPedido } = pedidoResult.rows[0];
              const numeroDisplay = idPedidoCompleto && idPedidoCompleto.length >= 2 ?
                idPedidoCompleto.slice(-2) : idPedidoCompleto;

              console.log(`[${timestamp}] ✅ Pedido creado exitosamente: ${idPedidoCompleto} (Display: ${numeroDisplay})`);
              await whatsappBusiness.actualizarEstadoWhatsApp(paymentKey, false);

              // Enviar notificación de compra por WhatsApp API
              console.log(`[${timestamp}] 📱 Intentando enviar notificación vía WhatsApp API...`);
              const apiStatus = whatsappApiService.getWhatsAppApiStatus();
              console.log(`[${timestamp}] - WhatsApp API configurada: ${apiStatus.configured}`);

              if (apiStatus.configured) {
                console.log(`[${timestamp}] ✅ WhatsApp API disponible, enviando notificación...`);
                try {
                  const notificationResult = await whatsappBusiness.enviarNotificacionCompra(
                    customerData,
                    { numeroDisplay, idPedidoCompleto, fechaPago: fechaPedido },
                    paymentInfo
                  );

                  console.log(`[${timestamp}] 📨 Resultado notificación:`, {
                    success: notificationResult.success,
                    error: notificationResult.error
                  });

                  // Actualizar estado en base de datos
                  await whatsappBusiness.actualizarEstadoWhatsApp(paymentKey, Boolean(notificationResult?.cliente_result?.success));

                } catch (whatsappError) {
                  console.error(`[${timestamp}] ❌ EXCEPCIÓN enviando notificación WhatsApp API:`, whatsappError.message);
                  console.error(`[${timestamp}] Stack trace:`, whatsappError.stack);

                  // Marcar como fallido en base de datos
                  await whatsappBusiness.actualizarEstadoWhatsApp(paymentKey, false);
                }
              } else {
                console.warn(`[${timestamp}] ⚠️ WhatsApp API no configurada - missing: ${apiStatus.missing.join(', ')}`);

                // Marcar como no enviado
                await whatsappBusiness.actualizarEstadoWhatsApp(paymentKey, false);
              }
            } else {
              console.error(`[${timestamp}] ⚠️ Pedido no encontrado después de crearlo`);
            }

          } catch (error) {
            console.error(`[${timestamp}] ❌ Error creando pedido:`, error.message);
            console.error(`[${timestamp}] Stack:`, error.stack);
          }
        }
      } else {
        console.log(`[${timestamp}] ⚠️ Pago ${paymentKey} no aprobado (estado: ${paymentInfo.status})`);
      }
    } else {
      console.log(`[${timestamp}] ⚠️ Webhook recibido sin paymentId válido`);
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en webhook:`, error.message);
    console.error(`[${timestamp}] Stack:`, error.stack);
    res.status(500).send('Error interno del servidor');
  }
});

// ===============================
// ENDPOINT: CONSULTAR NÚMERO DE PEDIDO POR PAYMENT ID
// ===============================
router.get('/numero-pedido/:paymentId', async (req, res) => {
  const { paymentId } = req.params;
  const paymentContext = db.buildPaymentIdContext(paymentId);
  const normalizedPaymentId = paymentContext.normalized;

  console.log(`🔍 Consultando número de pedido para payment ID: ${paymentId} (normalizado: ${normalizedPaymentId || 'N/A'})`);

  if (!normalizedPaymentId) {
    return res.status(400).json({
      success: false,
      error: 'paymentId inválido',
      payment_id: paymentId
    });
  }

  // Configuración de reintentos
  const MAX_TRIES = 5;
  const RETRY_DELAY_MS = 2000; // 2 segundos
  let intento = 0;
  let pedidoEncontrado = null;

  try {
    while (intento < MAX_TRIES && !pedidoEncontrado) {
      intento++;
      console.log(`🔄 Intento ${intento}/${MAX_TRIES} para payment ID: ${normalizedPaymentId}`);

      try {
        const pedidoResult = await db.executeQueryWithRetry(
          db.pool,
          `SELECT p.id_pedido, p.pedido_fecha, p.pedido_nombre_cliente, p.pedido_monto_total, p.mp_payment_id
           FROM ${db.PRODUCTOS_TABLE} p
           WHERE (p.mp_payment_id = $1 OR p.mp_payment_id = $2)
           AND p.id_pedido IS NOT NULL
           AND p.id_pedido != ''
           ORDER BY p.pedido_fecha DESC
           LIMIT 1`,
          paymentContext.dbParams,
          2
        );

        if (pedidoResult && pedidoResult.rows && pedidoResult.rows.length > 0) {
          pedidoEncontrado = pedidoResult.rows[0];
          break;
        }
      } catch (err) {
        console.error(`❌ Error al consultar pedido (intento ${intento}):`, err.message);
      }

      // Si no se encontró y quedan intentos, esperar antes de reintentar
      if (!pedidoEncontrado && intento < MAX_TRIES) {
        console.log(`⏳ Esperando ${RETRY_DELAY_MS}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    if (pedidoEncontrado) {
      const numeroDisplay = pedidoEncontrado.id_pedido && pedidoEncontrado.id_pedido.length >= 2 ?
        pedidoEncontrado.id_pedido.slice(-2) : pedidoEncontrado.id_pedido;

      console.log(`✅ Pedido encontrado: ${pedidoEncontrado.id_pedido} (Display: ${numeroDisplay})`);

      res.json({
        success: true,
        pedido_encontrado: true,
        numero_pedido: pedidoEncontrado.id_pedido,
        numero_display: numeroDisplay,
        fecha: pedidoEncontrado.pedido_fecha,
        cliente: pedidoEncontrado.pedido_nombre_cliente,
        monto: pedidoEncontrado.pedido_monto_total,
        payment_id: normalizedPaymentId
      });
    } else {
      console.warn(`⚠️ Pedido no encontrado para payment_id: ${normalizedPaymentId} después de ${MAX_TRIES} intentos`);

      res.json({
        success: false,
        pedido_encontrado: false,
        numero_pedido: null,
        message: 'Pedido no encontrado. Es posible que aún se esté procesando.',
        payment_id: normalizedPaymentId,
        intentos_realizados: MAX_TRIES
      });
    }
  } catch (error) {
    console.error('❌ Error en /numero-pedido:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      payment_id: normalizedPaymentId
    });
  }
});

// ===============================
// ENDPOINT TEMPORAL: Reintento manual de notificación WhatsApp
// ===============================
router.get('/reintento-whatsapp/:paymentId', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { paymentId } = req.params;
  const paymentContext = db.buildPaymentIdContext(paymentId);
  const normalizedPaymentId = paymentContext.normalized;

  console.log(`[${timestamp}] 🔄 === REINTENTO MANUAL WHATSAPP ===`);
  console.log(`[${timestamp}] 📱 Payment ID recibido: ${paymentId} (normalizado: ${normalizedPaymentId || 'N/A'})`);

  if (!normalizedPaymentId) {
    return res.status(400).json({
      success: false,
      error: 'paymentId inválido',
      payment_id: paymentId
    });
  }

  try {
    // Verificar estado de WhatsApp API
    const estadoWhatsApp = await whatsappBusiness.verificarEstadoWhatsAppApi();
    console.log(`[${timestamp}] 📊 Estado WhatsApp API: ${JSON.stringify(estadoWhatsApp, null, 2)}`);

    if (!estadoWhatsApp.disponible) {
      return res.json({
        success: false,
        error: `WhatsApp API no disponible: ${estadoWhatsApp.razon}`,
        estado_whatsapp: estadoWhatsApp
      });
    }

    // Buscar la compra en la BD
    const resultCompra = await db.executeQueryWithRetry(
      db.pool,
      `SELECT
        p.mp_payment_id,
        p.id_pedido,
        p.pedido_nombre_cliente,
        p.pedido_telefono_cliente,
        p.pedido_monto_total,
        p.pedido_fecha,
        p.whatsapp_notificado,
        p.estado
      FROM ${db.PRODUCTOS_TABLE} p
       WHERE p.mp_payment_id = $1 OR p.mp_payment_id = $2`,
      paymentContext.dbParams,
      2
    );

    if (!resultCompra || !resultCompra.rows || resultCompra.rows.length === 0) {
      return res.json({
        success: false,
        error: 'Compra no encontrada',
        payment_id: normalizedPaymentId
      });
    }

    const compra = resultCompra.rows[0];
    console.log(`[${timestamp}] 📦 Compra encontrada:`, {
      id_pedido: compra.id_pedido,
      cliente: compra.pedido_nombre_cliente,
      whatsapp_notificado: compra.whatsapp_notificado,
      estado: compra.estado
    });

    // Preparar datos para envío
    const customerData = {
      first_name: compra.pedido_nombre_cliente?.split(' ')[0] || 'Cliente',
      last_name: compra.pedido_nombre_cliente?.split(' ').slice(1).join(' ') || '',
      phone: {
        area_code: compra.pedido_telefono_cliente?.substring(2, 5) || '',
        number: compra.pedido_telefono_cliente?.substring(5) || ''
      }
    };

    const orderData = {
      numeroDisplay: compra.id_pedido?.slice(-2) || '??',
      idPedidoCompleto: compra.id_pedido,
      fechaPago: compra.pedido_fecha
    };

    const paymentInfo = {
      transaction_amount: compra.pedido_monto_total || 0,
      id: normalizedPaymentId,
      normalized_payment_id: normalizedPaymentId
    };

    console.log(`[${timestamp}] 📨 Intentando envío WhatsApp...`);

    // Enviar notificación
    const resultado = await whatsappBusiness.enviarNotificacionCompra(customerData, orderData, paymentInfo);

    console.log(`[${timestamp}] 📡 Resultado envío:`, {
      success: resultado.success,
      error: resultado.error
    });

    // Actualizar estado en BD
    const estadoAnterior = compra.whatsapp_notificado;
    const clienteNotificado = Boolean(resultado?.cliente_result?.success);
    await whatsappBusiness.actualizarEstadoWhatsApp(normalizedPaymentId, clienteNotificado);
    const estadoNuevo = resultado.success ? 'True' : 'False';

    console.log(`[${timestamp}] 💾 Estado actualizado: ${estadoAnterior} → ${estadoNuevo}`);

    res.json({
      success: true,
      reintento_exitoso: resultado.success,
      payment_id: normalizedPaymentId,
      id_pedido: compra.id_pedido,
      cliente: compra.pedido_nombre_cliente,
      estado_anterior: estadoAnterior,
      estado_nuevo: estadoNuevo,
      resultado_envio: resultado,
      timestamp: timestamp
    });

  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en reintento WhatsApp:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Error interno en reintento',
      message: error.message,
      payment_id: normalizedPaymentId || paymentId,
      timestamp: timestamp
    });
  }
});

// ===============================
// ENDPOINT DEPRECADO: /whatsapp-force-restart (YA NO USADO - API CLOUD)
// ===============================
router.post('/whatsapp-force-restart', async (req, res) => {
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] ⚠️ Endpoint deprecado: /whatsapp-force-restart llamado`);

  res.status(410).json({
    success: false,
    error: 'Endpoint deprecado',
    message: 'La conexión vía QR ha sido eliminada. Ahora se usa WhatsApp Cloud API.',
    migration_info: {
      old_system: 'whatsapp-web.js con código QR',
      new_system: 'WhatsApp Cloud API (graph.facebook.com)',
      no_action_needed: 'La API no requiere escaneo de QR ni reinicializaciones'
    },
    endpoint_removed: 'POST /whatsapp-force-restart',
    check_status: 'GET /whatsapp-status para ver estado de la API',
    timestamp: timestamp
  });
});

module.exports = router;
module.exports.cleanupOldWebhookNotifications = cleanupOldWebhookNotifications;
