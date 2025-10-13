// === PREPARAR ITEMS PARA MERCADO PAGO ===
function prepararItemsParaMP(cartItems) {
  return cartItems.map(item => {
    // Usar id_articulo si está presente, si no, intentar extraerlo del path de la imagen
    let id = item.id_articulo || item.id;
    if (!id && item.img) {
      id = obtenerIdProductoDesdeCarpeta(item.img);
    }
    return {
      id: id || undefined,
      title: item.nombre,
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
  const camposDireccion = [
    document.getElementById('calleNumero'),
    document.getElementById('codigoPostal'),
    document.getElementById('ciudad'),
    document.getElementById('provincia'),
    document.getElementById('referencias'),
    document.getElementById('calcularEnvio')
  ];
  if (retiroLocal && retiroLocal.checked) {
    if (seccionDatosEnvio) seccionDatosEnvio.style.display = 'none';
    camposDireccion.forEach(campo => { if (campo) campo.disabled = true; });
    costoEnvio = 0;
    cargarResumenCompra();
  } else if (envioDomicilio && envioDomicilio.checked) {
    if (seccionDatosEnvio) seccionDatosEnvio.style.display = 'block';
    camposDireccion.forEach(campo => { if (campo) campo.disabled = false; });
    // El costo de envío se calcula aparte
    cargarResumenCompra();
  }
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
    const resp = await fetch('https://capri-store.onrender.com/validar-stock-carrito', {
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


function verificarCamposCompletos() {
  const calleNumero = document.getElementById('calleNumero');
  const codigoPostal = document.getElementById('codigoPostal');
  const ciudad = document.getElementById('ciudad');
  const provincia = document.getElementById('provincia');
  const calcularEnvioBtn = document.getElementById('calcularEnvio');
  const camposCompletos = calleNumero && calleNumero.value.trim() && 
                         codigoPostal && codigoPostal.value.trim() && 
                         ciudad && ciudad.value.trim() && 
                         provincia && provincia.value;
  if (calcularEnvioBtn) {
    calcularEnvioBtn.disabled = !camposCompletos;
  }
  return camposCompletos;
}

function calcularEnvio() {
  if (!verificarCamposCompletos()) {
    mostrarPopup('Por favor completa todos los campos de dirección obligatorios', 'warning');
    return;
  }
  const codigoPostal = document.getElementById('codigoPostal').value.trim();
  const ciudad = document.getElementById('ciudad').value.trim();
  const provincia = document.getElementById('provincia').value;
  if (!/^\d{4}$/.test(codigoPostal)) {
    mostrarPopup('Por favor ingresa un código postal válido (4 dígitos)', 'warning');
    return;
  }
  const calcularBtn = document.getElementById('calcularEnvio');
  calcularBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Calculando...';
  calcularBtn.disabled = true;
  try {
    const cotizaciones = generarOpcionesBasicas(codigoPostal, ciudad, provincia);
    mostrarOpcionesEnvio(cotizaciones, { codigoPostal, ciudad, provincia });
  } catch (error) {
    console.error('Error al calcular envío:', error);
    const cotizacionesFallback = generarOpcionesBasicas(codigoPostal, ciudad, provincia);
    mostrarOpcionesEnvio(cotizacionesFallback, { codigoPostal, ciudad, provincia });
  } finally {
    calcularBtn.innerHTML = '<i class="fas fa-calculator mr-2"></i>Calcular costo de envío';
    calcularBtn.disabled = false;
  }
}

// ... (puedes agregar aquí helpers de envío, tabla de precios, etc. si lo necesitas)

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
    const resp = await fetch('https://capri-store.onrender.com/validar-stock-carrito', {
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
      calleNumero: formData.get('calleNumero'),
      codigoPostal: formData.get('codigoPostal'),
      ciudad: formData.get('ciudad'),
      provincia: formData.get('provincia'),
      referencias: formData.get('referencias')
    };
  }
  const checkoutData = {
    nombre: formData.get('nombre'),
    apellido: formData.get('apellido'),
    telefono: formData.get('telefono'),
    tipoEntrega: tipoEntrega,
    datosEnvio: datosEnvio,
    metodoEnvio: metodoEnvio,
    items: cartItems,
    costoEnvio: costoEnvio
  };
  // Preparar items para Mercado Pago con IDs correctos
  let items = prepararItemsParaMP(cartItems);
  if (costoEnvio > 0) {
    items.push({
      id: 'ENVIO',
      title: 'Costo de Envío',
      quantity: 1,
      currency_id: 'ARS',
      unit_price: Number(costoEnvio)
    });
  }
  // Deshabilitar botón y mostrar loading
  const pagarBtn = document.getElementById('iniciarPago');
  pagarBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Procesando...';
  pagarBtn.disabled = true;
  // LOG: Mostrar datos que se enviarán al backend
  console.log('[checkout] Enviando a /crear-preferencia:', {
    items,
    datosComprador: checkoutData
  });
  try {
    // Usar la URL absoluta del backend en Render
    const API_URL = 'https://capri-store.onrender.com/crear-preferencia';
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

// === EVENT LISTENERS PRINCIPALES ===
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 Checkout inicializando...');
  
  // Remover clase no-js para activar animaciones
  document.documentElement.classList.remove('no-js');
  
  // Inicializar animaciones primero
  console.log('🎭 Inicializando animaciones...');
  initializeAnimations();
  
  // PREVENIR DOBLE CARGA - Inicializar datos después de las animaciones
  console.log('📊 Cargando resumen de compra inicial...');
  setTimeout(() => {
    cargarResumenCompra();
  }, 200);
  
  console.log('🚛 Configurando tipo de entrega...');
  manejarTipoEntrega();
  
  // Configurar event listeners para tipo de entrega
  const retiroLocal = document.getElementById('retiroLocal');
  const envioDomicilio = document.getElementById('enviosDomicilio');
  const iniciarPagoBtn = document.getElementById('iniciarPago');
  const calcularEnvioBtn = document.getElementById('calcularEnvio');
  const calleNumero = document.getElementById('calleNumero');
  const codigoPostal = document.getElementById('codigoPostal');
  const ciudad = document.getElementById('ciudad');
  const provincia = document.getElementById('provincia');
  
  if (retiroLocal) retiroLocal.addEventListener('change', manejarTipoEntrega);
  if (envioDomicilio) envioDomicilio.addEventListener('change', manejarTipoEntrega);
  
  [calleNumero, codigoPostal, ciudad, provincia].forEach(campo => {
    if (campo) {
      campo.addEventListener('input', verificarCamposCompletos);
      campo.addEventListener('change', verificarCamposCompletos);
    }
  });
  
  if (calcularEnvioBtn) calcularEnvioBtn.addEventListener('click', calcularEnvio);
  
  if (iniciarPagoBtn) {
    console.log('✅ Botón iniciar pago encontrado');
    iniciarPagoBtn.addEventListener('click', function(e) {
      console.log('[checkout] Click en #iniciarPago, llamando iniciarProcesoPago');
      iniciarProcesoPago();
    });
  } else {
    console.warn('⚠️ No se encontró el botón #iniciarPago');
  }
  
  // UNA SOLA ANIMACIÓN DE ENTRADA SUAVE - Control mejorado para evitar conflictos
  setTimeout(() => {
    // Asegurar que el título principal esté visible desde el inicio
    const mainTitle = document.querySelector('h1.display-4');
    if (mainTitle) {
      mainTitle.style.opacity = '1';
      mainTitle.style.transform = 'none';
      mainTitle.style.visibility = 'visible';
    }
    
    // Hacer visible el contenido principal
    const mainContent = document.querySelector('.main-section');
    if (mainContent) mainContent.classList.add('visible');
    
    // Activar secciones del checkout de forma escalonada pero rápida
    const checkoutSections = document.querySelectorAll('.checkout-section');
    checkoutSections.forEach((section, index) => {
      setTimeout(() => {
        section.classList.add('visible');
      }, index * 50); // Reducido de 100ms a 50ms
    });
    
    // Activar animaciones laterales solo si están en viewport
    const fadeInElements = document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right');
    fadeInElements.forEach(el => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.8) {
        el.classList.add('visible');
      }
    });
    
  }, 100); // Reducido de múltiples timeouts a uno solo
  
  console.log('✅ Checkout inicializado correctamente');
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

// === ANIMACIONES Y EFECTOS VISUALES ===
function initializeAnimations() {
  // Activar animaciones después de un pequeño delay
  setTimeout(() => {
    const elements = document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right, .section-title, .checkout-section');
    elements.forEach((element, index) => {
      setTimeout(() => {
        element.classList.add('visible');
      }, index * 100); // Escalonar las animaciones
    });
  }, 150);
}

// Hacer disponibles globalmente
window.volverAInicio = volverAInicio;
window.mostrarPopup = mostrarPopup;
