/*!
    * Start Bootstrap - Freelancer v6.0.4 (https://startbootstrap.com/themes/freelancer)
    * Copyright 2013-2020 Start Bootstrap
    * Licensed under MIT (https://github.com/StartBootstrap/startbootstrap-freelancer/blob/master/LICENSE)
    */
    // ...existing code...
  
  // ==== CARRITO DE COMPRAS UNIFICADO (SIDEBAR) ====

// Declarar variable global del carrito (se inicializa en inicializarCarrito)
let cartItems;

// Inicializar carrito al cargar la página
function inicializarCarrito() {
  console.log('🚀 Inicializando carrito...');
  
  // Verificar si hay una compra exitosa reciente (últimos 30 segundos)
  const compraExitosa = localStorage.getItem('compraExitosa');
  const compraTimestamp = localStorage.getItem('compraExitosaTimestamp');
  
  if (compraExitosa === 'true' && compraTimestamp) {
    const tiempoTranscurrido = Date.now() - parseInt(compraTimestamp);
    const TIEMPO_LIMITE = 30000; // 30 segundos
    
    if (tiempoTranscurrido < TIEMPO_LIMITE) {
      console.log('🛒 Compra exitosa detectada, manteniendo carrito vacío');
      cartItems = [];
      guardarCarrito();
    } else {
      // Limpiar marca de compra exitosa si ya pasó mucho tiempo
      localStorage.removeItem('compraExitosa');
      localStorage.removeItem('compraExitosaTimestamp');
      // Cargar carrito normal desde localStorage
      let cartRaw = localStorage.getItem("carrito");
      try {
        cartItems = cartRaw ? JSON.parse(cartRaw) : [];
        if (!Array.isArray(cartItems)) cartItems = [];
      } catch {
        cartItems = [];
      }
    }
  } else {
    // No hay compra exitosa, cargar carrito normal desde localStorage
    let cartRaw = localStorage.getItem("carrito");
    try {
      cartItems = cartRaw ? JSON.parse(cartRaw) : [];
      if (!Array.isArray(cartItems)) cartItems = [];
    } catch {
      cartItems = [];
    }
  }
  
  // Sincronizar con window
  window.cartItems = cartItems;
  
  actualizarCartSidenav();
  configurarEventListeners();
  console.log('✅ Carrito inicializado');
}

// Configurar event listeners del carrito
function configurarEventListeners() {
  // Event listener para abrir carrito desde navbar
  const cartLink = document.getElementById('navbar-cart-link');
  if (cartLink) {
    cartLink.addEventListener('click', function(e) {
      e.preventDefault();
      openCartSidenav();
    });
  }

  // Event listener para cerrar carrito
  const closeBtn = document.getElementById('closeCartBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeCartSidenav);
  }

  // Event listener para overlay
  const overlay = document.getElementById('cartSidenavOverlay');
  if (overlay) {
    overlay.addEventListener('click', closeCartSidenav);
  }
}

// Guardar el carrito en localStorage
function guardarCarrito() {
  // Validar que cartItems existe y es un array
  if (!cartItems || !Array.isArray(cartItems)) {
    cartItems = [];
  }
  localStorage.setItem("carrito", JSON.stringify(cartItems));
  console.log('🛒 Carrito guardado:', cartItems.length, 'items');
}

// Función auxiliar para cargar carrito respetando compra exitosa
function cargarCarritoDesdeStorage() {
  // Verificar si hay una compra exitosa reciente
  const compraExitosa = localStorage.getItem('compraExitosa');
  const compraTimestamp = localStorage.getItem('compraExitosaTimestamp');
  
  if (compraExitosa === 'true' && compraTimestamp) {
    const tiempoTranscurrido = Date.now() - parseInt(compraTimestamp);
    const TIEMPO_LIMITE = 30000; // 30 segundos
    
    if (tiempoTranscurrido < TIEMPO_LIMITE) {
      console.log('🛒 Compra exitosa activa, carrito se mantiene vacío');
      return [];
    }
  }
  
  // No hay compra exitosa, cargar normal desde localStorage
  try {
    const cartRaw = localStorage.getItem("carrito");
    const items = cartRaw ? JSON.parse(cartRaw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

// Agregar un producto al carrito (permite repetidos con cantidad)
function agregarAlCarrito(nombre, precio, img, cantidad = 1, producto = null) {
  // Validar datos antes de agregar
  if (!nombre || isNaN(Number(precio)) || !img || isNaN(Number(cantidad)) || Number(cantidad) < 1) return;

  precio = Number(precio);
  cantidad = Number(cantidad);

  // Recargar carrito usando la función auxiliar que respeta compra exitosa
  cartItems = cargarCarritoDesdeStorage();

  // Obtener id_articulo del producto o extraerlo del path de la imagen
  let id_articulo = null;
  if (producto && producto.id_articulo) {
    id_articulo = producto.id_articulo;
  } else if (producto && producto.img) {
    try {
      const path = decodeURIComponent(producto.img);
      const m = path.match(/\/(\d+)-[^/]+/);
      if (m && m[1]) {
        id_articulo = parseInt(m[1], 10);
      }
    } catch {}
  } else if (img) {
    try {
      const path = decodeURIComponent(img);
      const m = path.match(/\/(\d+)-[^/]+/);
      if (m && m[1]) {
        id_articulo = parseInt(m[1], 10);
      }
    } catch {}
  }
  if (!id_articulo) {
    console.warn('No se pudo determinar id_articulo para el producto en el carrito:', nombre, img, producto);
  }

  const idx = cartItems.findIndex(item => item.nombre === nombre && item.img === img);
  if (idx !== -1) {
    cartItems[idx].cantidad += cantidad;
  } else {
    cartItems.push({ 
      nombre, 
      precio, 
      img, 
      cantidad,
      id_articulo
    });
  }
  guardarCarrito();
  actualizarCartSidenav();
  console.log('➕ Producto agregado al carrito:', nombre);
  // Abrir automáticamente el sidebar del carrito después de agregar (sin popup)
  openCartSidenav();
}

// Quitar una unidad de un producto del carrito (por índice)
function quitarDelCarrito(idx) {
  if (cartItems[idx] && cartItems[idx].cantidad > 1) {
    // Si hay más de una unidad, reducir la cantidad
    cartItems[idx].cantidad -= 1;
  } else {
    // Si solo hay una unidad, eliminar el producto completo
    cartItems.splice(idx, 1);
  }
  // Sincronizar con window
  window.cartItems = cartItems;
  guardarCarrito();
  actualizarCartSidenav();
}

// Vaciar el carrito
function vaciarCarrito() {
  cartItems = [];
  window.cartItems = cartItems; // Sincronizar con window
  guardarCarrito();
  actualizarCartSidenav();
}

// Mostrar pop-up de agregado al carrito con animación mejorada
function mostrarPopup(mensaje) {
  mostrarPopupAnimado(mensaje);
}

// Mostrar el sidebar del carrito con animación
function openCartSidenav() {
  const cartSidenav = document.getElementById('cartSidenav');
  const overlay = document.getElementById('cartSidenavOverlay');
  
  // Mostrar elementos
  cartSidenav.style.display = 'block';
  overlay.style.display = 'block';
  
  // Forzar reflow para que las transiciones funcionen
  cartSidenav.offsetHeight;
  overlay.offsetHeight;
  
  // Activar animaciones
  setTimeout(() => {
    cartSidenav.classList.add('open');
    overlay.classList.add('show');
  }, 10);
  
  actualizarCartSidenav();
}

// Cerrar el sidebar del carrito con animación
function closeCartSidenav() {
  const cartSidenav = document.getElementById('cartSidenav');
  const overlay = document.getElementById('cartSidenavOverlay');
  
  // Remover clases de animación
  cartSidenav.classList.remove('open');
  overlay.classList.remove('show');
  
  // Ocultar después de la animación
  setTimeout(() => {
    cartSidenav.style.display = 'none';
    overlay.style.display = 'none';
  }, 400); // Coincide con la duración de la transición CSS
}

// Actualizar el contenido del sidebar del carrito
function actualizarCartSidenav() {
  // Recargar carrito usando la función auxiliar que respeta compra exitosa
  cartItems = cargarCarritoDesdeStorage();
  
  // Sincronizar con window
  window.cartItems = cartItems;

  const lista = document.getElementById("cart-sidenav-items");
  const total = document.getElementById("cart-sidenav-total");
  const cartCount = document.getElementById("cart-count");
  
  if (!lista || !total) {
    console.log('⚠️ Elementos del carrito no encontrados en el DOM');
    return;
  }
  
  lista.innerHTML = "";
  let suma = 0;
  let cantidadTotal = 0;

  // Filtrar productos inválidos
  const cartItemsOriginalLength = cartItems.length;
  cartItems = cartItems.filter(item => item && item.nombre && !isNaN(Number(item.precio)) && item.img && !isNaN(Number(item.cantidad)) && Number(item.cantidad) > 0);
  
  // Si se filtraron productos, guardar el carrito actualizado
  if (cartItemsOriginalLength !== cartItems.length) {
    guardarCarrito();
  }
  
  if (cartItems.length === 0) {
    lista.innerHTML = `<li class='text-center py-5' style='color:#6b0a0a;'>Tu carrito está vacío.<br><button class='btn btn-rosado mt-3' onclick='closeCartSidenav()'>Seguir comprando</button></li>`;
    total.textContent = "$0.00 ARS";
    if (cartCount) cartCount.textContent = "0";
    
    // Actualizar botón cuando carrito está vacío
    const finalizarBtn = document.getElementById('finalizarCompraBtn');
    console.log('🔍 Botón encontrado (carrito vacío):', finalizarBtn);
    if (finalizarBtn) {
      finalizarBtn.className = 'btn btn-rosado btn-block font-weight-bold py-3';
      finalizarBtn.textContent = 'Carrito Vacío';
      finalizarBtn.disabled = true;
      finalizarBtn.onclick = null;
      console.log('✅ Botón actualizado a estado vacío');
    }
    
    guardarCarrito();
    return;
  }
  cartItems.forEach((item, idx) => {
    const precioNum = Number(item.precio);
    const cantidadNum = Number(item.cantidad);
    if (isNaN(precioNum) || isNaN(cantidadNum)) return;
    suma += precioNum * cantidadNum;
    cantidadTotal += cantidadNum;
    const buttonText = cantidadNum > 1 ? "Quitar 1" : "Quitar";
    lista.innerHTML += `
      <li class="list-group-item d-flex justify-content-between align-items-center cart-item" style="border:none; background:none; color:#6b0a0a; animation-delay: ${idx * 0.1}s;">
        <div class="d-flex align-items-center">
          <img src="${item.img || ''}" alt="${item.nombre}" style="width:48px; height:48px; object-fit:cover; border-radius:8px; margin-right:12px;">
          <div>
            <div class="font-weight-bold" style="color:#6b0a0a;">${item.nombre}</div>
            <div style="color:#e29ca3;">AR$${precioNum.toFixed(2)} x${cantidadNum}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-danger quitar-item" data-idx="${idx}">${buttonText}</button>
      </li>
    `;
  });
  total.textContent = `$${suma.toFixed(2)} ARS`;
  
  // Actualizar contador con animación mejorada
  updateCartCounterAnimated(cantidadTotal);
  // Asignar evento a los botones "Quitar"
  lista.querySelectorAll('.quitar-item').forEach(btn => {
    btn.addEventListener('click', function() {
      const idx = parseInt(this.getAttribute('data-idx'));
      quitarDelCarrito(idx);
    });
  });
  guardarCarrito();
  // Cambiar el texto, color y acción del botón de compra según el estado del carrito
  const finalizarBtn = document.getElementById('finalizarCompraBtn');
  console.log('🔍 Botón encontrado (final función):', finalizarBtn);
  if (finalizarBtn) {
    if (cartItems.length > 0) {
      // Carrito con productos - botón vino tinto y habilitado
      finalizarBtn.className = 'btn btn-vino-tinto btn-block font-weight-bold py-3';
      finalizarBtn.textContent = 'Comenzar Compra';
      finalizarBtn.disabled = false;
      finalizarBtn.onclick = function() {
        window.location.href = 'checkout.html';
      };
      console.log('✅ Botón actualizado a estado con productos');
    } else {
      // Carrito vacío - botón rosado y deshabilitado
      finalizarBtn.className = 'btn btn-rosado btn-block font-weight-bold py-3';
      finalizarBtn.textContent = 'Carrito Vacío';
      finalizarBtn.disabled = true;
      finalizarBtn.onclick = null;
      console.log('✅ Botón actualizado a estado vacío (final)');
    }
  }
}

// Finalizar compra - validar stock y redirigir a checkout
async function finalizarCompraSidebar() {
  // Obtener productos del carrito
  let cartItems = JSON.parse(localStorage.getItem("carrito")) || [];
  if (!cartItems.length) {
    mostrarPopup('El carrito está vacío.');
    return;
  }
  // Extraer IDs únicos de productos
  const ids = cartItems.map(item => item.id_articulo || item.id).filter(Boolean);
  if (!ids.length) {
    mostrarPopup('No se pudieron obtener los IDs de los productos.');
    return;
  }
  try {
    // Validar stock en backend
    const resp = await fetch('https://capri-store.onrender.com/validar-stock-carrito', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      mostrarPopup('Error al validar stock. Intenta nuevamente.');
      return;
    }
    if (data.faltantes && data.faltantes.length > 0) {
      // Mostrar alerta personalizada por cada producto sin stock
      let nombres = cartItems.filter(item => data.faltantes.includes(item.id_articulo || item.id)).map(item => item.nombre);
      if (nombres.length > 0) {
        alert('El producto ' + nombres.join(', ') + ' ya no se encuentra en stock. Lo quitaremos del carrito.');
      }
      // Quitar productos sin stock del carrito
      cartItems = cartItems.filter(item => !data.faltantes.includes(item.id_articulo || item.id));
      localStorage.setItem("carrito", JSON.stringify(cartItems));
      actualizarCartSidenav();
      return;
    }
    // Si todo ok, redirigir a checkout
    window.location.href = 'checkout.html';
  } catch (e) {
    mostrarPopup('Error de conexión al validar stock.');
  }
}

// === VALIDACIÓN DE BOTÓN AGREGAR AL CARRITO EN DETALLE ===
// ...existing code...

// Función para agregar efecto parallax suave
// ...existing code...

// Función para animar la aparición del popup con más suavidad
function mostrarPopupAnimado(mensaje) {
  let popup = document.getElementById("popup-carrito");
  if (popup) popup.remove();
  
  popup = document.createElement("div");
  popup.id = "popup-carrito";
  popup.className = "animate-scale-in";
  popup.style.cssText = `
    position: fixed;
    top: 30px;
    right: 30px;
    background: #6b0a0a;
    color: #fff;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    z-index: 9999;
    font-size: 1.1rem;
    opacity: 0;
    transform: scale(0.8) translateY(-10px);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  `;
  
  popup.textContent = mensaje;
  document.body.appendChild(popup);
  
  // Animar aparición
  requestAnimationFrame(() => {
    popup.style.opacity = '1';
    popup.style.transform = 'scale(1) translateY(0)';
  });
  
  // Animar desaparición
  setTimeout(() => {
    popup.style.opacity = '0';
    popup.style.transform = 'scale(0.8) translateY(-10px)';
    setTimeout(() => popup.remove(), 400);
  }, 2500);
}

// === MEJORAS ESPECÍFICAS PARA EL CARRITO ===

// Función mejorada para actualizar contador del carrito con animación
function updateCartCounterAnimated(newCount) {
  const cartCount = document.getElementById("cart-count");
  if (!cartCount) return;
  
  const oldCount = cartCount.textContent;
  
  if (oldCount !== newCount.toString()) {
    // Animar salida del número anterior
    cartCount.style.transform = 'scale(0.8)';
    cartCount.style.opacity = '0.5';
    
    setTimeout(() => {
      cartCount.textContent = newCount;
      cartCount.style.transform = 'scale(1.2)';
      cartCount.style.opacity = '1';
      cartCount.classList.add('bounce');
      
      setTimeout(() => {
        cartCount.style.transform = 'scale(1)';
        cartCount.classList.remove('bounce');
      }, 300);
    }, 150);
  }
}

// Smooth scroll mejorado para navegación
// ...existing code...

// Función para limpiar carrito después de compra exitosa (usada por success.js)
function limpiarCarritoDespuesDeCompra() {
  console.log('🧹 Limpiando carrito después de compra exitosa...');
  vaciarCarrito();
  mostrarPopup('¡Compra realizada! El carrito ha sido vaciado.');
}

// === INICIALIZACIÓN AUTOMÁTICA DEL CARRITO ===
// Inicializar carrito cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  inicializarCarrito();
});

// También inicializar cuando la página se carga completamente
window.addEventListener('load', function() {
  inicializarCarrito();
});

// Actualizar carrito cuando la página recupera el foco (usuario vuelve de otra pestaña)
window.addEventListener('focus', function() {
  actualizarCartSidenav();
});

// Actualizar carrito cuando cambia el localStorage (sincronización entre pestañas)
window.addEventListener('storage', function(e) {
  if (e.key === 'carrito') {
    console.log('🔄 Cambio detectado en localStorage, sincronizando carrito...');
    actualizarCartSidenav();
  }
});

// === HACER FUNCIONES DISPONIBLES GLOBALMENTE ===
// Asegurar que las funciones están disponibles en el objeto window
window.agregarAlCarrito = agregarAlCarrito;
window.actualizarCartSidenav = actualizarCartSidenav;
window.openCartSidenav = openCartSidenav;
window.closeCartSidenav = closeCartSidenav;
window.mostrarPopup = mostrarPopup;
window.finalizarCompraSidebar = finalizarCompraSidebar;
window.cartItems = cartItems;


