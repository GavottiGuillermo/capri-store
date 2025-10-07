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
    // Obtener información de contacto del servidor
    const response = await fetch('/contact-info');
    const contactInfo = await response.json();
    
    // WhatsApp
    const whatsappLink = document.getElementById('whatsappLink');
    if (whatsappLink && contactInfo.whatsapp) {
      const whatsappUrl = `https://wa.me/${contactInfo.whatsapp.replace(/[^0-9]/g, '')}?text=¡Hola! Me interesa conocer más sobre sus productos.`;
      whatsappLink.href = whatsappUrl;
      console.log('✅ WhatsApp link configurado:', whatsappUrl);
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
    // Fallback con valores por defecto
    setupFallbackContactLinks();
  }
}

function setupFallbackContactLinks() {
  console.log('⚠️ Usando links de contacto por defecto');
  
  // WhatsApp por defecto
  const whatsappLink = document.getElementById('whatsappLink');
  if (whatsappLink) {
    whatsappLink.href = 'https://wa.me/5493487456789?text=¡Hola! Me interesa conocer más sobre sus productos.';
  }
  
  // Instagram por defecto
  const instagramLink = document.getElementById('instagramLink');
  if (instagramLink) {
    instagramLink.href = 'https://instagram.com/capristorezte';
  }
  
  // Email por defecto
  const emailLink = document.getElementById('emailLink');
  if (emailLink) {
    emailLink.href = 'mailto:capristorezte@gmail.com?subject=Consulta desde Capri Store&body=Hola, me gustaría hacer una consulta sobre...';
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

// Mobile menu
function setupMobileMenu() {
  const navbarToggler = document.querySelector('.navbar-toggler');
  const navbarCollapse = document.querySelector('.navbar-collapse');
  
  if (navbarToggler && navbarCollapse) {
    navbarToggler.addEventListener('click', () => {
      navbarCollapse.classList.toggle('show');
    });
    
    // Cerrar menú al hacer click en un link
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
      link.addEventListener('click', () => {
        navbarCollapse.classList.remove('show');
      });
    });
  }
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