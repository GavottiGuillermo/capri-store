// Variables globales para paginación
let todosLosProductos = [];
let todasLasNovedades = [];
let productosAgrupados = new Map();
const ITEMS_POR_PAGINA_NOVEDADES = 6; // 2 filas de 3 productos
let paginaActualNovedades = 1;

const CAPRI_API_BASE = (typeof getCapriApiBaseUrl === 'function' && getCapriApiBaseUrl()) ||
  (window.CapriConfig && typeof window.CapriConfig.getApiBaseUrl === 'function'
    ? window.CapriConfig.getApiBaseUrl()
    : '');

function resolveCapriApiUrl(pathname) {
  if (typeof buildCapriApiUrl === 'function') {
    return buildCapriApiUrl(pathname);
  }
  const path = typeof pathname === 'string' && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  return CAPRI_API_BASE ? `${CAPRI_API_BASE}${path}` : path;
}

// Orden alfabético de categorías (mismo orden que en el menú)
const ORDEN_CATEGORIAS = [
  'bodys',
  'conjuntos',
  'minis',
  'pantalones',
  'polleras',
  'remeras',
  'shorts',
  'tops',
  'vestidos',
  'accesorios',
  'carteras',
  'onafitness'
];

const NOMBRES_CATEGORIAS_PERSONALIZADOS = {
  onafitness: 'Onna Fitness'
};

function obtenerSlugCategoria(valor) {
  if (!valor) return '';
  let base = valor.toString().trim().toLowerCase();
  if (base.endsWith('-novedad')) {
    base = base.replace(/-novedad$/, '');
  }
  base = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  base = base.replace(/\s+/g, '-');
  if (base === 'ona-fitness' || base === 'onna-fitness' || base === 'onafitness' || base === 'onnafitness') {
    base = 'onafitness';
  }
  return base;
}

function formatearNombreCategoria(slug) {
  if (!slug) return 'Otros';
  if (NOMBRES_CATEGORIAS_PERSONALIZADOS[slug]) {
    return NOMBRES_CATEGORIAS_PERSONALIZADOS[slug];
  }
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, letra => letra.toUpperCase());
}

function agruparProductosPorCategoria(productos) {
  const mapa = new Map();
  productos.forEach(prod => {
    const slug = obtenerSlugCategoria(prod.categoria);
    const clave = slug || 'otros';
    if (!mapa.has(clave)) {
      mapa.set(clave, []);
    }
    mapa.get(clave).push(prod);
  });
  return mapa;
}

function obtenerCategoriasOrdenadas(mapaCategorias) {
  const claves = Array.from(mapaCategorias.keys());
  const definidas = ORDEN_CATEGORIAS.filter(cat => claves.includes(cat));
  const extras = claves.filter(cat => !ORDEN_CATEGORIAS.includes(cat)).sort();
  return [...definidas, ...extras];
}

function renderizarEnlacesCategorias(categoriasOrdenadas) {
  const containers = document.querySelectorAll('[data-category-links]');
  const barraCategorias = document.getElementById('categorias-nav');
  if (barraCategorias) {
    barraCategorias.style.display = categoriasOrdenadas.length ? 'block' : 'none';
  }
  if (!containers.length) return;
  containers.forEach(container => {
    container.innerHTML = '';
    categoriasOrdenadas.forEach(cat => {
      const enlace = document.createElement('a');
      enlace.href = `#categoria-${cat}`;
      enlace.textContent = formatearNombreCategoria(cat);
      enlace.className = 'category-chip js-scroll-trigger';
      enlace.setAttribute('data-category-link', cat);
      enlace.addEventListener('click', (event) => {
        const destino = enlace.getAttribute('href');
        if (destino && destino.startsWith('#') && destino.length > 1) {
          event.preventDefault();
          const objetivo = document.querySelector(destino);
          if (objetivo) {
            objetivo.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
      container.appendChild(enlace);
    });
  });
}

function aplicarEstadoStock(cardElement, prod) {
  try {
    const path = decodeURIComponent((prod.imagen || prod.txt || ''));
    const m = path.match(/\/(\d+)-[^/]+/);
    const id = m && m[1] ? parseInt(m[1], 10) : null;
    if (!id || !window.__CAPRI_SOLD_OUT__) {
      return;
    }
    if (window.__CAPRI_SOLD_OUT__.has(id)) {
      const card = cardElement.querySelector('.card');
      if (!card) return;
      card.style.filter = 'grayscale(0.6)';
      card.style.opacity = '0.8';
      if (!card.querySelector('.badge-sin-stock')) {
        const badge = document.createElement('div');
        badge.textContent = 'Sin stock';
        badge.className = 'badge-sin-stock';
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
    }
  } catch (error) {
    console.error('[STOCK] Error al aplicar estado de stock:', error);
  }
}

// Función para ordenar productos por categoría
function ordenarPorCategoria(productos) {
  return productos.sort((a, b) => {
    const catA = obtenerSlugCategoria(a.categoria);
    const catB = obtenerSlugCategoria(b.categoria);
    const indexA = ORDEN_CATEGORIAS.indexOf(catA);
    const indexB = ORDEN_CATEGORIAS.indexOf(catB);
    const ordenA = indexA === -1 ? 999 : indexA;
    const ordenB = indexB === -1 ? 999 : indexB;
    return ordenA - ordenB;
  });
}

// === SINCRONIZAR PRECIOS DEL CARRITO CON EL CATÁLOGO FRESCO ===
// Obtiene el precio actual desde un .txt de GCS y lo devuelve como número.
// Retorna null si falla o no puede parsear.
async function fetchPrecioDesdetxt(txtUrl) {
  try {
    const resp = await fetch(`${txtUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    const txt = new TextDecoder('utf-8').decode(buffer);
    const matches = txt.match(/\{([^}]*)\}/g);
    if (!matches || matches.length < 3) return null;
    const precioStr = matches[2].replace(/[{}]/g, '').trim();
    const precio = Number(precioStr);
    return (!isNaN(precio) && precio > 0) ? precio : null;
  } catch {
    return null;
  }
}

// Sincroniza precios del carrito leyendo los .txt de GCS directamente.
// Los precios SIEMPRE viven en los .txt — productos.json no los tiene.
async function sincronizarPreciosCarrito() {
  try {
    const cartRaw = localStorage.getItem('carrito');
    if (!cartRaw) return false;
    const cart = JSON.parse(cartRaw);
    if (!Array.isArray(cart) || cart.length === 0) return false;

    let algoCambio = false;

    await Promise.all(cart.map(async item => {
      // Preferir txt guardado; si no hay, derivarlo del .jpg
      const txtUrl = item.txt || (item.img ? item.img.replace(/\.jpg(\?.*)?$/i, '.txt') : null);
      if (!txtUrl) return;

      const precioActual = await fetchPrecioDesdetxt(txtUrl);
      if (precioActual !== null && precioActual !== Number(item.precio)) {
        console.warn(`💲 Precio actualizado en carrito: "${item.nombre}" $${item.precio} → $${precioActual}`);
        item.precio = precioActual;
        algoCambio = true;
      }
    }));

    if (algoCambio) {
      localStorage.setItem('carrito', JSON.stringify(cart));
      if (typeof actualizarCartSidenav === 'function') actualizarCartSidenav();
    }
    return algoCambio;
  } catch (e) {
    console.error('Error al sincronizar precios del carrito:', e);
    return false;
  }
}

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
    console.log('📦 Solicitando stock agotado desde backend...');
    const stockUrl = `${resolveCapriApiUrl('/stock-agotado')}?t=${timestamp}`;
    const respAg = await fetch(stockUrl, { cache: 'no-store' });
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
  
  // Ordenar productos por categoría alfabéticamente
  todosLosProductos = ordenarPorCategoria(todosLosProductos);

  // Sincronizar precios del carrito leyendo los .txt frescos (sin await para no bloquear render)
  sincronizarPreciosCarrito();

  productosAgrupados = agruparProductosPorCategoria(todosLosProductos);
  const categoriasOrdenadas = obtenerCategoriasOrdenadas(productosAgrupados);
  renderizarEnlacesCategorias(categoriasOrdenadas);
  
  console.log('📊 Resumen:', todasLasNovedades.length, 'novedades,', todosLosProductos.length, 'productos');

  // Actualizar navegación
  actualizarNavegacion();

  // Limpiar contenedores antes de renderizar (igual que en refrescarStock)
  const novedadesList = document.getElementById('novedades-list');
  const productosList = document.getElementById('productos-list');
  if (novedadesList) novedadesList.innerHTML = '';
  if (productosList) productosList.innerHTML = '';

  // Renderizar la primera página
  await renderizarNovedades();
  await renderizarProductos();
}

// Refrescar stock: vuelve a consultar al backend y re-renderiza
async function refrescarStock() {
  try {
    const link = document.getElementById('link-refrescar');
    if (link) { link.textContent = '🔄 Actualizando...'; link.style.pointerEvents = 'none'; }
    const timestamp = new Date().getTime();
    console.log('🔄 Refrescando stock desde servidor...');
    const respAg = await fetch(`${resolveCapriApiUrl('/stock-agotado')}?t=${timestamp}`, { cache: 'no-store' });
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
        todosLosProductos = ordenarPorCategoria(todosLosProductos);
        productosAgrupados = agruparProductosPorCategoria(todosLosProductos);
        const categoriasOrdenadas = obtenerCategoriasOrdenadas(productosAgrupados);
        renderizarEnlacesCategorias(categoriasOrdenadas);
      }
      
      // Re-renderizar secciones
      const novedadesList = document.getElementById('novedades-list');
      const productosList = document.getElementById('productos-list');
      if (novedadesList) novedadesList.innerHTML = '';
      if (productosList) productosList.innerHTML = '';
      paginaActualNovedades = 1;
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

  let indiceAnimacion = (paginaActualNovedades - 1) * ITEMS_POR_PAGINA_NOVEDADES;
  for (const prod of novedadesPagina) {
    const cardHtml = await crearTarjetaProducto(prod, 'novedad');
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = cardHtml.trim();
    const cardElement = tempDiv.firstElementChild;

    cardElement.style.opacity = '0';
    cardElement.style.transform = 'translateY(20px) scale(0.95)';
    cardElement.style.transition = 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

    novedadesList.appendChild(cardElement);

    setTimeout(() => {
      cardElement.style.opacity = '1';
      cardElement.style.transform = 'translateY(0) scale(1)';
      cardElement.classList.add('visible');
    }, indiceAnimacion * 50);

    aplicarEstadoStock(cardElement, prod);
    indiceAnimacion++;
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

// Renderizar productos agrupados por categoría, todos visibles simultáneamente
async function renderizarProductos() {
  const productosList = document.getElementById('productos-list');
  if (!productosList) {
    console.error('❌ ERROR: No se encontró el elemento productos-list');
    return;
  }

  productosList.innerHTML = '';

  if (!productosAgrupados || productosAgrupados.size === 0) {
    productosList.innerHTML = '<div class="alert alert-light text-center">No hay productos disponibles en este momento.</div>';
    return;
  }

  const categoriasOrdenadas = obtenerCategoriasOrdenadas(productosAgrupados);
  if (!categoriasOrdenadas.length) {
    productosList.innerHTML = '<div class="alert alert-light text-center">No hay categorías disponibles.</div>';
    return;
  }

  let productosRenderizados = 0;
  for (const categoria of categoriasOrdenadas) {
    const productosCategoria = productosAgrupados.get(categoria) || [];
    if (!productosCategoria.length) continue;

    const seccion = document.createElement('div');
    seccion.className = 'categoria-section';
    seccion.id = `categoria-${categoria}`;

    const header = document.createElement('div');
    header.className = 'categoria-encabezado';
    header.innerHTML = `
      <h3 class="text-vino-tinto font-weight-bold mb-0">${formatearNombreCategoria(categoria)}</h3>
    `;

    const row = document.createElement('div');
    row.className = 'row';

    for (const prod of productosCategoria) {
      try {
        const cardHtml = await crearTarjetaProducto(prod, 'producto');
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHtml.trim();
        const cardElement = tempDiv.firstElementChild;

        cardElement.style.opacity = '0';
        cardElement.style.transform = 'translateY(20px) scale(0.95)';
        cardElement.style.transition = 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

        row.appendChild(cardElement);

        setTimeout(() => {
          cardElement.style.opacity = '1';
          cardElement.style.transform = 'translateY(0) scale(1)';
          cardElement.classList.add('visible');
        }, productosRenderizados * 40);

        aplicarEstadoStock(cardElement, prod);
        productosRenderizados++;
      } catch (error) {
        console.error('❌ Error renderizando producto:', prod.id_articulo, error);
      }
    }

    seccion.appendChild(header);
    seccion.appendChild(row);
    productosList.appendChild(seccion);
  }

  if (!productosList.children.length) {
    productosList.innerHTML = '<div class="alert alert-light text-center">No hay productos disponibles en este momento.</div>';
  }

  console.log(`📊 RESUMEN RENDERIZADO: ${productosRenderizados} productos distribuidos en ${productosList.children.length} secciones`);
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
    // Forzar decodificación UTF-8
    const buffer = await txtResp.arrayBuffer();
    const decoder = new TextDecoder('utf-8');
    const txt = decoder.decode(buffer);
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
  if (seccion !== 'novedades') {
    return;
  }

  console.log('Actualizando botón Ver más para:', seccion, 'Mostrar:', mostrar);
  let btnContainer = document.getElementById(`btn-ver-mas-${seccion}`);
  
  if (!btnContainer) {
    btnContainer = document.createElement('div');
    btnContainer.id = `btn-ver-mas-${seccion}`;
    btnContainer.className = 'text-center mt-4';
    
    const container = document.querySelector('#novedades .container');
    
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


// Guardar producto en localStorage y redirigir
function verDetalleCapri(prod) {
  // Permitir ver el detalle incluso si está sin stock
  fetch(prod.txt)
    .then(r => r.arrayBuffer())
    .then(buffer => {
      // Forzar decodificación UTF-8
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(buffer);
    })
    .then(txt => {
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
window.cargarMasNovedades = cargarMasNovedades;
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
  
});

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', cargarProductosCapri);
