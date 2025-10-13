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
}

function observeAnimations() {
  const options = {
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px'
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate');
      }
    });
  }, options);
  
  document.querySelectorAll('.progressive-reveal').forEach(element => {
    observer.observe(element);
  });
}

function preloadImages() {
  const images = document.querySelectorAll('img[data-src]');
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.classList.remove('lazy');
        imageObserver.unobserve(img);
      }
    });
  });
  
  images.forEach(img => imageObserver.observe(img));
}

// Configurar links de contacto dinámicos
async function setupContactLinks() {
  try {
    console.log('🔄 Cargando información de contacto del servidor...');
    
    // Determinar la URL base del API
    let apiBaseUrl = '';
    
    if (window.location.hostname === 'capristorezte.com.ar' || window.location.hostname === 'www.capristorezte.com.ar') {
      // En producción, usar la URL del backend en Render
      apiBaseUrl = 'https://capri-store.onrender.com';
      console.log('🌐 Modo producción: usando backend en Render');
    } else {
      // En desarrollo o localhost, usar rutas relativas
      apiBaseUrl = '';
      console.log('🔧 Modo desarrollo: usando rutas relativas');
    }
    
    // Intentar con diferentes URLs
    const urls = [
      `${apiBaseUrl}/contact-info`,
      `${apiBaseUrl}/api/contact-info`,
      '/contact-info'
    ];
    
    let response = null;
    let lastError = null;
    
    for (const url of urls) {
      try {
        console.log(`🔄 Intentando URL: ${url}`);
        response = await fetch(url);
        if (response.ok) {
          console.log(`✅ URL exitosa: ${url}`);
          break;
        }
        console.log(`❌ URL falló: ${url} - ${response.status}`);
      } catch (error) {
        console.log(`❌ Error en URL ${url}:`, error.message);
        lastError = error;
      }
    }
    
    if (!response || !response.ok) {
      throw new Error(`Error HTTP: ${response?.status || 'NETWORK'} - ${response?.statusText || lastError?.message || 'No se pudo conectar al servidor'}`);
    }
    
    const contactInfo = await response.json();
    console.log('📄 Información de contacto recibida:', contactInfo);
    
    // Validar que la respuesta tenga los datos esperados
    if (!contactInfo || typeof contactInfo !== 'object') {
      throw new Error('Respuesta del servidor inválida');
    }
    
    // WhatsApp
    const whatsappLink = document.getElementById('whatsappLink');
    if (whatsappLink) {
      if (contactInfo.whatsapp) {
        // Limpiar el número y validar formato
        let cleanNumber = contactInfo.whatsapp.toString().replace(/[^0-9]/g, '');
        
        console.log('📱 Número original:', contactInfo.whatsapp);
        console.log('📱 Número limpio:', cleanNumber);
        console.log('📱 Longitud del número:', cleanNumber.length);
        
        // Validar que el número tenga al menos 10 dígitos y máximo 15
        if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
          const message = encodeURIComponent('¡Hola! Me interesa conocer más sobre sus productos.');
          const whatsappUrl = `https://wa.me/${cleanNumber}?text=${message}`;
          whatsappLink.href = whatsappUrl;
          console.log('✅ WhatsApp link configurado:', whatsappUrl);
        } else {
          console.error('❌ Número de WhatsApp inválido (longitud):', cleanNumber, 'Longitud:', cleanNumber.length);
          whatsappLink.href = '#';
          whatsappLink.onclick = () => {
            alert(`Error: Número de WhatsApp no válido. Recibido: "${contactInfo.whatsapp}" (limpio: "${cleanNumber}")`);
            return false;
          };
        }
      } else {
        console.error('❌ No se recibió número de WhatsApp del servidor');
        whatsappLink.href = '#';
        whatsappLink.onclick = () => {
          alert('Error: No hay número de WhatsApp configurado en el servidor');
          return false;
        };
      }
    } else {
      console.error('❌ Elemento whatsappLink no encontrado en el DOM');
    }
    
    // Instagram  
    const instagramLink = document.getElementById('instagramLink');
    if (instagramLink && contactInfo.instagram) {
      instagramLink.href = contactInfo.instagram;
      console.log('✅ Instagram link configurado:', contactInfo.instagram);
    }
    
    // Email
    const emailLink = document.getElementById('emailLink');
    if (emailLink && contactInfo.email) {
      const emailUrl = `mailto:${contactInfo.email}?subject=Consulta desde Capri Store&body=Hola, me gustaría hacer una consulta sobre...`;
      emailLink.href = emailUrl;
      console.log('✅ Email link configurado:', emailUrl);
    }
    
  } catch (error) {
    console.error('❌ Error cargando información de contacto:', error);
    
    // Mostrar error específico si la respuesta del servidor tiene información
    if (error.message.includes('HTTP: 500')) {
      console.error('🔥 Error del servidor - Probablemente variables de entorno no configuradas');
    }
    
    setupFallbackContactLinks(error);
  }
}

function setupFallbackContactLinks(error = null) {
  console.log('⚠️ Configurando enlaces de contacto en modo fallback');
  
  const errorMessage = error ? 
    `Error del servidor: ${error.message}. Verifica que las variables de entorno estén configuradas.` :
    'No se puede obtener información de contacto del servidor';
  
  // Deshabilitar enlaces si no hay información del servidor
  const whatsappLink = document.getElementById('whatsappLink');
  if (whatsappLink) {
    whatsappLink.href = '#';
    whatsappLink.onclick = () => {
      alert(errorMessage);
      return false;
    };
  }
  
  const instagramLink = document.getElementById('instagramLink');
  if (instagramLink) {
    instagramLink.href = '#';
    instagramLink.onclick = () => {
      alert(errorMessage);
      return false;
    };
  }
  
  const emailLink = document.getElementById('emailLink');
  if (emailLink) {
    emailLink.href = '#';
    emailLink.onclick = () => {
      alert(errorMessage);
      return false;
    };
  }
}

// Smooth scroll - Solo para enlaces internos
function setupSmoothScroll() {
  // Solo seleccionar enlaces que realmente empiecen con # (enlaces internos)
  document.querySelectorAll('a').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      
      // Solo aplicar smooth scroll a enlaces internos que comiencen con #
      if (href && href.startsWith('#') && href.length > 1) {
        e.preventDefault();
        try {
          const target = document.querySelector(href);
          if (target) {
            target.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }
        } catch (error) {
          console.warn('🔗 Error en smooth scroll para:', href, error.message);
        }
      }
      // Para enlaces externos (WhatsApp, Instagram, email) dejar que se abran normalmente
    });
  });
}

// Navbar scroll effect
function setupNavbarScroll() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;
  
  window.addEventListener('scroll', throttle(() => {
    if (window.scrollY > 50) {
      navbar.classList.add('navbar-scrolled');
    } else {
      navbar.classList.remove('navbar-scrolled');
    }
  }, 16));
}

// Loading screen
function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loadingScreen');
  if (loadingScreen) {
    setTimeout(() => {
      loadingScreen.style.opacity = '0';
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 300);
    }, 800);
  }
}

// Mobile menu - Solo cerrar menú al hacer click en enlaces internos
function setupMobileMenu() {
  // Solo manejar el cierre automático para enlaces internos
  document.querySelectorAll('.navbar-nav .nav-link.js-scroll-trigger').forEach(link => {
    link.addEventListener('click', () => {
      // Usar Bootstrap para cerrar el menú
      const navbarCollapse = document.querySelector('.navbar-collapse');
      if (navbarCollapse && navbarCollapse.classList.contains('show')) {
        // Usar el método de Bootstrap para cerrar
        $('.navbar-collapse').collapse('hide');
      }
    });
  });
}

// Back to top button
function setupBackToTop() {
  const backToTopBtn = document.createElement('button');
  backToTopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
  backToTopBtn.className = 'btn btn-vino-tinto back-to-top';
  backToTopBtn.setAttribute('aria-label', 'Volver arriba');
  document.body.appendChild(backToTopBtn);
  
  window.addEventListener('scroll', throttle(() => {
    if (window.scrollY > 300) {
      backToTopBtn.classList.add('show');
    } else {
      backToTopBtn.classList.remove('show');
    }
  }, 100));
  
  backToTopBtn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}

// Error boundary
function setupErrorHandling() {
  window.addEventListener('error', (event) => {
    console.error('❌ Error global capturado:', event.error);
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    console.error('❌ Promise rechazada no manejada:', event.reason);
  });
}

// Inicialización principal
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 Inicializando Capri Store...');
  
  try {
    // Configurar componentes básicos
    setupAnimationClasses();
    setupSmoothScroll();
    setupNavbarScroll();
    setupMobileMenu();
    setupBackToTop();
    setupErrorHandling();
    
    // Configurar links de contacto
    setupContactLinks();
    
    // Efectos visuales
    preloadImages();
    observeAnimations();
    
    // Ocultar pantalla de carga
    hideLoadingScreen();
    
    console.log('✅ Capri Store inicializado correctamente');
    
  } catch (error) {
    console.error('❌ Error inicializando la aplicación:', error);
  }
});

// Scroll effects
window.addEventListener('scroll', throttle(parallaxEffect, 16));

// Resize handler
window.addEventListener('resize', throttle(() => {
  // Recalcular animaciones si es necesario
}, 250));