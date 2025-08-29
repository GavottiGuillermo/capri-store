/*!
    * Start Bootstrap - Freelancer v6.0.4 (https://startbootstrap.com/themes/freelancer)
    * Copyright 2013-2020 Start Bootstrap
    * Licensed under MIT (https://github.com/StartBootstrap/startbootstrap-freelancer/blob/master/LICENSE)
    */
    (function($) {
    "use strict"; // Start of use strict
  
    // Smooth scrolling using jQuery easing
    $('a.js-scroll-trigger[href*="#"]:not([href="#"])').click(function() {
      if (location.pathname.replace(/^\//, '') == this.pathname.replace(/^\//, '') && location.hostname == this.hostname) {
        var target = $(this.hash);
        target = target.length ? target : $('[name=' + this.hash.slice(1) + ']');
        if (target.length) {
          $('html, body').animate({
            scrollTop: (target.offset().top - 71)
          }, 1000, "easeInOutExpo");
          return false;
        }
      }
    });
  
    // Scroll to top button appear
    $(document).scroll(function() {
      var scrollDistance = $(this).scrollTop();
      if (scrollDistance > 100) {
        $('.scroll-to-top').fadeIn();
      } else {
        $('.scroll-to-top').fadeOut();
      }
    });
  
    // Closes responsive menu when a scroll trigger link is clicked
    $('.js-scroll-trigger').click(function() {
      $('.navbar-collapse').collapse('hide');
    });
  
    // Activate scrollspy to add active class to navbar items on scroll
    $('body').scrollspy({
      target: '#mainNav',
      offset: 80
    });
  
    // Collapse Navbar
    var navbarCollapse = function() {
      var nav = $("#mainNav");
      if (nav.length && nav.offset()) {
        if (nav.offset().top > 100) {
          nav.addClass("navbar-shrink");
        } else {
          nav.removeClass("navbar-shrink");
        }
      }
    };
    // Collapse now if page is not at top
    navbarCollapse();
    // Collapse the navbar when page is scrolled
    $(window).scroll(navbarCollapse);
  
    // Floating label headings for the contact form
    $(function() {
      $("body").on("input propertychange", ".floating-label-form-group", function(e) {
        $(this).toggleClass("floating-label-form-group-with-value", !!$(e.target).val());
      }).on("focus", ".floating-label-form-group", function() {
        $(this).addClass("floating-label-form-group-with-focus");
      }).on("blur", ".floating-label-form-group", function() {
        $(this).removeClass("floating-label-form-group-with-focus");
      });
    });
  
  })(jQuery); // End of use strict
  
  // ==== CARRITO DE COMPRAS UNIFICADO (SIDEBAR) ====

// Cargar carrito desde localStorage o iniciar vacío
let cartItems = JSON.parse(localStorage.getItem("carrito")) || [];

// Guardar el carrito en localStorage
function guardarCarrito() {
  localStorage.setItem("carrito", JSON.stringify(cartItems));
}

// Agregar un producto al carrito (permite repetidos con cantidad)
function agregarAlCarrito(nombre, precio, img, cantidad = 1, producto = null) {
  // Validar datos antes de agregar
  if (!nombre || isNaN(Number(precio)) || !img || isNaN(Number(cantidad)) || Number(cantidad) < 1) return;

  precio = Number(precio);
  cantidad = Number(cantidad);

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
  guardarCarrito();
  actualizarCartSidenav();
}

// Vaciar el carrito
function vaciarCarrito() {
  cartItems = [];
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
  const lista = document.getElementById("cart-sidenav-items");
  const total = document.getElementById("cart-sidenav-total");
  const cartCount = document.getElementById("cart-count");
  if (!lista || !total) return;
  lista.innerHTML = "";
  let suma = 0;
  let cantidadTotal = 0;
  if (!Array.isArray(cartItems)) cartItems = [];
  // Filtrar productos inválidos
  cartItems = cartItems.filter(item => item && item.nombre && !isNaN(Number(item.precio)) && item.img && !isNaN(Number(item.cantidad)) && Number(item.cantidad) > 0);
  if (cartItems.length === 0) {
    lista.innerHTML = `<li class='text-center py-5' style='color:#6b0a0a;'>Tu carrito está vacío.<br><button class='btn btn-rosado mt-3' onclick='closeCartSidenav()'>Seguir comprando</button></li>`;
    total.textContent = "$0.00 ARS";
    if (cartCount) cartCount.textContent = "0";
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
  // Cambiar el texto y acción del botón de compra
  const finalizarBtn = document.querySelector('.cart-sidenav .btn-rosado');
  if (finalizarBtn) {
    finalizarBtn.textContent = 'Comenzar Compra';
    finalizarBtn.onclick = function() {
      window.location.href = 'checkout.html';
    };
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
document.addEventListener('DOMContentLoaded', function() {
  // Si existen los elementos de detalle, aplica la validación
  const btnAgregar = document.getElementById('btnAgregarCarrito');
  const selectTalle = document.getElementById('size');
  const inputCantidad = document.getElementById('quantity');
  const productForm = document.getElementById('productForm');
  if (btnAgregar && selectTalle && inputCantidad && productForm) {
    // Set defaults and enable button for detalle.html
    selectTalle.value = "M";
    inputCantidad.value = 1;
    btnAgregar.disabled = false;
    btnAgregar.classList.remove('bg-rosado', 'opacity-50');
    btnAgregar.classList.add('bg-vino-tinto', 'hover:bg-rosado');
    function validarFormulario() {
      const talleValido = selectTalle.value !== "";
      const cantidadValida = inputCantidad.value && Number(inputCantidad.value) > 0;
      if (talleValido && cantidadValida) {
        btnAgregar.disabled = false;
        btnAgregar.classList.remove('bg-rosado', 'opacity-50');
        btnAgregar.classList.add('bg-vino-tinto', 'hover:bg-rosado');
      } else {
        btnAgregar.disabled = true;
        btnAgregar.classList.remove('bg-vino-tinto', 'hover:bg-rosado');
        btnAgregar.classList.add('bg-rosado', 'opacity-50');
      }
    }
    selectTalle.addEventListener('change', validarFormulario);
    inputCantidad.addEventListener('input', validarFormulario);
    validarFormulario();
    // Agregar producto al carrito desde detalle con validación de stock
    productForm.addEventListener("submit", async function(e) {
      e.preventDefault();
      const producto = JSON.parse(localStorage.getItem('productoDetalle'));
      const size = selectTalle.value;
      const quantity = parseInt(inputCantidad.value);
      if (!producto || !size || !quantity || quantity < 1) return;
      // Validar stock antes de agregar
      let id = producto.id_articulo;
      if (!id && producto.img) {
        const m = decodeURIComponent(producto.img).match(/\/(\d+)-[^/]+/);
        if (m && m[1]) id = parseInt(m[1], 10);
      }
      if (!id) {
        mostrarPopup('No se pudo determinar el ID del producto.');
        return;
      }
      try {
        const resp = await fetch('https://capri-store.onrender.com/validar-stock-carrito', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [id] })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          mostrarPopup('Error al validar stock. Intenta nuevamente.');
          return;
        }
        if (data.faltantes && data.faltantes.includes(id)) {
          alert('El producto ' + producto.nombre + ' ya no se encuentra en stock.');
          return;
        }
      } catch (err) {
        mostrarPopup('Error de conexión al validar stock.');
        return;
      }
      agregarAlCarrito(
        `${producto.nombre} (Talle: ${size})`,
        Number(producto.precio),
        producto.img,
        quantity,
        producto
      );
      mostrarPopup(`Producto agregado al carrito: ${producto.nombre} (Talle: ${size}) x${quantity}`);
      productForm.reset();
      selectTalle.value = "M";
      inputCantidad.value = 1;
      btnAgregar.disabled = false;
      btnAgregar.classList.remove('bg-rosado', 'opacity-50');
      btnAgregar.classList.add('bg-vino-tinto', 'hover:bg-rosado');
      validarFormulario();
    });
  }
  // Actualiza el sidebar al cargar la página
  actualizarCartSidenav();
});

// === ANIMACIONES DE SCROLL Y APARICIÓN DE ELEMENTOS ===

// Función para detectar si un elemento está visible en el viewport
function isElementInViewport(el, threshold = 0.1) {
  const rect = el.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  return (
    rect.top <= windowHeight * (1 - threshold) &&
    rect.bottom >= windowHeight * threshold
  );
}

// Función para animar elementos al hacer scroll
function animateOnScroll() {
  // Elementos que aparecen con fade-in
  const fadeElements = document.querySelectorAll('.fade-in, .section-title, .progressive-reveal, .card-animate, .checkout-section');
  
  fadeElements.forEach(element => {
    if (isElementInViewport(element, 0.15)) {
      element.classList.add('visible');
    }
  });

  // Elementos con fade-in desde la izquierda
  const fadeLeftElements = document.querySelectorAll('.fade-in-left');
  fadeLeftElements.forEach(element => {
    if (isElementInViewport(element, 0.15)) {
      element.classList.add('visible');
    }
  });

  // Elementos con fade-in desde la derecha
  const fadeRightElements = document.querySelectorAll('.fade-in-right');
  fadeRightElements.forEach(element => {
    if (isElementInViewport(element, 0.15)) {
      element.classList.add('visible');
    }
  });
}

// Función para agregar efecto parallax suave
function parallaxEffect() {
  const scrolled = window.pageYOffset;
  const parallaxElements = document.querySelectorAll('.parallax-element');
  
  parallaxElements.forEach(element => {
    const rate = scrolled * -0.5;
    element.style.transform = `translateY(${rate}px)`;
  });
}

// Throttle function para optimizar el rendimiento
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

// Event listeners optimizados
const throttledAnimateOnScroll = throttle(animateOnScroll, 100);
const throttledParallaxEffect = throttle(parallaxEffect, 16);

// Inicializar animaciones cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  // Ejecutar animaciones iniciales
  animateOnScroll();
  
  // Agregar clases de animación a elementos específicos
  setupAnimationClasses();
  
  // Configurar Intersection Observer para mejor rendimiento
  setupIntersectionObserver();
});

// Función para configurar clases de animación automáticamente
function setupAnimationClasses() {
  // Agregar clase fade-in a todas las cards de productos
  const productCards = document.querySelectorAll('.card-product');
  productCards.forEach((card, index) => {
    card.classList.add('progressive-reveal');
    if (index % 2 === 0) {
      card.classList.add('fade-in-left');
    } else {
      card.classList.add('fade-in-right');
    }
  });

  // Agregar clase a títulos de sección
  const sectionTitles = document.querySelectorAll('h1, h2.display-4, h2.display-5');
  sectionTitles.forEach(title => {
    title.classList.add('section-title');
  });

  // Agregar animación al hero content
  const heroContent = document.querySelector('.position-absolute.w-100.h-100');
  if (heroContent) {
    heroContent.classList.add('hero-content');
  }

  // Agregar micro-bounces a botones importantes
  const importantButtons = document.querySelectorAll('.btn-rosado, .btn-vino-tinto');
  importantButtons.forEach(btn => {
    btn.classList.add('micro-bounce');
  });
}

// Configurar Intersection Observer para mejor rendimiento
function setupIntersectionObserver() {
  if ('IntersectionObserver' in window) {
    const observerOptions = {
      root: null,
      rootMargin: '-10% 0px -10% 0px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          // Dejar de observar el elemento una vez que sea visible
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observar todos los elementos animables
    const animatableElements = document.querySelectorAll(
      '.fade-in, .fade-in-left, .fade-in-right, .section-title, .progressive-reveal, .card-animate, .checkout-section'
    );
    
    animatableElements.forEach(el => {
      observer.observe(el);
    });
  } else {
    // Fallback para navegadores sin soporte de Intersection Observer
    window.addEventListener('scroll', throttledAnimateOnScroll);
    window.addEventListener('scroll', throttledParallaxEffect);
  }
}

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
function smoothScrollTo(target, duration = 1000) {
  const targetElement = document.querySelector(target);
  if (!targetElement) return;
  
  const targetPosition = targetElement.offsetTop - 80; // Offset para navbar
  const startPosition = window.pageYOffset;
  const distance = targetPosition - startPosition;
  let startTime = null;
  
  function animation(currentTime) {
    if (startTime === null) startTime = currentTime;
    const timeElapsed = currentTime - startTime;
    const run = easeInOutQuart(timeElapsed, startPosition, distance, duration);
    window.scrollTo(0, run);
    if (timeElapsed < duration) requestAnimationFrame(animation);
  }
  
  function easeInOutQuart(t, b, c, d) {
    t /= d/2;
    if (t < 1) return c/2*t*t*t*t + b;
    t -= 2;
    return -c/2 * (t*t*t*t - 2) + b;
  }
  
  requestAnimationFrame(animation);
}

// Función para limpiar carrito después de compra exitosa (usada por success.js)
function limpiarCarritoDespuesDeCompra() {
  console.log('🧹 Limpiando carrito después de compra exitosa...');
  vaciarCarrito();
  mostrarPopup('¡Compra realizada! El carrito ha sido vaciado.');
}


