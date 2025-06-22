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
      if ($("#mainNav").offset().top > 100) {
        $("#mainNav").addClass("navbar-shrink");
      } else {
        $("#mainNav").removeClass("navbar-shrink");
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
  
  // ==== CARRITO DE COMPRAS ====

// Cargar carrito desde localStorage o iniciar vacío
let cartItems = JSON.parse(localStorage.getItem("carrito")) || [];

// Guardar el carrito en localStorage
function guardarCarrito() {
  localStorage.setItem("carrito", JSON.stringify(cartItems));
}

// Agregar un producto al carrito
function agregarAlCarrito(nombre, precio) {
  // Verifica si ya existe el producto en el carrito
  if (cartItems.some(item => item.nombre === nombre)) {
    mostrarPopup(`El artículo "${nombre}" ya está en el carrito`);
    return;
  }
  cartItems.push({ nombre, precio });
  guardarCarrito();
  actualizarCarrito();
  mostrarPopup(`Artículo "${nombre}" agregado al carrito`);
}

// Vaciar el carrito
function vaciarCarrito() {
  cartItems = [];
  guardarCarrito();
  actualizarCarrito();
}

// Actualizar la vista del carrito en el modal
function actualizarCarrito() {
  const lista = document.getElementById("cart-items");
  const total = document.getElementById("cart-total");
  const contador = document.getElementById("cart-count");

  if (!lista || !total || !contador) return; // seguridad por si aún no está renderizado

  lista.innerHTML = "";
  let suma = 0;

  cartItems.forEach((item, idx) => {
    suma += item.precio;
    const li = document.createElement("li");
    li.className = "list-group-item d-flex justify-content-between align-items-center";
    li.innerHTML = `
      <span>${item.nombre} <span class="text-muted ml-2">AR$${item.precio.toFixed(2)}</span></span>
      <button class="btn btn-sm btn-danger quitar-item" data-idx="${idx}">Quitar</button>
    `;
    lista.appendChild(li);
  });

  total.textContent = suma.toFixed(2);
  contador.textContent = cartItems.length;

  // Asignar evento a los botones "Quitar"
  document.querySelectorAll('.quitar-item').forEach(btn => {
    btn.addEventListener('click', function() {
      const idx = parseInt(this.getAttribute('data-idx'));
      quitarDelCarrito(idx);
    });
  });
}

// Quitar un producto específico del carrito
function quitarDelCarrito(idx) {
  cartItems.splice(idx, 1);
  guardarCarrito();
  actualizarCarrito();
}

// Mostrar pop-up de agregado al carrito
function mostrarPopup(mensaje) {
  // Si ya existe, elimínalo primero
  let popup = document.getElementById("popup-carrito");
  if (popup) popup.remove();

  popup = document.createElement("div");
  popup.id = "popup-carrito";
  popup.style.position = "fixed";
  popup.style.top = "30px";
  popup.style.right = "30px";
  popup.style.background = "#1abc9c";
  popup.style.color = "#fff";
  popup.style.padding = "16px 24px";
  popup.style.borderRadius = "8px";
  popup.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
  popup.style.zIndex = "9999";
  popup.style.fontSize = "1.1rem";
  popup.textContent = mensaje;
  document.body.appendChild(popup);

  setTimeout(() => {
    popup.remove();
  }, 2000);
}

// Vaciar el carrito
function vaciarCarrito() {
  cartItems = [];
  guardarCarrito();
  actualizarCarrito();
}

// Redirigir a Mercado Pago al finalizar compra
document.addEventListener("DOMContentLoaded", function() {
  actualizarCarrito();

  const finalizarBtn = document.getElementById('finalizar-compra-btn');
  if (finalizarBtn) {
    finalizarBtn.addEventListener('click', function() {
      if (cartItems.length === 0) {
        alert("El carrito está vacío.");
        return;
      }
      mostrarResumenCompra();
      $('#checkoutModal').modal('show');
    });
  }

  function mostrarResumenCompra() {
    let resumen = '';
    let total = 0;
    cartItems.forEach(item => {
      resumen += `<div>${item.nombre} - $${item.precio.toFixed(2)}</div>`;
      total += item.precio;
    });
    resumen += `<hr><strong>Total: $${total.toFixed(2)}</strong>`;
    document.getElementById('resumenCompra').innerHTML = resumen;
  }

  // Cambia aquí la URL de tu backend desplegado en Render
  const BACKEND_URL = 'https://tu-backend.onrender.com/confirmar-compra';

  document.getElementById('checkoutForm').addEventListener('submit', function(e) {
    e.preventDefault();

    // Obtener datos del cliente
    const nombre = document.getElementById('nombre').value;
    const apellido = document.getElementById('apellido').value;
    const email = document.getElementById('email').value;

    // Construir resumen y total
    let resumen = '';
    let total = 0;
    cartItems.forEach(item => {
      resumen += `${item.nombre} - $${item.precio.toFixed(2)}\n`;
      total += item.precio;
    });

    // Enviar datos al backend
    fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        apellido,
        email,
        resumen,
        total
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        // Vaciar carrito y cerrar modal
        cartItems = [];
        guardarCarrito();
        actualizarCarrito();
        $('#checkoutModal').modal('hide');
        // Mostrar mensaje de éxito
        mostrarMensajeCorreoExitoso(data.numeroPedido);
      } else {
        alert('Ocurrió un error al enviar el correo. Intenta nuevamente.');
      }
    })
    .catch(() => alert('Error de conexión con el backend'));
  });

  function mostrarMensajeCorreoExitoso(numeroPedido) {
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.style.background = 'rgba(0,0,0,0.5)';
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content text-center p-4">
          <h3 class="text-success mb-3">¡Compra confirmada!</h3>
          <p>Te enviamos un correo con los detalles de tu compra.</p>
          <p>Tu número de pedido es: <strong>${numeroPedido}</strong></p>
          <button class="btn btn-primary mt-2" onclick="location.href='/'">Aceptar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
  }
});


