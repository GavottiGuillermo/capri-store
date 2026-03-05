const CHECKOUT_API_BASE = (typeof getCapriApiBaseUrl === 'function' && getCapriApiBaseUrl()) ||
  (window.CapriConfig && typeof window.CapriConfig.getApiBaseUrl === 'function'
    ? window.CapriConfig.getApiBaseUrl()
    : '');

function checkoutResolveApiUrl(pathname) {
  if (typeof buildCapriApiUrl === 'function') {
    return buildCapriApiUrl(pathname);
  }
  const path = typeof pathname === 'string' && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  return CHECKOUT_API_BASE ? `${CHECKOUT_API_BASE}${path}` : path;
}

// === PREPARAR ITEMS PARA MERCADO PAGO ===
function prepararItemsParaMP(cartItems) {
  // Función para sanitizar strings y evitar problemas con CSP de MercadoPago
  const sanitizarTexto = (texto) => {
    if (!texto) return 'Producto';
    return String(texto)
      // Normalizar caracteres especiales (tildes, ñ, etc.)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remover diacríticos
      .replace(/ñ/gi, 'n') // Reemplazar ñ
      .replace(/[<>"'`\\()\[\]:;]/g, '') // Remover paréntesis, corchetes, dos puntos
      .replace(/\s+/g, ' ') // Normalizar espacios
      .trim()
      .substring(0, 256); // Límite de MercadoPago
  };

  return cartItems.map(item => {
    // Usar id_articulo si está presente, si no, intentar extraerlo del path de la imagen
    let id = item.id_articulo || item.id;
    if (!id && item.img) {
      id = obtenerIdProductoDesdeCarpeta(item.img);
    }
    return {
      id: id || undefined,
      title: sanitizarTexto(item.nombre),
      quantity: item.cantidad,
      currency_id: 'ARS',
      unit_price: Number(item.precio)
    };
  });
}
// === MANEJAR TIPO DE ENTREGA ===
function manejarTipoEntrega() {
  const retiroLocal = document.getElementById('retiroLocal');
  const envioDomicilio = document.getElementById('enviosDomicilio');
  const seccionDatosEnvio = document.getElementById('seccionDatosEnvio');
  if (retiroLocal && retiroLocal.checked) {
    if (seccionDatosEnvio) seccionDatosEnvio.style.display = 'none';
    costoEnvio = 0;
  } else if (envioDomicilio && envioDomicilio.checked) {
    if (seccionDatosEnvio) seccionDatosEnvio.style.display = 'block';
    costoEnvio = 0;
  }
  // Siempre recalcular el resumen tras cambiar la modalidad
  cargarResumenCompra();
}
// === RESUMEN DE COMPRA ===
// Variable para evitar múltiples ejecuciones
let isLoadingResumen = false;
let lastResumenLoad = 0;

function cargarResumenCompra() {
  // Evitar múltiples llamadas en menos de 100ms
  const now = Date.now();
  if (isLoadingResumen || (now - lastResumenLoad) < 100) {
    console.log('⏭️ Saltando carga duplicada de resumen');
    return;
  }
  
  isLoadingResumen = true;
  lastResumenLoad = now;
  
  console.log('📊 Cargando resumen de compra...');
  
  const checkoutItems = document.getElementById('checkout-items');
  const subtotalElement = document.getElementById('checkout-subtotal');
  const totalElement = document.getElementById('checkout-total');
  const cartCount = document.getElementById('cart-count');
  
  let cartItems = JSON.parse(localStorage.getItem("carrito")) || [];
  
  console.log('🛒 Items en carrito:', cartItems.length);
  
  // Fallback: si carrito está vacío, intentar con productosCompra
  if ((!cartItems || cartItems.length === 0) && localStorage.getItem("productosCompra")) {
    try {
      cartItems = JSON.parse(localStorage.getItem("productosCompra")) || [];
      console.log('📦 Usando productosCompra como fallback:', cartItems.length);
    } catch (e) {
      cartItems = [];
    }
  }
  
  let subtotal = 0;
  let cantidadTotal = 0;
  
  if (!cartItems || cartItems.length === 0) {
    console.log('⚠️ Carrito vacío');
    if (checkoutItems) checkoutItems.innerHTML = '<div class="text-center py-4"><h5 class="text-muted">Tu carrito está vacío</h5><a href="index.html" class="btn btn-vino-tinto">Volver a la tienda</a></div>';
    if (subtotalElement) subtotalElement.textContent = formatPrice(0);
    if (totalElement) totalElement.textContent = formatPrice(0);
    if (cartCount) cartCount.textContent = "0";
    return;
  }
  
  if (checkoutItems) checkoutItems.innerHTML = '';
  
  cartItems.forEach((item, index) => {
    console.log(`📝 Procesando item ${index + 1}:`, item.nombre);
    
    const precioNum = Number(item.precio);
    const cantidadNum = Number(item.cantidad);
    const itemTotal = precioNum * cantidadNum;
    subtotal += itemTotal;
    cantidadTotal += cantidadNum;
    
    // Renderizar cada item del carrito
    if (checkoutItems) {
      checkoutItems.innerHTML += `
        <div class="d-flex align-items-center mb-3 border-bottom pb-2">
          <img src="${item.img}" alt="${item.nombre}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;margin-right:12px;">
          <div class="flex-grow-1">
            <div class="fw-bold">${item.nombre}</div>
            <div class="text-muted small">${formatPrice(item.precio)} x ${item.cantidad}</div>
          </div>
          <div class="fw-bold ms-2">${formatPrice(itemTotal)}</div>
        </div>
      `;
    }
  });
  
  const total = subtotal + costoEnvio;
  
  console.log('💰 Subtotal:', subtotal, 'Total:', total);
  
  if (subtotalElement) subtotalElement.textContent = formatPrice(subtotal);
  if (totalElement) totalElement.textContent = formatPrice(total);
  if (cartCount) cartCount.textContent = cantidadTotal;
  
  // Mostrar/ocultar sección de envío
  const envioSection = document.getElementById('envio-section');
  const checkoutEnvio = document.getElementById('checkout-envio');
  if (envioSection && checkoutEnvio) {
    if (costoEnvio > 0) {
      envioSection.style.display = 'flex';
      checkoutEnvio.textContent = formatPrice(costoEnvio);
    } else {
      envioSection.style.display = 'none';
    }
  }
  
  // Validar stock de manera asíncrona (sin bloquear la UI)
  validarStockAsync(cartItems);
  
  // Liberar flag de carga
  isLoadingResumen = false;
}

// === VALIDACIÓN DE STOCK ASÍNCRONA ===
async function validarStockAsync(cartItems) {
  if (!cartItems || cartItems.length === 0) return;
  
  const ids = cartItems.map(item => item.id_articulo || item.id).filter(Boolean);
  if (ids.length === 0) return;
  
  try {
    console.log('🔍 Validando stock para:', ids);
      const resp = await fetch(checkoutResolveApiUrl('/validar-stock-carrito'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await resp.json();
    
    if (resp.ok && data.ok && data.faltantes && data.faltantes.length > 0) {
      let nombres = cartItems.filter(item => data.faltantes.includes(item.id_articulo || item.id)).map(item => item.nombre);
      if (nombres.length > 0) {
        alert('⚠️ El producto ' + nombres.join(', ') + ' ya no se encuentra en stock y será removido del carrito.');
      }
      // Filtrar productos sin stock y actualizar localStorage
      const cartItemsFiltrados = cartItems.filter(item => !data.faltantes.includes(item.id_articulo || item.id));
      localStorage.setItem("carrito", JSON.stringify(cartItemsFiltrados));
      
      // Recargar página si se removieron productos
      if (cartItemsFiltrados.length !== cartItems.length) {
        console.log('🔄 Recargando página después de remover productos sin stock');
        window.location.reload();
        return;
      }
    }
  } catch (err) {
    console.warn('⚠️ No se pudo validar stock:', err);
  }
}

// === VARIABLES Y HELPERS ===
let costoEnvio = 0;

function formatPrice(price) {
  return '$' + Number(price).toFixed(2) + ' ARS';
}

// === ARMADO DE ITEMS PARA MERCADO PAGO ===
function obtenerIdProductoDesdeCarpeta(imgPath) {
  const match = imgPath && imgPath.match(/portfolio\/(\d+)-/);
  return match ? match[1] : undefined;
}


async function iniciarProcesoPago() {
  // LOG: Confirmar que la función fue llamada por el botón
  console.log('[checkout] iniciarProcesoPago() fue llamada');
  const form = document.getElementById('checkout-form');
  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    mostrarPopup('Por favor completa todos los campos requeridos', 'warning');
    return;
  }
  let cartItems = JSON.parse(localStorage.getItem("carrito")) || [];
  if (!cartItems || cartItems.length === 0) {
    mostrarPopup('Tu carrito está vacío', 'info');
    return;
  }
  // Validar stock antes de iniciar pago
  const ids = cartItems.map(item => item.id_articulo || item.id).filter(Boolean);
  try {
    const resp = await fetch(checkoutResolveApiUrl('/validar-stock-carrito'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      alert('Error al validar stock. Intenta nuevamente.');
      return;
    }
    if (data.faltantes && data.faltantes.length > 0) {
      // Mostrar alerta personalizada por cada producto sin stock
      let nombres = cartItems.filter(item => data.faltantes.includes(item.id_articulo || item.id)).map(item => item.nombre);
      if (nombres.length > 0) {
        alert('El producto ' + nombres.join(', ') + ' ya no se encuentra en stock y será removido del carrito.');
      }
      // Quitar productos sin stock del carrito
      const cartFiltrado = cartItems.filter(item => !data.faltantes.includes(item.id_articulo || item.id));
      localStorage.setItem("carrito", JSON.stringify(cartFiltrado));
      
      // Recargar la página para mostrar el carrito actualizado
      window.location.reload();
      return;
    }
  } catch (err) {
    alert('Error de conexión al validar stock.');
    return;
  }
  const formData = new FormData(form);
  const tipoEntrega = document.querySelector('input[name="tipoEntrega"]:checked').value;
  const metodoEnvio = document.querySelector('input[name="metodoEnvio"]:checked')?.value || '';
  let datosEnvio = null;
  if (tipoEntrega === 'envio') {
    datosEnvio = {
      cotizacionAndreani: true,
      instrucciones: 'El cliente cotizará y abonará el envío manualmente en Andreani antes del despacho',
      enlace: 'https://www.andreani.com/?tab=cotizar-envio'
    };
  }
  // Sanitizar datos del comprador
  const sanitizarNombre = (texto) => {
    if (!texto) return '';
    return String(texto)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ñ/gi, 'n')
      .replace(/[<>"'`\\()\[\]:;]/g, '')
      .trim()
      .substring(0, 256);
  };

  const checkoutData = {
    nombre: sanitizarNombre(formData.get('nombre')),
    apellido: sanitizarNombre(formData.get('apellido')),
    email: formData.get('email'),
    telefono: formData.get('telefono'),
    tipoEntrega: tipoEntrega,
    datosEnvio: datosEnvio,
    metodoEnvio: metodoEnvio,
    items: cartItems,
    costoEnvio: costoEnvio
  };
  // Re-sincronizar precios justo antes de crear la preferencia (doble protección)
  await actualizarPreciosCarritoDesdeProductos();
  cartItems = JSON.parse(localStorage.getItem('carrito') || '[]');

  // Preparar items para Mercado Pago con IDs correctos
  let items = prepararItemsParaMP(cartItems);
  if (costoEnvio > 0) {
    items.push({
      id: 'ENVIO',
      title: 'Costo de Envio', // Sin tilde
      quantity: 1,
      currency_id: 'ARS',
      unit_price: Number(costoEnvio)
    });
  }
  // Deshabilitar botón y mostrar loading
  const pagarBtn = document.getElementById('iniciarPago');
  pagarBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Procesando...';
  pagarBtn.disabled = true;
  
  // LOG DETALLADO: Mostrar CADA item individual
  console.log('=== DATOS PARA MERCADOPAGO ===');
  console.log('Total items:', items.length);
  items.forEach((item, index) => {
    console.log(`Item ${index + 1}:`, {
      id: item.id,
      title: item.title,
      'title_length': item.title.length,
      'title_chars': item.title.split('').map(c => `${c}(${c.charCodeAt(0)})`).join(','),
      quantity: item.quantity,
      unit_price: item.unit_price
    });
  });
  console.log('Datos comprador:', {
    nombre: checkoutData.nombre,
    apellido: checkoutData.apellido,
    telefono: checkoutData.telefono
  });
  console.log('==============================');
  try {
    // Usar la URL absoluta del backend en Render
    const API_URL = checkoutResolveApiUrl('/crear-preferencia');
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, datosComprador: checkoutData })
    });
    // LOG: Mostrar status y headers de la respuesta
    console.log('[checkout] Respuesta de /crear-preferencia:', response.status, response.statusText, response.headers);
    const contentType = response.headers.get('content-type');
    // LOG: Mostrar content-type recibido
    console.log('[checkout] Content-Type recibido:', contentType);
    if (!response.ok) throw new Error('Error al crear preferencia');
    if (!contentType || !contentType.includes('application/json')) throw new Error('Respuesta inesperada del servidor');
    const data = await response.json();
    // LOG: Mostrar el JSON recibido
    console.log('[checkout] JSON recibido:', data);
    if (data && data.init_point) {
      // Guardar datos para success.html
      localStorage.setItem('datosCompra', JSON.stringify(checkoutData));
      localStorage.setItem('productosCompra', JSON.stringify(cartItems));
      localStorage.setItem('totalCompra', (cartItems.reduce((total, item) => total + (item.cantidad * item.precio), 0) + costoEnvio).toString());
      localStorage.setItem('costoEnvio', costoEnvio.toString());
      localStorage.setItem('checkoutData', JSON.stringify(checkoutData));
      localStorage.setItem('datosComprador', JSON.stringify(checkoutData));
      window.location.href = data.init_point;
    } else {
      throw new Error('No se recibió el init_point de Mercado Pago');
    }
  } catch (error) {
    console.error('Error al crear preferencia:', error);
    alert('Error al procesar el pago: ' + (error.message || 'Error desconocido'));
    pagarBtn.innerHTML = '<i class="fas fa-credit-card mr-2"></i>Iniciar Pago';
    pagarBtn.disabled = false;
  }
}

// === SINCRONIZACIÓN DE PRECIOS EN CHECKOUT ===
// Descarga productos.json fresco y actualiza los precios del carrito en localStorage.
// Retorna true si algún precio cambió.
const GCS_PRODUCTOS_URL = 'https://storage.googleapis.com/imagenes-web-capri/productos.json';

async function actualizarPreciosCarritoDesdeProductos() {
  try {
    const url = `${GCS_PRODUCTOS_URL}?t=${Date.now()}`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) return false;
    const productos = await resp.json();
    if (!Array.isArray(productos)) return false;

    const cartRaw = localStorage.getItem('carrito');
    if (!cartRaw) return false;
    const cart = JSON.parse(cartRaw);
    if (!Array.isArray(cart) || cart.length === 0) return false;

    const mapaPrecios = new Map();
    productos.forEach(p => {
      if (p.id_articulo != null) mapaPrecios.set(Number(p.id_articulo), Number(p.precio));
    });

    let algoCambio = false;
    cart.forEach(item => {
      if (!item.id_articulo) return;
      const precioActual = mapaPrecios.get(Number(item.id_articulo));
      if (precioActual !== undefined && precioActual !== Number(item.precio)) {
        console.warn(`💲 [checkout] Precio actualizado: "${item.nombre}" $${item.precio} → $${precioActual}`);
        item.precio = precioActual;
        algoCambio = true;
      }
    });

    if (algoCambio) {
      localStorage.setItem('carrito', JSON.stringify(cart));
    }
    return algoCambio;
  } catch (e) {
    console.error('Error sincronizando precios en checkout:', e);
    return false;
  }
}

// === EVENT LISTENERS PRINCIPALES ===
document.addEventListener('DOMContentLoaded', async function() {
  console.log('🚀 Checkout inicializando...');
  
  // Remover clase no-js pero NO inicializar animaciones
  document.documentElement.classList.remove('no-js');
  
  // Sincronizar precios con el catálogo actual antes de mostrar el resumen
  console.log('🔄 Sincronizando precios con catálogo actual...');
  const preciosCambiaron = await actualizarPreciosCarritoDesdeProductos();
  if (preciosCambiaron) {
    // Mostrar aviso visible al cliente
    const aviso = document.createElement('div');
    aviso.className = 'alert alert-warning alert-dismissible fade show mx-3 mt-3';
    aviso.setAttribute('role', 'alert');
    aviso.innerHTML = '<strong>⚠️ Precios actualizados.</strong> Uno o más precios en tu carrito fueron actualizados al valor vigente.' +
      ' <button type="button" class="close" data-dismiss="alert"><span>&times;</span></button>';
    const container = document.querySelector('.container') || document.body;
    container.insertBefore(aviso, container.firstChild);
  }

  // Cargar datos directamente sin delay
  console.log('📊 Cargando resumen de compra inicial...');
  cargarResumenCompra();
  
  console.log('🚛 Configurando tipo de entrega...');
  manejarTipoEntrega();
  
  // Configurar event listeners para tipo de entrega
  const retiroLocal = document.getElementById('retiroLocal');
  const envioDomicilio = document.getElementById('enviosDomicilio');
  const iniciarPagoBtn = document.getElementById('iniciarPago');
  
  if (retiroLocal) retiroLocal.addEventListener('change', manejarTipoEntrega);
  if (envioDomicilio) envioDomicilio.addEventListener('change', manejarTipoEntrega);
  
  if (iniciarPagoBtn) {
    console.log('✅ Botón iniciar pago encontrado');
    iniciarPagoBtn.addEventListener('click', function(e) {
      console.log('[checkout] Click en #iniciarPago, llamando iniciarProcesoPago');
      iniciarProcesoPago();
    });
  } else {
    console.warn('⚠️ No se encontró el botón #iniciarPago');
  }
  
  console.log('✅ Checkout inicializado correctamente - Sin animaciones');
  
  // Event listeners para el carrito sidebar (sin onclick inline para CSP)
  const closeCartBtn = document.getElementById('closeCartBtn');
  const cartSidenavOverlay = document.getElementById('cartSidenavOverlay');
  const finalizarCompraBtn = document.getElementById('finalizarCompraBtn');
  const seguirComprandoBtn = document.getElementById('seguirComprandoBtn');
  const volverInicioBtn = document.getElementById('volverInicioBtn');
  
  if (closeCartBtn) {
    closeCartBtn.addEventListener('click', function() {
      if (typeof closeCartSidenav === 'function') closeCartSidenav();
    });
  }
  
  if (cartSidenavOverlay) {
    cartSidenavOverlay.addEventListener('click', function() {
      if (typeof closeCartSidenav === 'function') closeCartSidenav();
    });
  }
  
  if (finalizarCompraBtn) {
    finalizarCompraBtn.addEventListener('click', function() {
      if (typeof finalizarCompraSidebar === 'function') finalizarCompraSidebar();
    });
  }
  
  if (seguirComprandoBtn) {
    seguirComprandoBtn.addEventListener('click', function() {
      if (typeof closeCartSidenav === 'function') closeCartSidenav();
      window.location.href = 'index.html';
    });
  }
  
  if (volverInicioBtn) {
    volverInicioBtn.addEventListener('click', volverAInicio);
  }
});

// === FUNCIONES AUXILIARES PARA EL CARRITO ===
function volverAInicio() {
  window.location.href = 'index.html';
}

// Función básica para mostrar alertas/popups
function mostrarPopup(mensaje, tipo = 'success') {
  // Usar la función global si está disponible, sino usar alert
  if (window.mostrarPopup && typeof window.mostrarPopup === 'function' && window.mostrarPopup !== mostrarPopup) {
    window.mostrarPopup(mensaje, tipo);
  } else {
    alert(mensaje);
  }
}

// Hacer disponibles globalmente
window.volverAInicio = volverAInicio;
window.mostrarPopup = mostrarPopup;
