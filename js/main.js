// Variables globales para paginación
let todosLosProductos = [];
let todasLasNovedades = [];
let productosFiltrados = []; // Para almacenar productos filtrados por categoría
let categoriaActiva = 'todos'; // Categoría actualmente seleccionada
const ITEMS_POR_PAGINA_NOVEDADES = 6; // 2 filas de 3 productos
const ITEMS_POR_PAGINA_PRODUCTOS = 8; // 2 filas de 4 productos
let paginaActualNovedades = 1;
let paginaActualProductos = 1;

//  Cargar productos desde productos.json del bucket
async function cargarProductosCapri() {
  // Agregar timestamp para evitar caché del navegador
  const timestamp = new Date().getTime();
  const urlJson = `https://storage.googleapis.com/imagenes-web-capri/productos.json?t=${timestamp}`;
  let productos = [];
  try {
    const resp = await fetch(urlJson, { cache: 'no-store' });
    
    if (!resp.ok) {
      throw new Error(`HTTP error! status: ${resp.status}`);
    }
    
    const text = await resp.text();
    productos = JSON.parse(text);
    console.log('✅ Productos cargados exitosamente:', productos.length, 'items');
  } catch (e) {
    console.error('❌ Error al cargar productos:', e.message);
    return;
  }

  // Obtener IDs vendidos (sin stock) desde backend; usar cache solo como fallback
  let soldOutIds = [];
  try {
    const API_BASE = (window.location.hostname.includes('capristorezte.com.ar'))
      ? 'https://capri-store.onrender.com'
      : '';
    console.log('📦 Solicitando stock agotado desde backend...');
    const respAg = await fetch(`${API_BASE}/stock-agotado?t=${timestamp}`, { cache: 'no-store' });
    if (respAg.ok) {
      const js = await respAg.json();
      if (Array.isArray(js.ids)) {
        soldOutIds = js.ids;
        console.log(`✅ Stock agotado obtenido: ${soldOutIds.length} productos sin stock`);
        localStorage.setItem('agotados', JSON.stringify(soldOutIds)); // servidor es autoridad
        localStorage.setItem('agotados_last_sync', String(Date.now()));
      }
    } else {
      console.warn('⚠️ Backend no respondió OK, usando caché local');
      // Fallback a cache local
      const cached = JSON.parse(localStorage.getItem('agotados') || '[]');
      soldOutIds = Array.isArray(cached) ? cached : [];
      console.log(`📦 Usando caché: ${soldOutIds.length} productos sin stock`);
    }
  } catch (e) {
    console.warn('⚠️ Error al obtener stock agotado:', e.message);
    console.log('📦 Intentando usar caché local...');
    const cached = JSON.parse(localStorage.getItem('agotados') || '[]');
    soldOutIds = Array.isArray(cached) ? cached : [];
    console.log(`📦 Caché cargado: ${soldOutIds.length} productos sin stock`);
  }
  window.__CAPRI_SOLD_OUT__ = new Set(soldOutIds);
  console.log(`🎯 Estado final: ${window.__CAPRI_SOLD_OUT__.size} productos marcados como sin stock`);

  // Separar novedades y productos con la nueva lógica
  // Novedades: categoría "novedades" O que contenga "-Novedad"
  todasLasNovedades = productos.filter(p => {
    if (!p.categoria) return false;
    const categoria = p.categoria.toLowerCase();
    return categoria === 'novedades' || categoria.includes('-novedad');
  });
  
  // Todos los productos (incluyendo los que tienen "-Novedad")
  todosLosProductos = productos.filter(p => p.categoria && p.categoria.toLowerCase() !== 'novedades');
  
  // Inicializar productos filtrados con todos los productos
  productosFiltrados = [...todosLosProductos];
  
  console.log('📊 Resumen:', todasLasNovedades.length, 'novedades,', todosLosProductos.length, 'productos');

  // Actualizar navegación
  actualizarNavegacion();

  // Renderizar la primera página
  await renderizarNovedades();
  await renderizarProductos();
  
  // Marcar "Todos los Productos" como activo inicialmente
  actualizarMenuActivo('todos');
}

// Refrescar stock: vuelve a consultar al backend y re-renderiza
async function refrescarStock() {
  try {
    const link = document.getElementById('link-refrescar');
    if (link) { link.textContent = '🔄 Actualizando...'; link.style.pointerEvents = 'none'; }
    const API_BASE = (window.location.hostname.includes('capristorezte.com.ar'))
      ? 'https://capri-store.onrender.com'
      : '';
    const timestamp = new Date().getTime();
    console.log('🔄 Refrescando stock desde servidor...');
    const respAg = await fetch(`${API_BASE}/stock-agotado?t=${timestamp}`, { cache: 'no-store' });
    if (respAg.ok) {
      const js = await respAg.json();
      const ids = Array.isArray(js.ids) ? js.ids : [];
      console.log(`✅ Stock actualizado: ${ids.length} productos sin stock`);
      localStorage.setItem('agotados', JSON.stringify(ids));
      localStorage.setItem('agotados_last_sync', String(Date.now()));
      window.__CAPRI_SOLD_OUT__ = new Set(ids);
      
      // Recargar productos.json para obtener nuevos productos
      const timestampProductos = new Date().getTime();
      const urlJson = `https://storage.googleapis.com/imagenes-web-capri/productos.json?t=${timestampProductos}`;
      const respProductos = await fetch(urlJson, { cache: 'no-store' });
      if (respProductos.ok) {
        const productos = await respProductos.json();
        console.log(`✅ Productos recargados: ${productos.length} items`);
        
        // Actualizar listas de productos
        todasLasNovedades = productos.filter(p => {
          if (!p.categoria) return false;
          const categoria = p.categoria.toLowerCase();
          return categoria === 'novedades' || categoria.includes('-novedad');
        });
        todosLosProductos = productos.filter(p => p.categoria && p.categoria.toLowerCase() !== 'novedades');
        productosFiltrados = categoriaActiva === 'todos' ? [...todosLosProductos] : 
          todosLosProductos.filter(p => {
            if (!p.categoria) return false;
            const categoriaProducto = p.categoria.toLowerCase();
            const categoriaBuscada = categoriaActiva.toLowerCase();
            if (categoriaProducto === categoriaBuscada) return true;
            const categoriaBase = categoriaProducto.split('-')[0];
            return categoriaBase === categoriaBuscada;
          });
      }
      
      // Re-renderizar secciones
      const novedadesList = document.getElementById('novedades-list');
      const productosList = document.getElementById('productos-list');
      if (novedadesList) novedadesList.innerHTML = '';
      if (productosList) productosList.innerHTML = '';
      paginaActualNovedades = 1;
      paginaActualProductos = 1;
      await renderizarNovedades();
      await renderizarProductos();
      console.log('✅ Actualización completada');
    } else {
      console.error('❌ Error al actualizar stock:', respAg.status);
    }
  } finally {
    const link = document.getElementById('link-refrescar');
    if (link) { link.textContent = 'Refrescar stock'; link.style.pointerEvents = 'auto'; }
  }
}

// Función para mostrar/ocultar links de navegación
function actualizarNavegacion() {
  const linkNovedades = document.querySelector('a[href="#novedades"]');
  if (linkNovedades) {
    const liNovedades = linkNovedades.closest('li');
    if (todasLasNovedades.length === 0) {
      liNovedades.style.display = 'none';
    } else {
      liNovedades.style.display = 'block';
    }
  }
}

// Renderizar novedades con paginación
async function renderizarNovedades() {
  // Verificar si hay novedades disponibles
  if (todasLasNovedades.length === 0) {
    const seccionNovedades = document.getElementById('novedades');
    if (seccionNovedades) {
      seccionNovedades.style.display = 'none';
    }
    return;
  } else {
    // Mostrar la sección si hay novedades
    const seccionNovedades = document.getElementById('novedades');
    if (seccionNovedades) {
      seccionNovedades.style.display = 'block';
    }
  }
  
  const novedadesList = document.getElementById('novedades-list');
  
  const inicio = (paginaActualNovedades - 1) * ITEMS_POR_PAGINA_NOVEDADES;
  const fin = inicio + ITEMS_POR_PAGINA_NOVEDADES;
  const novedadesPagina = todasLasNovedades.slice(inicio, fin);

  // Solo limpiar si es la primera página
  if (paginaActualNovedades === 1) {
    novedadesList.innerHTML = '';
  }

  for (const prod of novedadesPagina) {
    const cardHtml = await crearTarjetaProducto(prod, 'novedad');
    novedadesList.insertAdjacentHTML('beforeend', cardHtml);

    // Marcar sin stock en Novedades sin bloquear el detalle
    try {
      const path = decodeURIComponent((prod.imagen || prod.txt || ''));
      const m = path.match(/\/(\d+)-[^/]+/);
      const id = m && m[1] ? parseInt(m[1], 10) : null;
      const last = novedadesList.lastElementChild;
      if (!id) {
        console.warn('[NOVEDADES] No se pudo extraer id_articulo para', prod, 'path:', path);
      } else {
        if (window.__CAPRI_SOLD_OUT__) {
          if (window.__CAPRI_SOLD_OUT__.has(id)) {
            console.log(`[NOVEDADES] Producto id=${id} marcado como SIN STOCK`);
            if (last) {
              const card = last.querySelector('.card');
              if (card) {
                card.style.filter = 'grayscale(0.6)';
                card.style.opacity = '0.8';
                // Badge
                const badge = document.createElement('div');
                badge.textContent = 'Sin stock';
                badge.style.position = 'absolute';
                badge.style.top = '10px';
                badge.style.left = '10px';
                badge.style.background = '#dc3545';
                badge.style.color = '#fff';
                badge.style.padding = '6px 10px';
                badge.style.borderRadius = '8px';
                badge.style.fontWeight = 'bold';
                card.appendChild(badge);
              }
            }
          } else {
            console.log(`[NOVEDADES] Producto id=${id} CON STOCK`);
          }
        } else {
          console.warn('[NOVEDADES] window.__CAPRI_SOLD_OUT__ no está definido');
        }
      }
    } catch (e) {
      console.error('[NOVEDADES] Error al marcar sin stock:', e);
    }
  }

  // Mostrar/ocultar botón "Ver más"
  actualizarBotonVerMas('novedades', fin < todasLasNovedades.length);
  
  // Forzar estilos de botones después del renderizado - SIN CONFLICTOS
  setTimeout(() => {
    const botonesNovedades = document.querySelectorAll('#novedades .btn-vino-tinto');
    botonesNovedades.forEach((btn) => {
      btn.style.setProperty('background-color', '#6b0a0a', 'important');
      btn.style.setProperty('color', '#fff', 'important');
      btn.style.setProperty('border-color', '#6b0a0a', 'important');
      btn.style.setProperty('opacity', '1', 'important');
      btn.style.setProperty('filter', 'none', 'important');
      btn.style.setProperty('pointer-events', 'auto', 'important');
      btn.style.setProperty('cursor', 'pointer', 'important');
    });
  }, 200);
  
  console.log('=== RENDERIZADO DE NOVEDADES COMPLETADO ===');
}

// Renderizar productos con paginación y animaciones suavizadas
async function renderizarProductos() {
  const productosList = document.getElementById('productos-list');
  
  const inicio = (paginaActualProductos - 1) * ITEMS_POR_PAGINA_PRODUCTOS;
  const fin = inicio + ITEMS_POR_PAGINA_PRODUCTOS;
  const productosPagina = productosFiltrados.slice(inicio, fin);

  if (!productosList) {
    console.error('❌ ERROR: No se encontró el elemento productos-list');
    return;
  }

  if (productosPagina.length === 0) {
    if (paginaActualProductos === 1) {
      productosList.innerHTML = '<div class="col-12 text-center"><p>No hay productos disponibles</p></div>';
    }
    return;
  }

  // PREVENIR MOVIMIENTOS BRUSCOS - Solo limpiar si es la primera página
  if (paginaActualProductos === 1) {
    // Limpiar inmediatamente sin animación para evitar que los productos desaparezcan
    productosList.innerHTML = '';
  }

  let productosRenderizados = 0;
  for (const prod of productosPagina) {
    try {
      const cardHtml = await crearTarjetaProducto(prod, 'producto');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cardHtml;
      const cardElement = tempDiv.firstElementChild;
      
      // ANIMACIÓN SUAVE DE ENTRADA
      cardElement.style.opacity = '0';
      cardElement.style.transform = 'translateY(20px) scale(0.95)';
      cardElement.style.transition = 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      
      productosList.appendChild(cardElement);
      
      // Animar entrada de forma escalonada
      setTimeout(() => {
        cardElement.style.opacity = '1';
        cardElement.style.transform = 'translateY(0) scale(1)';
        cardElement.classList.add('visible');
      }, productosRenderizados * 50); // 50ms entre cada producto
      
      // Marcar sin stock si corresponde (sin bloquear el detalle)
      try {
        const path = decodeURIComponent((prod.imagen || prod.txt || ''));
        const m = path.match(/\/(\d+)-[^/]+/);
        const id = m && m[1] ? parseInt(m[1], 10) : null;
        
        console.log(`[DEBUG] Procesando producto:`, {
          path,
          id,
          estaEnSinStock: id && window.__CAPRI_SOLD_OUT__ ? window.__CAPRI_SOLD_OUT__.has(id) : false,
          totalSinStock: window.__CAPRI_SOLD_OUT__ ? window.__CAPRI_SOLD_OUT__.size : 0
        });
        
        if (!id) {
          console.warn('[PRODUCTOS] No se pudo extraer id_articulo para', prod, 'path:', path);
        } else {
          if (window.__CAPRI_SOLD_OUT__ && window.__CAPRI_SOLD_OUT__.has(id)) {
            console.log(`[PRODUCTOS] Producto id=${id} marcado como SIN STOCK`);
            const card = cardElement.querySelector('.card');
            if (card) {
              card.style.filter = 'grayscale(0.6)';
              card.style.opacity = '0.8';
              const badge = document.createElement('div');
              badge.textContent = 'Sin stock';
              badge.style.position = 'absolute';
              badge.style.top = '10px';
              badge.style.left = '10px';
              badge.style.background = '#dc3545';
              badge.style.color = '#fff';
              badge.style.padding = '6px 10px';
              badge.style.borderRadius = '8px';
              badge.style.fontWeight = 'bold';
              badge.style.zIndex = '15';
              card.appendChild(badge);
            }
          } else {
            console.log(`[PRODUCTOS] Producto id=${id} CON STOCK disponible`);
          }
        }
      } catch (e) {
        console.error('[PRODUCTOS] Error al marcar sin stock:', e);
      }
      
      productosRenderizados++;
    } catch (error) {
      console.error('❌ Error renderizando producto:', prod.id_articulo, error);
    }
  }

  // Mostrar/ocultar botón "Ver más"
  actualizarBotonVerMas('productos', fin < productosFiltrados.length);
  
  console.log(`📊 RESUMEN RENDERIZADO: ${productosRenderizados}/${productosPagina.length} productos renderizados exitosamente`);
  console.log('=== RENDERIZADO DE PRODUCTOS COMPLETADO ===');
}

// Crear HTML de tarjeta de producto
async function crearTarjetaProducto(prod, tipo) {
  // Extraer id_articulo del path de la imagen o txt si no está presente
  if (!prod.id_articulo) {
    try {
      const path = decodeURIComponent((prod.imagen || prod.txt || ''));
      const m = path.match(/\/(\d+)-[^/]+/);
      if (m && m[1]) {
        prod.id_articulo = parseInt(m[1], 10);
      }
    } catch (e) {
      console.warn('No se pudo extraer id_articulo para el producto:', prod, e);
    }
  }
  let nombre = '', precio = '', textoTarjeta = '';
  try {
    const txtResp = await fetch(prod.txt);
    const txt = await txtResp.text();
    console.log('Contenido del .txt:', txt);
    
    // Extraer información entre llaves en formato secuencial
    // Formato: {Nombre}{Descripción}{Precio}{Talle}{Detalle}
    // NOTA: Todos los campos son opcionales excepto nombre
    const matches = txt.match(/\{([^}]+)\}/g);
    
    if (matches && matches.length >= 1) {
      // Extraer campos disponibles, permitiendo que estén vacíos
      nombre = matches[0] ? matches[0].replace(/[{}]/g, '').trim() : '';
      textoTarjeta = matches[1] ? matches[1].replace(/[{}]/g, '').trim() : '';
      precio = matches[2] ? matches[2].replace(/[{}]/g, '').trim() : '';
    } else {
      nombre = '';
      textoTarjeta = '';
      precio = '';
    }
    
    console.log('Datos extraídos:', { nombre, textoTarjeta, precio });
  } catch (e) {
    console.error('Error al cargar .txt:', e);
  }

  const colClass = tipo === 'novedad' ? 'col-md-4' : 'col-md-3';
  const borderClass = tipo === 'novedad' ? 'border-rosado' : 'border-vino-tinto';
  const btnClass = 'btn-vino-tinto';
  
  // Filtrar valores null o "null" como string
  const nombreFinal = (nombre && nombre !== 'null') ? nombre : '';
  const textoFinal = (textoTarjeta && textoTarjeta !== 'null') ? textoTarjeta : '';
  const precioFinal = (precio && precio !== 'null') ? precio : '';
  
  return `
    <div class="${colClass} mb-4">
      <div class="card card-product ${borderClass} rounded-lg shadow h-100 progressive-reveal visible animate-delay-1 border-2" style="border: 0.125rem solid var(--rosado) !important; position: relative;">
        <img src="${prod.imagen}" class="card-img-top" alt="${nombreFinal}" style="height: 250px; object-fit: cover;">
        <div class="card-body d-flex flex-column">
          <h5 class="card-title text-vino-tinto font-weight-bold">${nombreFinal}</h5>
          ${textoFinal ? `<p class="card-text text-muted mb-2">${textoFinal}</p>` : ''}
          ${precioFinal ? `<span class="text-rosado font-weight-bold h5 mb-3">$${precioFinal} ARS</span>` : ''}
        </div>
        <div class="card-footer bg-white border-0">
          <button class="btn ${btnClass} btn-block ver-detalle-btn" data-producto='${JSON.stringify(prod)}'>Ver detalle</button>
        </div>
      </div>
    </div>
  `;
}

// Actualizar botón "Ver más"
function actualizarBotonVerMas(seccion, mostrar) {
  console.log('Actualizando botón Ver más para:', seccion, 'Mostrar:', mostrar);
  let btnContainer = document.getElementById(`btn-ver-mas-${seccion}`);
  
  if (!btnContainer) {
    // Crear el contenedor del botón si no existe
    btnContainer = document.createElement('div');
    btnContainer.id = `btn-ver-mas-${seccion}`;
    btnContainer.className = 'text-center mt-4';
    
    const container = seccion === 'novedades' 
      ? document.querySelector('#novedades .container')
      : document.querySelector('#productos .container');
    
    if (container) {
      container.appendChild(btnContainer);
    } else {
      console.error('No se encontró contenedor para el botón');
      return;
    }
  }

  if (mostrar) {
    btnContainer.innerHTML = `
      <button class="btn btn-outline-vino-tinto btn-lg px-5 py-3" data-accion="cargarMas${seccion === 'novedades' ? 'Novedades' : 'Productos'}">
        Ver más
      </button>
    `;
    btnContainer.style.display = 'block';
    console.log('Botón Ver más mostrado');
  } else {
    btnContainer.style.display = 'none';
    console.log('Botón Ver más oculto');
  }
}

// Funciones para cargar más elementos
async function cargarMasNovedades() {
  console.log('=== CARGANDO MÁS NOVEDADES ===');
  console.log('Página actual antes:', paginaActualNovedades);
  paginaActualNovedades++;
  console.log('Página actual después:', paginaActualNovedades);
  await renderizarNovedades();
  
  // Actualizar contador de productos mostrados
  const totalMostrado = paginaActualNovedades * ITEMS_POR_PAGINA_NOVEDADES;
  const totalTexto = Math.min(totalMostrado, todasLasNovedades.length);
}

async function cargarMasProductos() {
  paginaActualProductos++;
  await renderizarProductos();
  
  // Actualizar contador de productos mostrados
  const totalMostrado = paginaActualProductos * ITEMS_POR_PAGINA_PRODUCTOS;
  const totalTexto = Math.min(totalMostrado, productosFiltrados.length);
}

// Función para mostrar productos por categoría
async function mostrarCategoria(categoria) {
  console.log('=== MOSTRANDO CATEGORÍA:', categoria, '===');
  
  // Actualizar categoría activa
  categoriaActiva = categoria;
  
  // Actualizar estado visual del menú
  actualizarMenuActivo(categoria);
  
  // Filtrar productos según la categoría
  if (categoria === 'todos') {
    productosFiltrados = [...todosLosProductos];
  } else {
    // Filtrar por categoría base (antes del guión) o categoría exacta
    productosFiltrados = todosLosProductos.filter(p => {
      if (!p.categoria) return false;
      
      const categoriaProducto = p.categoria.toLowerCase();
      const categoriaBuscada = categoria.toLowerCase();
      
      // Verificar si coincide exactamente
      if (categoriaProducto === categoriaBuscada) return true;
      
      // Verificar si la categoría base coincide (antes del guión)
      const categoriaBase = categoriaProducto.split('-')[0];
      return categoriaBase === categoriaBuscada;
    });
  }
  
  console.log('Productos filtrados:', productosFiltrados);
  console.log('Total productos en categoría:', productosFiltrados.length);
  
  // Resetear paginación
  paginaActualProductos = 1;
  
  // Actualizar título de la sección
  const tituloProductos = document.getElementById('titulo-productos');
  if (categoria === 'todos') {
    tituloProductos.textContent = 'Todos los Productos';
  } else {
    tituloProductos.textContent = categoria;
  }
  
  // Renderizar productos filtrados
  await renderizarProductos();
  
  // Scroll hacia la sección de productos
  document.getElementById('productos').scrollIntoView({ 
    behavior: 'smooth',
    block: 'start'
  });
}

// Función para actualizar el estado visual del menú
function actualizarMenuActivo(categoria) {
  // Remover clase active de todos los elementos del menú
  const menuItems = document.querySelectorAll('.dropdown-item');
  menuItems.forEach(item => item.classList.remove('active'));
  
  // Agregar clase active al elemento seleccionado
  let menuId = '';
  switch(categoria.toLowerCase()) {
    case 'todos': menuId = 'menu-todos'; break;
    case 'tops': menuId = 'menu-tops'; break;
    case 'polleras': menuId = 'menu-polleras'; break;
    case 'pantalones': menuId = 'menu-pantalones'; break;
    case 'minis': menuId = 'menu-minis'; break;
    case 'vestidos': menuId = 'menu-vestidos'; break;
    case 'accesorios': menuId = 'menu-accesorios'; break;
    case 'remeras': menuId = 'menu-remeras'; break;
    case 'bodys': menuId = 'menu-bodys'; break;
    case 'conjuntos': menuId = 'menu-conjuntos'; break;
    case 'shorts': menuId = 'menu-shorts'; break;
  }
  
  if (menuId) {
    const activeMenuItem = document.getElementById(menuId);
    if (activeMenuItem) {
      activeMenuItem.classList.add('active');
    }
  }
}

// Función para obtener categorías disponibles
function obtenerCategoriasDisponibles() {
  const categorias = todosLosProductos.map(p => {
    if (!p.categoria) return null;
    
    const categoria = p.categoria.toLowerCase();
    // Si contiene "-novedad", tomar solo la parte antes del guión
    if (categoria.includes('-novedad')) {
      return p.categoria.split('-')[0];
    }
    // Si es "novedades", no incluir
    if (categoria === 'novedades') {
      return null;
    }
    
    return p.categoria;
  }).filter(cat => cat); // Eliminar nulls
  
  // Obtener categorías únicas
  return [...new Set(categorias)];
}

// Guardar producto en localStorage y redirigir
function verDetalleCapri(prod) {
  // Permitir ver el detalle incluso si está sin stock
  fetch(prod.txt).then(r => r.text()).then(txt => {
    // Extraer información entre llaves en formato secuencial
    // Formato: {Nombre}{Descripción}{Precio}{Talle}{Detalle}
    // NOTA: Todos los campos son opcionales
    const matches = txt.match(/\{([^}]+)\}/g);
    
    let nombre = '', textoTarjeta = '', precio = '', talle = '', detalle = '';
    if (matches && matches.length >= 1) {
      // Extraer solo los campos disponibles, permitiendo que estén vacíos
      nombre = matches[0] ? matches[0].replace(/[{}]/g, '').trim() : '';
      textoTarjeta = matches[1] ? matches[1].replace(/[{}]/g, '').trim() : '';
      precio = matches[2] ? matches[2].replace(/[{}]/g, '').trim() : '';
      talle = matches[3] ? matches[3].replace(/[{}]/g, '').trim() : '';
      detalle = matches[4] ? matches[4].replace(/[{}]/g, '').trim() : '';
    }
    
    const productoDetalle = {
      nombre: nombre,
      precio: precio,
      desc: textoTarjeta,
      talle: talle,
      detalle: detalle,
      img: prod.imagen,
      txt: prod.txt,
      // ⭐ AGREGADO: Incluir datos originales para extraer ID
      originalData: {
        imagen: prod.imagen,
        txt: prod.txt,
        categoria: prod.categoria
      }
    };
    localStorage.setItem('productoDetalle', JSON.stringify(productoDetalle));
    window.location.href = 'detalle.html';
  }).catch(() => {
    // Si falla, guardar solo las urls pero incluir datos originales
    const productoDetalle = {
      nombre: '',
      precio: '',
      desc: '',
      detalle: '',
      img: prod.imagen,
      txt: prod.txt,
      // ⭐ AGREGADO: Incluir datos originales incluso si falla
      originalData: {
        imagen: prod.imagen,
        txt: prod.txt,
        categoria: prod.categoria
      }
    };
    localStorage.setItem('productoDetalle', JSON.stringify(productoDetalle));
    window.location.href = 'detalle.html';
  });
}

// Hacer disponibles las funciones globalmente
window.mostrarCategoria = mostrarCategoria;
window.cargarMasNovedades = cargarMasNovedades;
window.cargarMasProductos = cargarMasProductos;
window.verDetalleCapri = verDetalleCapri;
window.refrescarStock = refrescarStock;

// Event delegation para botones "Ver detalle" y clicks en tarjetas
document.addEventListener('click', function(e) {
  // Manejar click en botones "Ver detalle"
  const btnDetalle = e.target.closest('.ver-detalle-btn');
  if (btnDetalle) {
    e.preventDefault();
    e.stopPropagation();
    
    const productoData = btnDetalle.getAttribute('data-producto');
    if (productoData) {
      try {
        const producto = JSON.parse(productoData);
        verDetalleCapri(producto);
      } catch (error) {
        console.error('Error al parsear datos del producto:', error);
      }
    }
    return;
  }
  
  // Manejar click en botón "Refrescar stock"
  if (e.target.id === 'link-refrescar' || e.target.closest('#link-refrescar')) {
    e.preventDefault();
    refrescarStock();
    return;
  }
  
  // Manejar click en botones "Ver más"
  if (e.target.getAttribute('data-accion') === 'cargarMasNovedades') {
    e.preventDefault();
    cargarMasNovedades();
    return;
  }
  
  if (e.target.getAttribute('data-accion') === 'cargarMasProductos') {
    e.preventDefault();
    cargarMasProductos();
    return;
  }
});

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', cargarProductosCapri);
