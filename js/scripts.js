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
function agregarAlCarrito(nombre, precio, img, cantidad = 1) {
  // Validar datos antes de agregar
  if (!nombre || isNaN(Number(precio)) || !img || isNaN(Number(cantidad)) || Number(cantidad) < 1) return;
  precio = Number(precio);
  cantidad = Number(cantidad);
  const idx = cartItems.findIndex(item => item.nombre === nombre && item.img === img);
  if (idx !== -1) {
    cartItems[idx].cantidad += cantidad;
  } else {
    cartItems.push({ nombre, precio, img, cantidad });
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

// Mostrar pop-up de agregado al carrito
function mostrarPopup(mensaje) {
  let popup = document.getElementById("popup-carrito");
  if (popup) popup.remove();
  popup = document.createElement("div");
  popup.id = "popup-carrito";
  popup.style.position = "fixed";
  popup.style.top = "30px";
  popup.style.right = "30px";
  popup.style.background = "#6b0a0a";
  popup.style.color = "#fff";
  popup.style.padding = "16px 24px";
  popup.style.borderRadius = "8px";
  popup.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
  popup.style.zIndex = "9999";
  popup.style.fontSize = "1.1rem";
  popup.textContent = mensaje;
  document.body.appendChild(popup);
  setTimeout(() => { popup.remove(); }, 2000);
}

// Mostrar el sidebar del carrito
function openCartSidenav() {
  document.getElementById('cartSidenav').style.display = 'block';
  document.getElementById('cartSidenavOverlay').style.display = 'block';
  actualizarCartSidenav();
}

// Cerrar el sidebar del carrito
function closeCartSidenav() {
  document.getElementById('cartSidenav').style.display = 'none';
  document.getElementById('cartSidenavOverlay').style.display = 'none';
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
    lista.innerHTML = `<li class='text-center py-5 text-rosado'>Tu carrito está vacío.<br><button class='btn btn-rosado mt-3' onclick='closeCartSidenav()'>Seguir comprando</button></li>`;
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
      <li class="list-group-item d-flex justify-content-between align-items-center" style="border:none; background:none;">
        <div class="d-flex align-items-center">
          <img src="${item.img || ''}" alt="${item.nombre}" style="width:48px; height:48px; object-fit:cover; border-radius:8px; margin-right:12px;">
          <div>
            <div class="font-weight-bold">${item.nombre}</div>
            <div class="text-rosado">AR$${precioNum.toFixed(2)} x${cantidadNum}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-danger quitar-item" data-idx="${idx}">${buttonText}</button>
      </li>
    `;
  });
  total.textContent = `$${suma.toFixed(2)} ARS`;
  if (cartCount) cartCount.textContent = cantidadTotal;
  // Asignar evento a los botones "Quitar"
  lista.querySelectorAll('.quitar-item').forEach(btn => {
    btn.addEventListener('click', function() {
      const idx = parseInt(this.getAttribute('data-idx'));
      quitarDelCarrito(idx);
    });
  });
  guardarCarrito();
}

// Finalizar compra - redirigir a checkout
function finalizarCompraSidebar() {
  if (cartItems.length === 0) {
    mostrarPopup("El carrito está vacío.");
    return;
  }
  // Redirigir a la página de checkout
  window.location.href = 'checkout.html';
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
    // Agregar producto al carrito desde detalle
    productForm.addEventListener("submit", function(e) {
      e.preventDefault();
      const producto = JSON.parse(localStorage.getItem('productoDetalle'));
      const size = selectTalle.value;
      const quantity = parseInt(inputCantidad.value);
      if (!producto || !size || !quantity || quantity < 1) return;
      agregarAlCarrito(
        `${producto.nombre} (Talle: ${size})`,
        Number(producto.precio),
        producto.img,
        quantity
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


