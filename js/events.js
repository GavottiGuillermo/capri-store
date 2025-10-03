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
  // Solo aplicar animaciones automáticas de título en la página principal
  if (!document.body.classList.contains('checkout-page') && !window.location.pathname.includes('checkout.html')) {
    const sectionTitles = document.querySelectorAll('h1, h2.display-4, h2.display-5');
    sectionTitles.forEach(title => {
      title.classList.add('section-title');
    });
  }
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
  // ANIMACIÓN UNIFICADA Y OPTIMIZADA
  const allAnimatableElements = document.querySelectorAll(
    '.fade-in, .fade-in-left, .fade-in-right, .section-title, .progressive-reveal, .card-animate, .checkout-section'
  );
  
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  
  allAnimatableElements.forEach(element => {
    // Solo animar elementos que no estén ya visibles
    if (!element.classList.contains('visible')) {
      const rect = element.getBoundingClientRect();
      const threshold = 0.15; // 15% del viewport
      
      // Condición de visibilidad mejorada
      const isVisible = (
        rect.top <= windowHeight * (1 - threshold) &&
        rect.bottom >= windowHeight * threshold &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.left < (window.innerWidth || document.documentElement.clientWidth)
      );
      
      if (isVisible) {
        // Aplicar animación suave basada en el tipo de elemento
        element.classList.add('visible');
        
        // Animación adicional para elementos especiales
        if (element.classList.contains('progressive-reveal')) {
          element.style.transition = 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        }
      }
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
    const telefonoField = document.getElementById('telefono');
    const emailField = document.getElementById('email');
    const mensajeField = document.getElementById('mensaje');
    
    const nombre = nombreField.value.trim();
    const telefono = telefonoField.value.trim();
    const email = emailField.value.trim();
    const mensaje = mensajeField.value.trim();
    
    // Validar email básico (opcional)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emailValido = !email || emailRegex.test(email); // Válido si está vacío o es correcto
    
    // Validar teléfono básico (opcional pero recomendado)
    const telefonoRegex = /^[\+]?[\s\d\-\(\)]{8,}$/;
    const telefonoValido = !telefono || telefonoRegex.test(telefono);
    
    // Aplicar estilos visuales a los campos
    // Nombre (obligatorio)
    if (nombre) {
      nombreField.classList.remove('campo-invalido');
      nombreField.classList.add('campo-valido');
    } else {
      nombreField.classList.remove('campo-valido');
      if (nombreField.value.length > 0) {
        nombreField.classList.add('campo-invalido');
      }
    }
    
    // Teléfono (opcional)
    if (telefono && telefonoValido) {
      telefonoField.classList.remove('campo-invalido');
      telefonoField.classList.add('campo-valido');
    } else if (telefono && !telefonoValido) {
      telefonoField.classList.remove('campo-valido');
      telefonoField.classList.add('campo-invalido');
    } else {
      telefonoField.classList.remove('campo-valido', 'campo-invalido');
    }
    
    // Email (opcional)
    if (email && emailValido) {
      emailField.classList.remove('campo-invalido');
      emailField.classList.add('campo-valido');
    } else if (email && !emailValido) {
      emailField.classList.remove('campo-valido');
      emailField.classList.add('campo-invalido');
    } else {
      emailField.classList.remove('campo-valido', 'campo-invalido');
    }
    
    // Mensaje (obligatorio)
    if (mensaje) {
      mensajeField.classList.remove('campo-invalido');
      mensajeField.classList.add('campo-valido');
    } else {
      mensajeField.classList.remove('campo-valido');
      if (mensajeField.value.length > 0) {
        mensajeField.classList.add('campo-invalido');
      }
    }
    
    // Verificar campos obligatorios: nombre, mensaje
    // Y que si hay email/teléfono, sean válidos
    const camposObligatoriosCompletos = nombre && mensaje;
    const camposOpcionalesValidos = emailValido && telefonoValido;
    
    if (camposObligatoriosCompletos && camposOpcionalesValidos) {
      // Habilitar botón
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
    const campos = ['nombre', 'telefono', 'email', 'mensaje'];
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
        telefono: formData.get('telefono').trim(),
        email: formData.get('email').trim(),
        mensaje: formData.get('mensaje').trim()
      };
      
      // Validación básica - solo nombre y mensaje son obligatorios
      if (!datos.nombre || !datos.mensaje) {
        mostrarAlerta('Por favor completa al menos tu nombre y mensaje.', 'error');
        return;
      }
      
      // Validar email si se proporciona
      if (datos.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(datos.email)) {
          mostrarAlerta('Por favor ingresa un email válido o déjalo vacío.', 'error');
          return;
        }
      }
      
      // Validar teléfono si se proporciona
      if (datos.telefono) {
        const telefonoRegex = /^[\+]?[\s\d\-\(\)]{8,}$/;
        if (!telefonoRegex.test(datos.telefono)) {
          mostrarAlerta('Por favor ingresa un teléfono válido o déjalo vacío.', 'error');
          return;
        }
      }
      
      // Mostrar estado de carga
      enviarContactoBtn.disabled = true;
      enviarContactoBtn.innerHTML = '<i class="fab fa-whatsapp fa-spin mr-2"></i>Enviando por WhatsApp...';
      
      try {
        // Determinar la URL del backend
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const backendUrl = isLocalhost 
          ? 'http://localhost:3001' 
          : 'https://capri-store.onrender.com';
        
        const response = await fetch(`${backendUrl}/contact-whatsapp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(datos)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
          // Éxito completo
          const mensaje = result.whatsapp_sent 
            ? '¡Consulta enviada por WhatsApp! Te responderemos en 2-4 horas hábiles.' 
            : 'Tu consulta fue recibida. Nos pondremos en contacto contigo pronto.';
          
          mostrarAlerta(mensaje, 'success');
          contactForm.reset();
          
          // Después de reset, revalidar para deshabilitar el botón
          setTimeout(() => {
            if (typeof validarCamposContacto === 'function') {
              validarCamposContacto();
            }
          }, 100);
        } else {
          // Error del servidor - mostrar el mensaje específico del backend
          const errorMessage = result.error || 'Error al enviar el mensaje. Intenta nuevamente.';
          const altMessage = result.alternative ? `\n\n${result.alternative}` : '';
          mostrarAlerta(errorMessage + altMessage, 'error');
        }
        
      } catch (error) {
        console.error('Error al enviar formulario de contacto:', error);
        
        // Error de conexión o red
        mostrarAlerta(
          'Error de conexión. Por favor verifica tu internet e intenta nuevamente, o contáctanos por WhatsApp: +54 9 3487 456789',
          'error'
        );
      } finally {
        // Restaurar botón
        enviarContactoBtn.disabled = true;
        enviarContactoBtn.className = 'btn btn-contacto-disabled btn-block font-weight-bold py-3 btn-contacto-transition';
        enviarContactoBtn.innerHTML = '<i class="fab fa-whatsapp mr-2"></i>Enviar por WhatsApp';
        
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
