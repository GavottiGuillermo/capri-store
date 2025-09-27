// Event listeners y inicialización de componentes
// Animaciones globales y helpers UI
function parallaxEffect() {
  const scrolled = window.pageYOffset;
  const parallaxElements = document.querySelectorAll('.parallax-element');
  parallaxElements.forEach(element => {
    const rate = scrolled * -0.5;
    element.style.transform = `translateY(${rate}px)`;
  });
}

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

function setupAnimationClasses() {
  const productCards = document.querySelectorAll('.card-product');
  productCards.forEach((card, index) => {
    card.classList.add('progressive-reveal');
    if (index % 2 === 0) {
      card.classList.add('fade-in-left');
    } else {
      card.classList.add('fade-in-right');
    }
  });
  const sectionTitles = document.querySelectorAll('h1, h2.display-4, h2.display-5');
  sectionTitles.forEach(title => {
    title.classList.add('section-title');
  });
  const heroContent = document.querySelector('.position-absolute.w-100.h-100');
  if (heroContent) {
    heroContent.classList.add('hero-content');
  }
  const importantButtons = document.querySelectorAll('.btn-rosado, .btn-vino-tinto');
  importantButtons.forEach(btn => {
    btn.classList.add('micro-bounce');
  });
}

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
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);
    const animatableElements = document.querySelectorAll(
      '.fade-in, .fade-in-left, .fade-in-right, .section-title, .progressive-reveal, .card-animate, .checkout-section'
    );
    animatableElements.forEach(el => {
      observer.observe(el);
    });
  } else {
    window.addEventListener('scroll', throttle(animateOnScroll, 100));
    window.addEventListener('scroll', throttle(parallaxEffect, 16));
  }
}

function animateOnScroll() {
  const fadeElements = document.querySelectorAll('.fade-in, .section-title, .progressive-reveal, .card-animate, .checkout-section');
  fadeElements.forEach(element => {
    if (isElementInViewport(element, 0.15)) {
      element.classList.add('visible');
    }
  });
  const fadeLeftElements = document.querySelectorAll('.fade-in-left');
  fadeLeftElements.forEach(element => {
    if (isElementInViewport(element, 0.15)) {
      element.classList.add('visible');
    }
  });
  const fadeRightElements = document.querySelectorAll('.fade-in-right');
  fadeRightElements.forEach(element => {
    if (isElementInViewport(element, 0.15)) {
      element.classList.add('visible');
    }
  });
}

function isElementInViewport(el, threshold = 0.1) {
  const rect = el.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  return (
    rect.top <= windowHeight * (1 - threshold) &&
    rect.bottom >= windowHeight * threshold
  );
}

function smoothScrollTo(target, duration = 1000) {
  const targetElement = document.querySelector(target);
  if (!targetElement) return;
  const targetPosition = targetElement.offsetTop - 80;
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

document.addEventListener('DOMContentLoaded', function() {
  animateOnScroll();
  setupAnimationClasses();
  setupIntersectionObserver();
});
document.addEventListener('DOMContentLoaded', function() {
  // Manejar carrito sidebar
  var cartLink = document.getElementById('navbar-cart-link');
  if (cartLink) {
    cartLink.addEventListener('click', function(e) {
      e.preventDefault();
      if (typeof openCartSidenav === 'function') {
        openCartSidenav();
      }
    });
  }
  
  // Event listeners para el menú de categorías
  document.querySelectorAll('[data-categoria]').forEach(function(elemento) {
    elemento.addEventListener('click', function(e) {
      e.preventDefault();
      var categoria = this.getAttribute('data-categoria');
      if (typeof mostrarCategoria === 'function') {
        mostrarCategoria(categoria);
      }
    });
  });
  
  // Event listeners para botones del carrito
  var closeCartBtn = document.getElementById('closeCartBtn');
  if (closeCartBtn) {
    closeCartBtn.addEventListener('click', function() {
      if (typeof closeCartSidenav === 'function') {
        closeCartSidenav();
      }
    });
  }
  
  var finalizarCompraBtn = document.getElementById('finalizarCompraBtn');
  if (finalizarCompraBtn) {
    finalizarCompraBtn.addEventListener('click', function() {
      if (typeof finalizarCompraSidebar === 'function') {
        finalizarCompraSidebar();
      }
    });
  }
  
  var cartOverlay = document.getElementById('cartSidenavOverlay');
  if (cartOverlay) {
    cartOverlay.addEventListener('click', function() {
      if (typeof closeCartSidenav === 'function') {
        closeCartSidenav();
      }
    });
  }
  
  // Usar event delegation para botones que se crean dinámicamente
  $(document).on('click', '.ver-detalle-btn', function() {
    console.log('Clic en ver detalle detectado');
    var productoData = $(this).attr('data-producto');
    if (productoData && typeof verDetalleCapri === 'function') {
      try {
        var producto = JSON.parse(productoData);
        verDetalleCapri(producto);
      } catch(e) {
        console.error('Error al parsear datos del producto:', e);
      }
    }
  });
  
  // Event delegation para botones "Ver más"
  $(document).on('click', '[data-accion^="cargarMas"]', function() {
    var accion = $(this).attr('data-accion');
    if (accion === 'cargarMasNovedades' && typeof cargarMasNovedades === 'function') {
      cargarMasNovedades();
    } else if (accion === 'cargarMasProductos' && typeof cargarMasProductos === 'function') {
      cargarMasProductos();
    }
  });
  
  // Permitir acceder al detalle desde toda la tarjeta usando event delegation
  $(document).on('click', '.card-product', function(e) {
    // Evitar doble trigger si se hace clic en el botón
    if ($(e.target).hasClass('ver-detalle-btn') || $(e.target).closest('.ver-detalle-btn').length) return;
    
    const btn = $(this).find('.ver-detalle-btn');
    if (btn.length) {
      btn.trigger('click');
    }
  });
  
  // Inicializar animaciones de aparición
  setTimeout(() => {
    const elements = document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right, .section-title, .progressive-reveal');
    elements.forEach((el, index) => {
      setTimeout(() => {
        if (typeof setupAnimationClasses === 'function') {
          el.classList.add('visible');
        }
      }, index * 100);
    });
  }, 300);

  // Mejorar navegación suave para enlaces internos
  const navLinks = document.querySelectorAll('a[href^="#"]');
  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href !== '#' && href.length > 1) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          const offsetTop = target.offsetTop - 80; // Offset para navbar
          window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
          });
        }
      }
    });
  });

  // Agregar efectos de hover a elementos interactivos
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', function() {
      this.style.transform = 'translateY(-2px) scale(1.02)';
    });
    btn.addEventListener('mouseleave', function() {
      this.style.transform = 'translateY(0) scale(1)';
    });
  });
  
  // Click de "Refrescar stock"
  const linkRefrescar = document.getElementById('link-refrescar');
  if (linkRefrescar) {
    linkRefrescar.addEventListener('click', function(e) {
      e.preventDefault();
      if (typeof refrescarStock === 'function') refrescarStock();
    });
  }

  // ===============================
  // MANEJO DEL FORMULARIO DE CONTACTO
  // ===============================
  const contactForm = document.getElementById('contactForm');
  const contactAlert = document.getElementById('contactAlert');
  const enviarContactoBtn = document.getElementById('enviarContacto');

  // Función para validar campos y cambiar estado del botón
  function validarCamposContacto() {
    const nombreField = document.getElementById('nombre');
    const emailField = document.getElementById('email');
    const mensajeField = document.getElementById('mensaje');
    
    const nombre = nombreField.value.trim();
    const email = emailField.value.trim();
    const mensaje = mensajeField.value.trim();
    
    // Validar email básico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emailValido = emailRegex.test(email);
    
    // Aplicar estilos visuales a los campos
    // Nombre
    if (nombre) {
      nombreField.classList.remove('campo-invalido');
      nombreField.classList.add('campo-valido');
    } else {
      nombreField.classList.remove('campo-valido');
      if (nombreField.value.length > 0) { // Solo mostrar inválido si el usuario ha empezado a escribir
        nombreField.classList.add('campo-invalido');
      }
    }
    
    // Email
    if (email && emailValido) {
      emailField.classList.remove('campo-invalido');
      emailField.classList.add('campo-valido');
    } else {
      emailField.classList.remove('campo-valido');
      if (emailField.value.length > 0) {
        emailField.classList.add('campo-invalido');
      }
    }
    
    // Mensaje
    if (mensaje) {
      mensajeField.classList.remove('campo-invalido');
      mensajeField.classList.add('campo-valido');
    } else {
      mensajeField.classList.remove('campo-valido');
      if (mensajeField.value.length > 0) {
        mensajeField.classList.add('campo-invalido');
      }
    }
    
    // Verificar si todos los campos están completos y el email es válido
    const todosLosCarposCompletos = nombre && email && mensaje && emailValido;
    
    if (todosLosCarposCompletos) {
      // Habilitar botón con color vino tinto
      enviarContactoBtn.disabled = false;
      enviarContactoBtn.className = 'btn btn-contacto-enabled btn-block font-weight-bold py-3 btn-contacto-transition';
    } else {
      // Deshabilitar botón
      enviarContactoBtn.disabled = true;
      enviarContactoBtn.className = 'btn btn-contacto-disabled btn-block font-weight-bold py-3 btn-contacto-transition';
    }
  }

  // Agregar event listeners a los campos del formulario
  if (contactForm) {
    const campos = ['nombre', 'email', 'mensaje'];
    campos.forEach(campoId => {
      const campo = document.getElementById(campoId);
      if (campo) {
        // Validar en tiempo real mientras el usuario escribe
        campo.addEventListener('input', validarCamposContacto);
        campo.addEventListener('blur', validarCamposContacto);
      }
    });

    // Validación inicial
    validarCamposContacto();
  }

  if (contactForm) {
    contactForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      // Limpiar mensajes anteriores
      contactAlert.style.display = 'none';
      contactAlert.className = '';
      
      // Obtener datos del formulario
      const formData = new FormData(contactForm);
      const datos = {
        nombre: formData.get('nombre').trim(),
        email: formData.get('email').trim(),
        mensaje: formData.get('mensaje').trim()
      };
      
      // Validación básica
      if (!datos.nombre || !datos.email || !datos.mensaje) {
        mostrarAlerta('Por favor completa todos los campos.', 'error');
        return;
      }
      
      // Validar email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(datos.email)) {
        mostrarAlerta('Por favor ingresa un email válido.', 'error');
        return;
      }
      
      // Mostrar estado de carga
      enviarContactoBtn.disabled = true;
      enviarContactoBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Enviando...';
      
      try {
        // Determinar la URL del backend
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const backendUrl = isLocalhost 
          ? 'http://localhost:3001' 
          : 'https://capri-store.onrender.com';
        
        const response = await fetch(`${backendUrl}/contact`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(datos)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
          mostrarAlerta(
            '¡Mensaje enviado correctamente! Te responderemos a la brevedad.',
            'success'
          );
          contactForm.reset();
          
          // Después de reset, revalidar para deshabilitar el botón
          setTimeout(() => {
            if (typeof validarCamposContacto === 'function') {
              validarCamposContacto();
            }
          }, 100);
        } else {
          mostrarAlerta(result.error || 'Error al enviar el mensaje. Intenta nuevamente.', 'error');
        }
        
      } catch (error) {
        console.error('Error al enviar formulario de contacto:', error);
        mostrarAlerta(
          'Error de conexión. Por favor verifica tu internet e intenta nuevamente.',
          'error'
        );
      } finally {
        // Restaurar botón
        enviarContactoBtn.disabled = true;
        enviarContactoBtn.className = 'btn btn-contacto-disabled btn-block font-weight-bold py-3 btn-contacto-transition';
        enviarContactoBtn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Enviar Mensaje';
        
        // Re-validar campos para mantener estado correcto
        setTimeout(() => {
          if (typeof validarCamposContacto === 'function') {
            validarCamposContacto();
          }
        }, 100);
      }
    });
  }

  // Función para mostrar alertas
  function mostrarAlerta(mensaje, tipo) {
    contactAlert.style.display = 'block';
    contactAlert.className = tipo === 'success' 
      ? 'alert alert-success mb-3' 
      : 'alert alert-danger mb-3';
    contactAlert.innerHTML = `
      <button type="button" class="close" data-dismiss="alert" aria-hidden="true">&times;</button>
      <i class="fas fa-${tipo === 'success' ? 'check-circle' : 'exclamation-triangle'} mr-2"></i>
      ${mensaje}
    `;
    
    // Scroll suave al formulario
    contactForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
