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
function cargarResumenCompra() {
  const checkoutItems = document.getElementById('checkout-items');
  const subtotalElement = document.getElementById('checkout-subtotal');
  const totalElement = document.getElementById('checkout-total');
  const cartCount = document.getElementById('cart-count');
  let cartItems = JSON.parse(localStorage.getItem("carrito")) || [];
  // Fallback: si carrito está vacío, intentar con productosCompra
  if ((!cartItems || cartItems.length === 0) && localStorage.getItem("productosCompra")) {
    try {
      cartItems = JSON.parse(localStorage.getItem("productosCompra")) || [];
    } catch (e) {
      cartItems = [];
    }
  }
  let subtotal = 0;
  let cantidadTotal = 0;
  if (!cartItems || cartItems.length === 0) {
    if (checkoutItems) checkoutItems.innerHTML = '';
    if (subtotalElement) subtotalElement.textContent = formatPrice(0);
    if (totalElement) totalElement.textContent = formatPrice(0);
    if (cartCount) cartCount.textContent = "0";
    return;
  }
  if (checkoutItems) checkoutItems.innerHTML = '';
  cartItems.forEach((item, index) => {
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
    alert('Por favor completa todos los campos de dirección obligatorios');
    return;
  }
  const codigoPostal = document.getElementById('codigoPostal').value.trim();
  const ciudad = document.getElementById('ciudad').value.trim();
  const provincia = document.getElementById('provincia').value;
  if (!/^\d{4}$/.test(codigoPostal)) {
    alert('Por favor ingresa un código postal válido (4 dígitos)');
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
    alert('Por favor completa todos los campos requeridos');
    return;
  }
  const cartItems = JSON.parse(localStorage.getItem("carrito")) || [];
  if (!cartItems || cartItems.length === 0) {
    alert('Tu carrito está vacío');
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
    email: formData.get('email'),
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
  // Inicializar animaciones de secciones si es necesario
  setTimeout(() => {
    const checkoutSections = document.querySelectorAll('.checkout-section');
    checkoutSections.forEach((section, index) => {
      setTimeout(() => {
        section.classList.add('visible');
      }, index * 200);
    });
  }, 500);
  // Event listener para el carrito en navbar
  const cartLink = document.getElementById('navbar-cart-link');
  if (cartLink) {
    cartLink.addEventListener('click', function(e) {
      e.preventDefault();
      if (typeof openCartSidenav === 'function') {
        openCartSidenav();
      } else {
        window.location.href = 'index.html';
      }
    });
  }
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
    iniciarPagoBtn.addEventListener('click', function(e) {
      console.log('[checkout] Click en #iniciarPago, llamando iniciarProcesoPago');
      iniciarProcesoPago();
    });
  } else {
    console.warn('[checkout] No se encontró el botón #iniciarPago');
  }
  cargarResumenCompra();
  manejarTipoEntrega();
  // Puedes agregar aquí la función de animaciones fade-in si la necesitas
});
