const whatsappApiService = require('../whatsapp-api-service');
const db = require('../db');

const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP;
// Número para consultas desde la web (DEBE ser diferente al número de la API)
// IMPORTANTE: ADMIN_WHATSAPP es el número de la API Cloud (no accesible para chatear)
// CONSULTAS_WHATSAPP debe apuntar a un número real al que el cliente pueda escribir
const CONSULTAS_WHATSAPP = process.env.CONSULTAS_WHATSAPP; // NO fallback a ADMIN_WHATSAPP
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Capri Store';

// Permitir múltiples administradores: separar por coma o punto y coma
function getAdminNumbers() {
  if (!ADMIN_WHATSAPP) return [];
  if (Array.isArray(ADMIN_WHATSAPP)) return ADMIN_WHATSAPP;
  return String(ADMIN_WHATSAPP)
    .split(/[;,]/)
    .map(n => n.trim())
    .filter(Boolean);
}

// Obtener solo el primer número de admin para uso público (botón WhatsApp)
function getPrimaryAdminNumber() {
  const admins = getAdminNumbers();
  return admins.length > 0 ? admins[0] : '';
}

// Normalizar números de teléfono para WhatsApp (formato argentino)
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    console.log('🔍 Número inválido:', phone);
    return null;
  }

  // Remover todos los caracteres no numéricos
  let cleanNumber = phone.replace(/\D/g, '');
  console.log('🔍 Número limpio:', cleanNumber);

  // Si empieza con 54 (Argentina), mantenerlo
  if (cleanNumber.startsWith('54')) {
    // Si tiene 13 dígitos (549xxxxxxxxx), está correcto
    if (cleanNumber.length === 13) {
      console.log('✅ Número argentino completo:', cleanNumber);
      return cleanNumber;
    }
    // Si tiene 12 dígitos (54xxxxxxxxxx), agregar el 9
    if (cleanNumber.length === 12) {
      const normalized = '549' + cleanNumber.substring(2);
      console.log('✅ Número argentino normalizado (agregado 9):', normalized);
      return normalized;
    }
  }

  // Si empieza solo con 9 (formato local argentino 9xxxxxxxxxx)
  if (cleanNumber.startsWith('9') && cleanNumber.length === 11) {
    const normalized = '54' + cleanNumber;
    console.log('✅ Número local argentino normalizado:', normalized);
    return normalized;
  }

  // Si es número local sin 9 (xxxxxxxxxx - 10 dígitos)
  if (cleanNumber.length === 10) {
    const normalized = '549' + cleanNumber;
    console.log('✅ Número local sin 9 normalizado:', normalized);
    return normalized;
  }

  // Si ya tiene 13 dígitos pero no empieza con 54, puede ser otro formato
  if (cleanNumber.length === 13) {
    console.log('⚠️ Número de 13 dígitos no argentino:', cleanNumber);
    return cleanNumber; // Devolver tal como está
  }

  console.log('❌ Formato de número no reconocido:', cleanNumber);
  return cleanNumber; // Devolver lo que se pueda
}

function sanitizeTemplateText(value, fallback = '') {
  const safeValue = value === undefined || value === null ? '' : String(value);
  const baseText = safeValue || fallback || '';

  return baseText
    .normalize('NFC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\uFFFD/g, '')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function normalizeProductsForTemplate(value, fallback = 'Informacion de productos no disponible') {
  const raw = value === undefined || value === null ? '' : String(value);
  const withSeparators = raw.replace(/[\r\n\t]+/g, ', ');
  const withoutBullets = withSeparators.replace(/[•*]+/g, ' ');
  const normalized = sanitizeTemplateText(withoutBullets, fallback);
  return normalized || fallback;
}

function formatTemplateTotal(value, fallback = '$69.000') {
  const raw = sanitizeTemplateText(value, '');
  if (!raw) {
    return fallback;
  }

  const digitsOnly = raw.replace(/\D/g, '');
  if (!digitsOnly) {
    return fallback;
  }

  const amount = Number(digitsOnly);
  if (!Number.isFinite(amount)) {
    return fallback;
  }

  return `$${amount.toLocaleString('es-AR')}`;
}

// ===============================
// FUNCIÓN AUXILIAR: VERIFICAR ESTADO WHATSAPP API
// ===============================
async function verificarEstadoWhatsAppApi() {
  const apiStatus = whatsappApiService.getWhatsAppApiStatus();
  return {
    disponible: apiStatus.configured,
    razon: apiStatus.configured ? 'WhatsApp API configurada' : `Faltan variables: ${apiStatus.missing.join(', ')}`,
    whatsappApi: apiStatus
  };
}

// Tracking para notificaciones WhatsApp recientes (evitar duplicados)
const notificationSendHistory = new Map();
const NOTIFICATION_DUPLICATE_WINDOW_MS = 2 * 60 * 1000; // 2 minutos
const NOTIFICATION_HISTORY_TTL_MS = 15 * 60 * 1000; // 15 minutos
const notificationSendInFlight = new Set();
let pendingNotificationsProcessing = false;

function cleanupNotificationHistory() {
  const now = Date.now();
  let historyCleaned = 0;
  for (const [key, sentAt] of notificationSendHistory.entries()) {
    if (now - sentAt > NOTIFICATION_HISTORY_TTL_MS) {
      notificationSendHistory.delete(key);
      historyCleaned++;
    }
  }
  if (historyCleaned > 0) {
    console.log(`🧹 Historial de notificaciones reducido (${historyCleaned} entradas)`);
  }
  return historyCleaned;
}

// Función para actualizar el estado de notificación WhatsApp
async function actualizarEstadoWhatsApp(paymentId, estado) {
  const timestamp = new Date().toISOString();

  const paymentContext = db.buildPaymentIdContext(paymentId);
  const normalizedPaymentId = paymentContext.normalized;

  if (!normalizedPaymentId) {
    console.warn(`[${timestamp}] ⚠️ No se puede actualizar estado WhatsApp: paymentId faltante`);
    return;
  }

  try {
    const estadoString = estado ? 'True' : 'False';
    const scope = estado ? 'CLIENTE ENTREGADO' : 'CLIENTE PENDIENTE';

    await db.executeQueryWithRetry(
      db.pool,
      `UPDATE ${db.PRODUCTOS_TABLE} SET whatsapp_notificado = $1 WHERE mp_payment_id = $2 OR mp_payment_id = $3`,
      [estadoString, paymentContext.dbParams[0], paymentContext.dbParams[1]],
      2
    );

    console.log(`[${timestamp}] ✅ Estado WhatsApp (${scope}) actualizado a ${estadoString} para payment_id: ${normalizedPaymentId}`);

  } catch (error) {
    console.error(`[${timestamp}] ❌ Error actualizando estado WhatsApp:`, error.message);
  }
}

// Función para enviar notificación de compra por WhatsApp
async function enviarNotificacionCompra(customerData, orderData, paymentInfo, esReintento = false) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔔 === INICIANDO NOTIFICACIÓN DE COMPRA ===`);

  let normalizedPaymentId = null;
  let paymentId = 'N/A';
  let rawPaymentId = null;
  const whatsappApiStatus = whatsappApiService.getWhatsAppApiStatus();
  const useCloudApi = whatsappApiService.shouldUseWhatsAppApi();

  try {
    // Validación de parámetros críticos
    if (!customerData || typeof customerData !== 'object') {
      console.error(`[${timestamp}] ❌ customerData inválido:`, customerData);
      return { success: false, error: 'Datos de cliente inválidos' };
    }

    if (!orderData || typeof orderData !== 'object') {
      console.error(`[${timestamp}] ❌ orderData inválido:`, orderData);
      return { success: false, error: 'Datos de pedido inválidos' };
    }

    if (!paymentInfo || typeof paymentInfo !== 'object') {
      console.error(`[${timestamp}] ❌ paymentInfo inválido:`, paymentInfo);
      return { success: false, error: 'Información de pago inválida' };
    }

    console.log(`[${timestamp}] ☁️ WhatsApp API - flagEnabled: ${whatsappApiStatus.flagEnabled}, configurada: ${whatsappApiStatus.configured}, en uso: ${useCloudApi}`);

    // SOLO WhatsApp Cloud API - NO MÁS QR
    if (!useCloudApi) {
      console.error(`[${timestamp}] ❌ WhatsApp API no configurada o no habilitada`);
      if (whatsappApiStatus.flagEnabled && !whatsappApiStatus.configured) {
        console.error(`[${timestamp}] ⚠️ Faltan variables: ${whatsappApiStatus.missing.join(', ')}`);
      }
      return { success: false, error: 'WhatsApp API no configurada' };
    }

    console.log(`[${timestamp}] ☁️ Usando WhatsApp Cloud API para notificación`);

    console.log(`[${timestamp}] 📋 Datos de la compra:`);

    // Extraer datos con valores por defecto seguros
    const { first_name, last_name, phone, nombre: nombreRaw, apellido: apellidoRaw } = customerData || {};
    const nombre = nombreRaw || first_name || '';
    const apellido = apellidoRaw || last_name || '';
    const telefono = customerData?.telefono ||
      (phone ?
        (typeof phone === 'string' ? phone : `${phone.area_code}${phone.number}`) :
        '');

    const { numeroDisplay = 'N/A', idPedidoCompleto = 'N/A' } = orderData || {};
    rawPaymentId = paymentInfo?.normalized_payment_id ?? paymentInfo?.id ?? idPedidoCompleto;
    normalizedPaymentId = db.normalizePaymentId(rawPaymentId);
    paymentId = normalizedPaymentId || 'N/A';
    const transaction_amount = Number(
      paymentInfo?.transaction_amount ??
      orderData?.monto_total ??
      orderData?.montoTotal ??
      0
    );

    if (normalizedPaymentId) {
      if (notificationSendInFlight.has(normalizedPaymentId)) {
        console.warn(`[${timestamp}] ⚠️ Envío ya en curso para pago ${normalizedPaymentId} - omitiendo duplicado`);
        return {
          success: false,
          skipped: true,
          reason: 'in_flight'
        };
      }
      notificationSendInFlight.add(normalizedPaymentId);
    }

    console.log(`[${timestamp}] - Cliente: ${nombre} ${apellido}`);
    console.log(`[${timestamp}] - Teléfono: ${telefono || 'No proporcionado'}`);
    console.log(`[${timestamp}] - Teléfono RAW:`, phone);
    console.log(`[${timestamp}] - CustomerData completo:`, customerData);
    console.log(`[${timestamp}] - Pedido: ${numeroDisplay} (${idPedidoCompleto})`);
    console.log(`[${timestamp}] - Monto: $${transaction_amount}`);
    console.log(`[${timestamp}] - Payment ID: ${paymentId}`);

    if (!esReintento && normalizedPaymentId) {
      const lastSentAt = notificationSendHistory.get(normalizedPaymentId);
      if (lastSentAt && (Date.now() - lastSentAt) < NOTIFICATION_DUPLICATE_WINDOW_MS) {
        const secondsAgo = Math.round((Date.now() - lastSentAt) / 1000);
        console.warn(`[${timestamp}] ⚠️ Notificación duplicada detectada para pago ${normalizedPaymentId} (hace ${secondsAgo}s) - omitiendo reenvío`);
        return {
          success: true,
          duplicate: true,
          skipped: true,
          message: `Notificación ya enviada hace ${secondsAgo}s`
        };
      }
    }

    const fechaOptions = {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    };
    const fechaReferenciaCruda = orderData?.fechaPago || paymentInfo?.date_approved || paymentInfo?.date_created;
    let fechaHora;
    if (fechaReferenciaCruda) {
      const fechaParseada = new Date(fechaReferenciaCruda);
      if (!Number.isNaN(fechaParseada.getTime())) {
        fechaHora = fechaParseada.toLocaleString('es-AR', fechaOptions);
      }
    }
    if (!fechaHora) {
      fechaHora = new Date().toLocaleString('es-AR', fechaOptions);
    }

    // Obtener productos del payment info con validación robusta
    const items = (paymentInfo && paymentInfo.additional_info && paymentInfo.additional_info.items)
      ? paymentInfo.additional_info.items
      : [];

    console.log(`[${timestamp}] 📦 Items de la compra: ${items.length} productos`);

    let productosTexto = '';
    let productosTextoTemplate = '';
    if (Array.isArray(items) && items.length > 0) {
      if (esReintento) {
        productosTexto = items.map((item, index) => {
          const title = item?.title || 'Producto sin nombre';
          const quantity = item?.quantity || 1;

          console.log(`[${timestamp}] - Item ${index + 1}: ${title} x${quantity} (reintento simplificado)`);
          return quantity > 1 ? `• ${title} (${quantity})` : `• ${title}`;
        }).join('\n');
      } else {
        productosTexto = items.map((item, index) => {
          const title = item?.title || 'Producto sin nombre';
          const quantity = item?.quantity || 1;
          const unit_price = item?.unit_price || 0;

          console.log(`[${timestamp}] - Item ${index + 1}: ${title} x${quantity} - $${unit_price}`);
          return `• ${title} x${quantity} - $${unit_price.toLocaleString('es-AR')}`;
        }).join('\n');
      }

      productosTextoTemplate = items.map((item) => {
        const title = item?.title || 'Producto sin nombre';
        const quantity = item?.quantity || 1;
        return quantity > 1 ? `${title} (${quantity})` : `${title}`;
      }).join(', ');
    } else {
      console.log(`[${timestamp}] ⚠️ No se encontraron items válidos en paymentInfo`);
      productosTexto = '• Información de productos no disponible';
      productosTextoTemplate = '* Informacion de productos no disponible';
    }

    const businessName = BUSINESS_NAME || 'Tienda Online';

    const consultasNumero = (CONSULTAS_WHATSAPP || '').replace(/\D/g, '');
    const consultasLink = consultasNumero ? `https://wa.me/${consultasNumero}` : null;
    if (!consultasLink) {
      console.warn(`[${timestamp}] ⚠️ CONSULTAS_WHATSAPP no configurado - {{6}} se enviará vacío`);
    }

    const mensajeCliente = `🎉 *¡Gracias por tu compra en ${businessName}!* 🎉\n\n` +
      `✅ *Tu pago ha sido procesado exitosamente*\n\n` +
      `📋 *Detalles de tu pedido:*\n` +
      `🆔 *ID Número Pedido:* ${numeroDisplay}\n` +
      `📅 *Fecha del pago:* ${fechaHora}\n` +
      `💰 *Total:* $${transaction_amount.toLocaleString('es-AR')}\n\n` +
      `🛍️ *Productos:*\n${productosTexto}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📞 *Te contactaremos pronto para coordinar la entrega*\n\n` +
      (consultasLink ? `💬 *Para comunicarte con nosotros podés usar el siguiente enlace:*\n👇 ${consultasLink}\n\n` : '') +
      `¡Gracias por elegirnos! 💜`;

    let resultado = null;

    if (useCloudApi) {
      const resultAdmin = { success: false, skipped: true, reason: 'cloud_api_mode' };
      let resultCliente = { success: false, error: 'No se intentó enviar' };
      const templateName = process.env.WHATSAPP_API_TEMPLATE_NAME;
      const templateLanguage = process.env.WHATSAPP_API_TEMPLATE_LANGUAGE || 'es';
      const useTemplate = Boolean(templateName);

      if (telefono && telefono.trim()) {
        console.log(`[${timestamp}] 📱 Enviando confirmación vía WhatsApp API al cliente: ${telefono}`);
        const clienteNormalizado = normalizePhoneNumber(telefono);
        console.log(`[${timestamp}] 📱 Cliente normalizado: ${clienteNormalizado}`);

        if (clienteNormalizado) {
          if (useTemplate && typeof whatsappApiService.sendWhatsAppApiTemplateMessage === 'function') {
            const totalTexto = formatTemplateTotal(transaction_amount, '$0');
            const nombreCliente = sanitizeTemplateText(nombre?.trim() || 'Cliente', 'Cliente');
            const numeroTemplate = sanitizeTemplateText(numeroDisplay, 'N/A');
            const fechaTemplate = sanitizeTemplateText(fechaHora);
            const productosTemplate = normalizeProductsForTemplate(productosTextoTemplate);
            const parametros = [
              nombreCliente,
              numeroTemplate,
              fechaTemplate,
              totalTexto,
              productosTemplate,
              consultasLink  // {{6}} - link de consultas
            ];

            resultCliente = await whatsappApiService.sendWhatsAppApiTemplateMessage(
              clienteNormalizado,
              templateName,
              templateLanguage,
              parametros,
              {
                paymentId,
                orderId: idPedidoCompleto,
                esReintento
              }
            );
          } else {
            resultCliente = await whatsappApiService.sendWhatsAppApiMessage(clienteNormalizado, mensajeCliente, {
              paymentId,
              orderId: idPedidoCompleto,
              esReintento
            });
          }

          console.log(`[${timestamp}] 📡 Resultado del envío vía API:`, {
            success: resultCliente.success,
            error: resultCliente.error,
            messageId: resultCliente.messageId
          });
        } else {
          console.error(`[${timestamp}] ❌ No se pudo normalizar teléfono del cliente para WhatsApp API: ${telefono}`);
          resultCliente = { success: false, error: 'Teléfono del cliente inválido' };
        }
      } else {
        console.warn(`[${timestamp}] ⚠️ No hay teléfono del cliente para enviar confirmación (WhatsApp API)`);
        resultCliente = { success: false, error: 'Teléfono del cliente no disponible' };
      }

      resultado = {
        success: resultCliente.success,
        admin_result: resultAdmin,
        cliente_result: resultCliente,
        both_sent: resultCliente.success,
        transport: 'whatsapp_api'
      };
    }

    if (normalizedPaymentId) {
      if (!esReintento && resultado.success) {
        notificationSendHistory.set(normalizedPaymentId, Date.now());
      }
    }

    // Procesar notificaciones pendientes si el envío fue exitoso
    if (resultado.success && !esReintento) {
      setImmediate(async () => {
        try {
          await procesarNotificacionesPendientes();
        } catch (error) {
          console.error('Error procesando notificaciones pendientes:', error);
        }
      });
    }

    return resultado;

  } catch (error) {
    console.error(`[${timestamp}] ❌ ERROR CRÍTICO en enviarNotificacionCompra:`, error.message);
    console.error(`[${timestamp}] Stack trace:`, error.stack);
    return { success: false, error: error.message, stack: error.stack };
  } finally {
    if (normalizedPaymentId) {
      notificationSendInFlight.delete(normalizedPaymentId);
    }
  }
}

// Función para procesar notificaciones pendientes
async function procesarNotificacionesPendientes(reintentos = 0, options = {}) {
  const timestamp = new Date().toISOString();
  const fastTrack = Boolean(options.fastTrack);
  const source = options.source || 'default';
  let pedidosProcesados = 0;
  let pedidosExitosos = 0;

  if (pendingNotificationsProcessing) {
    console.log(`[${timestamp}] ⏭️ procesarNotificacionesPendientes ya está en ejecución; se omite invocación duplicada`);
    return { skipped: true, reason: 'already_processing', source };
  }
  pendingNotificationsProcessing = true;

  try {
    console.log(`[${timestamp}] 🔍 DEBUG procesarNotificacionesPendientes - reintentos: ${reintentos}, source: ${source}`);

    // Verificar que WhatsApp API esté configurada
    const apiStatus = whatsappApiService.getWhatsAppApiStatus();
    if (!apiStatus.configured) {
      console.log(`[${timestamp}] ❌ WhatsApp API no configurada - missing: ${apiStatus.missing.join(', ')}`);
      return { success: false, error: 'WhatsApp API no configurada', reintentos, source };
    }

    console.log(`[${timestamp}] ✅ WhatsApp API operativa - buscando notificaciones pendientes...`);

    // Buscar productos con notificación pendiente (TODAS, sin límite de fecha)
    if (!db.pool) {
      console.log(`[${timestamp}] ⚠️ Base de datos no configurada - no se pueden procesar notificaciones pendientes`);
      return;
    }

    let resultPendientes;
    try {
      resultPendientes = await db.pool.query(`SELECT
        p.mp_payment_id,
        p.id_pedido,
        p.pedido_nombre_cliente,
        p.pedido_telefono_cliente,
        p.pedido_monto_total,
        p.pedido_fecha,
        p.prenda,
        p.categoria,
        p.color,
        p.talle,
        p.precio_venta_efectivo,
        p.precio_venta_transferencia,
        p.pedido_tipo_entrega
      FROM ${db.PRODUCTOS_TABLE} p
       WHERE p.estado LIKE '%Pendiente%'
       AND p.whatsapp_notificado = 'False'
       ORDER BY p.pedido_fecha ASC, p.mp_payment_id, p.id_articulo
       LIMIT 50`);
    } catch (dbError) {
      console.error(`[${timestamp}] ❌ Error consultando notificaciones pendientes:`, dbError.message);
      return;
    }

    console.log(`[${timestamp}] 🔍 DEBUG: Query ejecutada para notificaciones pendientes (sin límite de fecha)`);
    console.log(`[${timestamp}] 🔍 Resultado query:`, resultPendientes?.rows?.length || 0, 'registros encontrados');

    if (!resultPendientes || !resultPendientes.rows || resultPendientes.rows.length === 0) {
      console.log(`[${timestamp}] ✅ No hay notificaciones WhatsApp pendientes`);
      return { success: true, source, fastTrack, totalPendientes: 0, pedidosProcesados: 0, pedidosExitosos: 0 };
    }

    console.log(`[${timestamp}] 📬 Procesando ${resultPendientes.rows.length} productos de notificaciones pendientes...`);

    // Agrupar productos por mp_payment_id para construir pedidos completos
    const pedidosMap = new Map();

    for (const producto of resultPendientes.rows) {
      const paymentId = producto.mp_payment_id;

      if (!pedidosMap.has(paymentId)) {
        // Crear nuevo pedido
        pedidosMap.set(paymentId, {
          mp_payment_id: producto.mp_payment_id,
          id_pedido: producto.id_pedido,
          pedido_nombre_cliente: producto.pedido_nombre_cliente,
          pedido_telefono_cliente: producto.pedido_telefono_cliente,
          pedido_monto_total: producto.pedido_monto_total,
          pedido_fecha: producto.pedido_fecha,
          pedido_tipo_entrega: producto.pedido_tipo_entrega,
          productos: []
        });
      }

      // Agregar producto al pedido
      pedidosMap.get(paymentId).productos.push({
        nombre: producto.prenda,
        categoria: producto.categoria,
        color: producto.color,
        talle: producto.talle,
        precio_efectivo: producto.precio_venta_efectivo,
        precio_transferencia: producto.precio_venta_transferencia,
        cantidad: 1 // Cada fila es un producto individual
      });
    }

    console.log(`[${timestamp}] 📋 Agrupados en ${pedidosMap.size} pedidos únicos`);

    // Agrupar productos idénticos y contar cantidad
    for (const pedido of pedidosMap.values()) {
      const productosAgrupados = new Map();

      for (const prod of pedido.productos) {
        const key = `${prod.nombre}-${prod.color}-${prod.talle}`;

        if (productosAgrupados.has(key)) {
          productosAgrupados.get(key).cantidad++;
        } else {
          productosAgrupados.set(key, { ...prod });
        }
      }

      pedido.productos = Array.from(productosAgrupados.values());
    }

    // Procesar cada pedido agrupado
    for (const pedido of pedidosMap.values()) {
      try {
        pedidosProcesados += 1;
        console.log(`[${timestamp}] 🔄 Reintentando notificación para pedido: ${pedido.id_pedido} (${pedido.productos.length} productos únicos)`);

        const customerData = {
          first_name: pedido.pedido_nombre_cliente?.split(' ')[0] || 'Cliente',
          last_name: pedido.pedido_nombre_cliente?.split(' ').slice(1).join(' ') || '',
          telefono: pedido.pedido_telefono_cliente, // ✅ Usar directo de BD
          phone: {
            area_code: pedido.pedido_telefono_cliente?.substring(2, 5) || '',
            number: pedido.pedido_telefono_cliente?.substring(5) || ''
          }
        };

        const orderData = {
          numeroDisplay: pedido.id_pedido?.slice(-2) || '??',
          idPedidoCompleto: pedido.id_pedido,
          fechaPago: pedido.pedido_fecha
        };

        const paymentInfo = {
          transaction_amount: pedido.pedido_monto_total || 0,
          id: pedido.mp_payment_id,
          normalized_payment_id: pedido.mp_payment_id,
          additional_info: {
            items: pedido.productos.map(prod => ({
              id: `${prod.categoria}-${prod.nombre}`.replace(/\s+/g, '-').toLowerCase(),
              title: prod.nombre,
              category_id: prod.categoria,
              description: `${prod.nombre} - ${prod.color} - Talle ${prod.talle}`,
              quantity: prod.cantidad,
              unit_price: prod.precio_transferencia || prod.precio_efectivo || 0,
              type: 'product'
            }))
          },
          // Simular estructura de payer para compatibilidad
          payer: {
            first_name: customerData.first_name,
            last_name: customerData.last_name,
            phone: customerData.phone
          }
        };

        const resultado = await enviarNotificacionCompra(customerData, orderData, paymentInfo, true);

        const clienteNotificado = Boolean(resultado?.cliente_result?.success);
        await actualizarEstadoWhatsApp(pedido.mp_payment_id, clienteNotificado);

        if (resultado.success) {
          pedidosExitosos += 1;
          console.log(`[${timestamp}] ✅ Reintento exitoso para pedido: ${pedido.id_pedido}`);
        } else {
          console.log(`[${timestamp}] ❌ Reintento falló para pedido: ${pedido.id_pedido} - ${resultado.error}`);
        }

        // Delay entre envíos (reducido en fastTrack para aprovechar la sesión)
        if (fastTrack) {
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.error(`[${timestamp}] ❌ Error procesando pedido ${pedido.id_pedido}:`, error.message);
      }
    }

    return {
      success: pedidosExitosos > 0,
      source,
      fastTrack,
      totalPendientes: pedidosMap.size,
      pedidosProcesados,
      pedidosExitosos
    };

  } catch (error) {
    console.error(`[${timestamp}] ❌ Error en procesarNotificacionesPendientes:`, error.message);
    return { success: false, source, fastTrack, error: error.message, pedidosProcesados, pedidosExitosos };
  } finally {
    pendingNotificationsProcessing = false;
  }
}

module.exports = {
  getAdminNumbers,
  getPrimaryAdminNumber,
  normalizePhoneNumber,
  sanitizeTemplateText,
  normalizeProductsForTemplate,
  formatTemplateTotal,
  verificarEstadoWhatsAppApi,
  actualizarEstadoWhatsApp,
  enviarNotificacionCompra,
  procesarNotificacionesPendientes,
  cleanupNotificationHistory,
  BUSINESS_NAME,
  CONSULTAS_WHATSAPP
};
