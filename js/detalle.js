// detalle.js
// L�gica exclusiva para la ventana de detalle de producto en Capri Store

const DETALLE_API_BASE = (typeof getCapriApiBaseUrl === 'function' && getCapriApiBaseUrl()) ||
  (window.CapriConfig && typeof window.CapriConfig.getApiBaseUrl === 'function'
    ? window.CapriConfig.getApiBaseUrl()
    : '');

function detalleResolveApiUrl(pathname) {
  if (typeof buildCapriApiUrl === 'function') {
    return buildCapriApiUrl(pathname);
  }
  const path = typeof pathname === 'string' && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  return DETALLE_API_BASE ? `${DETALLE_API_BASE}${path}` : path;
}

const CATEGORIAS_SIN_TALLE = ['accesorios', 'carteras', 'onafitness'];
const VALORES_TALLE_OPCIONAL = new Set(['', 'sin talle', 'sin-talle', 'sintalle', 'unitalla', 'unico', 'único', 'ajustable', 'na', 'n/a', 'u']);

// Carga un producto desde productos.json de GCS usando su ID num�rico.
// Retorna un objeto con el formato de productoDetalle, o null si no se encuentra.
async function cargarProductoPorId(id) {
  try {
    const resp = await fetch(
      `https://storage.googleapis.com/imagenes-web-capri/productos.json?t=${Date.now()}`,
      { cache: 'no-store' }
    );
    if (!resp.ok) return null;
    const productos = await resp.json();
    const idNum = parseInt(id, 10);
    const found = productos.find(p => {
      const rawPath = decodeURIComponent(p.txt || p.imagen || '');
      const m = rawPath.match(/\/(\d+)-[^/]+/);
      return m && parseInt(m[1], 10) === idNum;
    });
    if (!found) return null;
    // Cargar datos del .txt
    try {
      const txtResp = await fetch(found.txt, { cache: 'no-store' });
      const buffer = await txtResp.arrayBuffer();
      const txt = new TextDecoder('utf-8').decode(buffer);
      const matches = txt.match(/\{([^}]+)\}/g) || [];
      const limpiar = v => (v || '').replace(/[{}]/g, '').trim();
      return {
        nombre:  matches[0] ? limpiar(matches[0]) : '',
        desc:    matches[1] ? limpiar(matches[1]) : '',
        precio:  matches[2] ? limpiar(matches[2]) : '',
        talle:   matches[3] ? limpiar(matches[3]) : '',
        detalle: matches[4] ? limpiar(matches[4]) : '',
        img: found.imagen,
        txt: found.txt,
        originalData: { imagen: found.imagen, txt: found.txt, categoria: found.categoria }
      };
    } catch {
      return { nombre: '', desc: '', precio: '', talle: '', detalle: '', img: found.imagen, txt: found.txt,
        originalData: { imagen: found.imagen, txt: found.txt, categoria: found.categoria } };
    }
  } catch { return null; }
}


// =============================================================================
// M�DULO DE VARIANTES (COLOR + TALLE + CANTIDAD)
// Reemplaza la l�gica anterior de /stock-producto y configurarCampoTalle.
// =============================================================================

/** Estado en memoria de las variantes del producto visible. */
const estadoVariantes = {
  prenda: null,
  variantes: [],        // [{ color, talles: [{talle, stock, ids}] }]
  colorActual: null,
  talleActual: null,    // objeto {talle, stock, ids} elegido por el usuario
  imagenesPorColor: {} // { "Negro": "https://...", ... }
};

/** Consulta GET /variantes-producto/:id. Retorna { prenda, variantes } o null. */
async function cargarVariantesProducto(idArticulo) {
  if (!idArticulo) return null;
  try {
    const resp = await fetch(detalleResolveApiUrl(`/variantes-producto/${idArticulo}`), { cache: 'no-store' });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data && Array.isArray(data.variantes)) ? data : null;
  } catch { return null; }
}

/**
 * Recorre productos.json buscando entradas con el mismo campo "prenda",
 * para obtener la URL de imagen de cada color.
 * (Solo funciona con productos cargados tras el nuevo sistema Java.)
 */
async function cargarImagenesPorColor(prenda) {
  const mapa = {};
  if (!prenda) return mapa;
  try {
    const resp = await fetch(
      `https://storage.googleapis.com/imagenes-web-capri/productos.json?t=${Date.now()}`,
      { cache: 'no-store' }
    );
    if (!resp.ok) return mapa;
    const lista = await resp.json();
    lista.forEach(p => {
      if (p.prenda === prenda && p.color && p.imagen) mapa[p.color] = p.imagen;
    });
  } catch {}
  return mapa;
}

/** Extrae el id_articulo num�rico desde el objeto producto del localStorage. */
function obtenerIdDesdeProducto(producto) {
  if (!producto) return null;
  if (producto.id_articulo) return parseInt(producto.id_articulo, 10);
  const path = decodeURIComponent(producto.img || producto.txt || '');
  const m = path.match(/\/(\d+)-[^/]+/);
  return m ? parseInt(m[1], 10) : null;
}

/** Traduce un nombre de color en espa�ol a un valor CSS v�lido. */
function colorACss(nombre) {
  const mapa = {
    negro:'#2c2c2a', blanco:'#ffffff', rojo:'#c0392b', bordo:'#712b13',
    azul:'#185fa5', verde:'#3b6d11', amarillo:'#e0a800', rosa:'#e29ca3',
    rosado:'#e29ca3', gris:'#888780', beige:'#d8c9a3', marron:'#5a3a22',
    'marrón':'#5a3a22', violeta:'#7f77dd', celeste:'#85b7eb',
    naranja:'#d85a30', fucsia:'#d4537e', dorado:'#b08d57', plateado:'#c0c0c0'
  };
  const k = (nombre || '').toString().trim().toLowerCase();
  return mapa[k] || k || '#cccccc';
}

/** Actualiza la imagen principal cuando el usuario cambia de color. */
function actualizarImagenPorColor(color) {
  const url = estadoVariantes.imagenesPorColor[color];
  if (url) {
    const img = document.getElementById('mainImage');
    if (img) img.src = url;
  }
}

/** Renderiza los c�rculos de color. Oculta el grupo si hay un solo color. */
function renderizarColores() {
  const grupo = document.getElementById('grupo-color');
  const cont  = document.getElementById('color-options');
  if (!grupo || !cont) return;
  cont.innerHTML = '';

  if (estadoVariantes.variantes.length <= 1) {
    grupo.style.display = 'none';
    if (estadoVariantes.variantes.length === 1) {
      estadoVariantes.colorActual = estadoVariantes.variantes[0].color;
    }
    renderizarTalles();
    return;
  }

  grupo.style.display = '';
  estadoVariantes.variantes.forEach((v, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch' + (i === 0 ? ' selected' : '');
    btn.title = v.color;
    btn.setAttribute('aria-label', v.color);
    btn.style.background = colorACss(v.color);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(c => c.classList.remove('selected'));
      btn.classList.add('selected');
      estadoVariantes.colorActual = v.color;
      estadoVariantes.talleActual = null;
      actualizarImagenPorColor(v.color);
      renderizarTalles();
    });
    cont.appendChild(btn);
  });

  if (!estadoVariantes.colorActual && estadoVariantes.variantes.length) {
    estadoVariantes.colorActual = estadoVariantes.variantes[0].color;
  }
}

/** Renderiza los botones de talle para el color actualmente seleccionado. */
function renderizarTalles() {
  const cont    = document.getElementById('talle-options');
  const mensaje = document.getElementById('talle-mensaje');
  const selectOculto = document.getElementById('size');
  if (!cont) return;

  cont.innerHTML = '';
  estadoVariantes.talleActual = null;
  actualizarSelectorCantidad();
  actualizarBotonAgregar();

  const variante = estadoVariantes.variantes.find(v => v.color === estadoVariantes.colorActual);
  const talles   = variante ? variante.talles : [];

  if (!talles.length) {
    if (mensaje) mensaje.textContent = 'Sin talles disponibles para este color.';
    return;
  }
  if (mensaje) mensaje.textContent = 'Elegí un talle.';

  talles.forEach(t => {
    const disponible = t.stock > 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'talle-btn';
    btn.textContent = t.talle;
    btn.disabled = !disponible;
    btn.setAttribute('aria-label', `Talle ${t.talle}${disponible ? '' : ' - Sin stock'}`);
    btn.addEventListener('click', () => {
      if (!disponible) return;
      estadoVariantes.talleActual = t;
      document.querySelectorAll('.talle-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      // Sincronizar select oculto (compatibilidad)
      if (selectOculto) {
        let opt = Array.from(selectOculto.options).find(o => o.value === t.talle);
        if (!opt) { opt = document.createElement('option'); opt.value = t.talle; opt.textContent = t.talle; selectOculto.appendChild(opt); }
        selectOculto.value = t.talle;
      }
      if (mensaje) mensaje.textContent = '';
      actualizarSelectorCantidad();
      actualizarBotonAgregar();
    });
    cont.appendChild(btn);
  });
}

/** Construye el <select> de cantidad limitado al stock real de la combinaci�n. */
function actualizarSelectorCantidad() {
  const grupo       = document.getElementById('grupo-cantidad');
  const select      = document.getElementById('quantity-select');
  const inputOculto = document.getElementById('quantity');
  const stockLabel  = document.getElementById('stock-label');
  if (!grupo || !select) return;

  if (!estadoVariantes.talleActual || estadoVariantes.talleActual.stock < 1) {
    grupo.style.display = 'none';
    if (inputOculto) inputOculto.value = 1;
    return;
  }

  grupo.style.display = '';
  select.innerHTML = '';
  const max = estadoVariantes.talleActual.stock;
  for (let i = 1; i <= max; i++) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = i;
    select.appendChild(opt);
  }
  select.value = 1;
  if (inputOculto) inputOculto.value = 1;
  if (stockLabel)  stockLabel.textContent = `${max} disponible${max !== 1 ? 's' : ''}`;
  select.onchange = () => { if (inputOculto) inputOculto.value = select.value; };
}

/** Habilita o deshabilita el bot�n Agregar al carrito seg�n el estado actual. */
function actualizarBotonAgregar() {
  const btn = document.getElementById('btnAgregarCarrito');
  if (!btn) return;
  const hayStock = !!(estadoVariantes.talleActual && estadoVariantes.talleActual.stock > 0);
  btn.disabled = !hayStock;
  if (hayStock) {
    btn.textContent = 'Agregar al carrito';
    btn.classList.add('btn-vino-tinto'); btn.classList.remove('btn-secondary');
  } else {
    btn.textContent = estadoVariantes.variantes.length ? 'Elegí un talle' : 'Sin stock';
    btn.classList.remove('btn-vino-tinto'); btn.classList.add('btn-secondary');
  }
}

/**
 * Punto de entrada del m�dulo.
 * Llama al backend, puebla estadoVariantes y renderiza la UI.
 * Se invoca desde el primer DOMContentLoaded una vez que el producto est� cargado.
 */
async function inicializarVariantes(producto) {
  const idRef = obtenerIdDesdeProducto(producto);
  if (!idRef) { actualizarBotonAgregar(); return; }

  const data = await cargarVariantesProducto(idRef);
  if (!data || !data.variantes.length) {
    const msg = document.getElementById('talle-mensaje');
    if (msg) msg.textContent = 'No se pudo verificar disponibilidad. Recargá la página.';
    actualizarBotonAgregar();
    return;
  }

  estadoVariantes.prenda    = data.prenda;
  estadoVariantes.variantes = data.variantes;
  estadoVariantes.imagenesPorColor = await cargarImagenesPorColor(data.prenda);

  renderizarColores();
}

// =============================================================================
document.addEventListener('DOMContentLoaded', async function() {
  const urlParams = new URLSearchParams(window.location.search);
  const idFromUrl = urlParams.get('id');

  let productoStr = localStorage.getItem('productoDetalle');
  let producto = productoStr ? JSON.parse(productoStr) : null;

  // Si hay ?id= en la URL y el localStorage no corresponde a ese ID, cargar desde GCS
  if (idFromUrl) {
    const idNum = parseInt(idFromUrl, 10);
    const localId = (() => {
      if (!producto) return null;
      const rawPath = decodeURIComponent(producto.img || producto.txt || '');
      const m = rawPath.match(/\/(\d+)-[^/]+/);
      return m ? parseInt(m[1], 10) : null;
    })();
    if (localId !== idNum) {
      producto = await cargarProductoPorId(idFromUrl);
      if (producto) localStorage.setItem('productoDetalle', JSON.stringify(producto));
    }
  }
  const limpiar = v => {
    const s = (v || '').replace(/[{}]/g, '').trim();
    const l = s.toLowerCase();
    return (l === 'null' || l === 'undefined') ? '' : s;
  };

  // Poblar campos est�ticos (nombre, precio, descripci�n, detalle) desde el .txt de GCS
  if (producto && producto.txt) {
    try {
      const buf = await (await fetch(producto.txt)).arrayBuffer();
      const txt = new TextDecoder('utf-8').decode(buf);
      // Formato: {Nombre}{Descripci�n}{Precio}[{TalleObsoleto}]{Detalle}
      const m = txt.match(/\{([^}]+)\}/g) || [];
      const nombre      = limpiar(m[0]) || producto.nombre || '';
      const descripcion = limpiar(m[1]) || producto.desc   || '';
      const precio      = limpiar(m[2]) || producto.precio || '';
      // m[3] era el talle fijo: ignorado intencionalmente, ahora viene de BBDD
      const detalle     = limpiar(m[4]) || limpiar(m[3]) || '';

      document.getElementById('mainImage').src = producto.img || '';
      document.getElementById('mainImage').alt = nombre;
      document.getElementById('nombre-producto').textContent  = nombre;
      document.getElementById('precio-producto').textContent  = precio ? `$${precio} ARS` : '';

      const descEl = document.querySelector('.descripcion-producto');
      if (descEl) { descEl.textContent = descripcion; descEl.style.display = descripcion ? '' : 'none'; }

      const secDet  = document.getElementById('seccion-detalles');
      const contDet = document.getElementById('detalle-contenido');
      if (secDet && contDet) { contDet.textContent = detalle; secDet.style.display = detalle ? '' : 'none'; }

    } catch {
      // Fallback desde localStorage
      document.getElementById('mainImage').src = producto.img || '';
      document.getElementById('mainImage').alt = producto.nombre || '';
      document.getElementById('nombre-producto').textContent = producto.nombre || 'Producto';
      document.getElementById('precio-producto').textContent = producto.precio ? `$${producto.precio} ARS` : '';
      const descEl = document.querySelector('.descripcion-producto');
      if (descEl) descEl.textContent = producto.desc || '';
    }
  } else if (producto) {
    document.getElementById('mainImage').src = producto.img || '';
    document.getElementById('mainImage').alt = producto.nombre || '';
    document.getElementById('nombre-producto').textContent = producto.nombre || 'Producto';
    document.getElementById('precio-producto').textContent = producto.precio ? `$${producto.precio} ARS` : '';
    const descEl = document.querySelector('.descripcion-producto');
    if (descEl) descEl.textContent = producto.desc || '';
  } else {
    document.getElementById('nombre-producto').textContent = 'Producto no encontrado';
    document.getElementById('precio-producto').textContent = '';
    const descEl = document.querySelector('.descripcion-producto');
    if (descEl) descEl.textContent = '';
  }

  // Inicializar selectores de color/talle/cantidad desde BBDD
  await inicializarVariantes(producto);
});

// L�gica del formulario: agregar al carrito
document.addEventListener('DOMContentLoaded', function() {
  const seguirBtn = document.getElementById('seguirComprandoBtn');
  if (seguirBtn) {
    seguirBtn.addEventListener('click', () => {
      if (typeof closeCartSidenav === 'function') closeCartSidenav();
      window.location.href = 'index.html';
    });
  }

  const productForm = document.getElementById('productForm');
  if (!productForm) return;

  productForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    const productoStr = localStorage.getItem('productoDetalle');
    const producto = productoStr ? JSON.parse(productoStr) : null;

    // Validar que el usuario eligi� un talle con stock
    if (!estadoVariantes.talleActual || estadoVariantes.talleActual.stock < 1) {
      if (typeof mostrarPopup === 'function') mostrarPopup('Elegí un talle disponible antes de continuar.', 'warning');
      return;
    }
    if (!producto) {
      if (typeof mostrarPopup === 'function') mostrarPopup('Error: producto no encontrado.', 'error');
      return;
    }

    const talle   = estadoVariantes.talleActual.talle;
    const color   = estadoVariantes.colorActual || '';
    const stockMax = estadoVariantes.talleActual.stock;
    const idsDisponibles = estadoVariantes.talleActual.ids;

    const selectCant = document.getElementById('quantity-select');
    const quantity = Math.max(1, parseInt((selectCant && selectCant.value) || '1', 10));

    if (quantity > stockMax) {
      if (typeof mostrarPopup === 'function') mostrarPopup(`Solo hay ${stockMax} unidades disponibles de este talle.`, 'warning');
      return;
    }

    // Chequear cu�ntas ya est�n en el carrito (misma combinaci�n)
    const nombreItem = color
      ? `${producto.nombre} - ${color} (Talle: ${talle})`
      : `${producto.nombre} (Talle: ${talle})`;

    let cantidadEnCarrito = 0;
    try {
      const items = JSON.parse(localStorage.getItem('carrito') || '[]');
      const enCarrito = items.find(i => i.nombre === nombreItem && i.img === producto.img);
      if (enCarrito) cantidadEnCarrito = enCarrito.cantidad || 0;
    } catch {}

    const stockRestante = stockMax - cantidadEnCarrito;
    if (stockRestante <= 0) {
      if (typeof mostrarPopup === 'function') mostrarPopup('Ya tenés todo el stock disponible de este talle en el carrito.', 'info');
      return;
    }
    if (quantity > stockRestante) {
      if (typeof mostrarPopup === 'function') {
        mostrarPopup(`Solo podés agregar ${stockRestante} unidad${stockRestante !== 1 ? 'es' : ''} más. Ya tenés ${cantidadEnCarrito} en el carrito.`, 'warning');
      }
      return;
    }

    // Tomar los primeros N id_articulo disponibles
    const idsAReservar = idsDisponibles.slice(0, quantity);

    if (typeof agregarAlCarrito === 'function') {
      agregarAlCarrito(
        nombreItem,
        Number(producto.precio),
        producto.img,
        quantity,
        { ...producto, id_articulo: idsAReservar[0], ids_articulos: idsAReservar }
      );
      if (typeof mostrarPopup === 'function') mostrarPopup(`Agregado: ${nombreItem} x${quantity}`);
      console.log('? Carrito actualizado:', nombreItem, 'x', quantity, '| IDs:', idsAReservar);
    } else {
      console.error('? agregarAlCarrito no disponible');
      alert('Error al agregar al carrito.');
      return;
    }

    // Resetear selecci�n de talle/cantidad sin recargar las variantes
    document.querySelectorAll('.talle-btn').forEach(b => b.classList.remove('selected'));
    estadoVariantes.talleActual = null;
    const sc = document.getElementById('quantity-select');
    if (sc) sc.innerHTML = '';
    const gc = document.getElementById('grupo-cantidad');
    if (gc) gc.style.display = 'none';
    const qi = document.getElementById('quantity');
    if (qi) qi.value = 1;
    const sl = document.getElementById('stock-label');
    if (sl) sl.textContent = '';
    actualizarBotonAgregar();
  });
});

function obtenerInfoTalleFormulario(talle, producto) {
  const valorNormalizado = (talle && talle !== 'null') ? talle.toString().trim() : '';
  const opcional = esTalleOpcionalPorDatos(valorNormalizado, producto);
  const valor = opcional ? 'UNICO' : (valorNormalizado || 'M');
  const etiqueta = opcional ? 'Único / Sin talle' : valor;
  return { valor, etiqueta, opcional };
}

function configurarCampoTalle(selectElement, talle, producto) {
  if (!selectElement) return;
  const infoTalle = obtenerInfoTalleFormulario(talle, producto);
  selectElement.dataset.optional = infoTalle.opcional ? 'true' : 'false';
  selectElement.required = !infoTalle.opcional;
  let option = Array.from(selectElement.options || []).find(opt => opt.value === infoTalle.valor);
  if (!option) {
    option = document.createElement('option');
    option.value = infoTalle.valor;
    option.textContent = infoTalle.etiqueta;
    selectElement.appendChild(option);
  } else if (infoTalle.opcional) {
    option.textContent = infoTalle.etiqueta;
  }
  selectElement.value = infoTalle.valor;
  selectElement.disabled = true;
  selectElement.style.backgroundColor = '#f8f9fa';
  selectElement.style.cursor = 'not-allowed';
}

function esTalleOpcionalPorDatos(talle, producto) {
  const valor = (talle || '').toString().trim().toLowerCase();
  if (valor && !VALORES_TALLE_OPCIONAL.has(valor)) {
    // Si el .txt trae un talle real (ej. S, M, L) respetarlo, aunque la categor�a sea de accesorios
    return false;
  }
  if (VALORES_TALLE_OPCIONAL.has(valor)) {
    return true;
  }
  const categoria = obtenerCategoriaDesdeProducto(producto);
  const slug = obtenerSlugCategoriaDetalle(categoria);
  if (slug && CATEGORIAS_SIN_TALLE.includes(slug)) {
    return true;
  }
  return false;
}

function obtenerCategoriaDesdeProducto(producto) {
  return (producto && producto.originalData && producto.originalData.categoria) || producto?.categoria || '';
}

function obtenerSlugCategoriaDetalle(valor) {
  if (!valor) return '';
  let slug = valor.toString().trim().toLowerCase();
  slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  slug = slug.replace(/\s+/g, '-');
  if (slug === 'ona-fitness' || slug === 'onna-fitness' || slug === 'onafitness' || slug === 'onnafitness') {
    return 'onafitness';
  }
  return slug;
}

// Funci�n para mostrar el stock disponible
function mostrarStockDisponible(stock) {
  let stockElement = document.getElementById('stock-disponible');
  if (!stockElement) {
    stockElement = document.createElement('div');
    stockElement.id = 'stock-disponible';
    stockElement.className = 'mt-3 mb-2';
    const botonAgregar = document.getElementById('btnAgregarCarrito');
    if (botonAgregar && botonAgregar.parentNode) {
      botonAgregar.parentNode.insertBefore(stockElement, botonAgregar.nextSibling);
    } else {
      const precioElement = document.getElementById('precio-producto');
      if (precioElement && precioElement.parentNode) {
        precioElement.parentNode.insertBefore(stockElement, precioElement.nextSibling);
      }
    }
  }
  if (stock > 0) {
    stockElement.innerHTML = `
      <div class="d-flex align-items-center">
        <i class="fas fa-check-circle text-success mr-2"></i>
        <span class="font-weight-bold" style="color: #333;">Stock Disponible: ${stock}</span>
      </div>
    `;
  } else {
    stockElement.innerHTML = `
      <div class="d-flex align-items-center">
        <i class="fas fa-times-circle text-danger mr-2"></i>
        <span class="text-danger font-weight-bold">Sin stock</span>
      </div>
    `;
  }
}

// Funci�n para mostrar pop-ups elegantes (copia de scripts.js para compatibilidad)
function mostrarPopup(mensaje, tipo = 'success') {
  if (window.mostrarPopup && typeof window.mostrarPopup === 'function' && window.mostrarPopup !== mostrarPopup) {
    window.mostrarPopup(mensaje, tipo);
    return;
  }

  let popup = document.getElementById("popup-carrito");
  if (popup) popup.remove();

  const tipos = {
    success: { bg: 'linear-gradient(135deg, #6b0a0a 0%, #8b1538 100%)', icon: '?', color: '#fff' },
    error:   { bg: 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)', icon: '?', color: '#fff' },
    warning: { bg: 'linear-gradient(135deg, #ffc107 0%, #e0a800 100%)', icon: '!', color: '#212529' },
    info:    { bg: 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)', icon: '?', color: '#fff' }
  };

  const config = tipos[tipo] || tipos.success;

  popup = document.createElement("div");
  popup.id = "popup-carrito";
  popup.style.cssText = `
    position: fixed; top: 30px; left: 50%;
    transform: translateX(-50%) scale(0.8);
    background: ${config.bg}; color: ${config.color};
    padding: 20px 28px; border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.15);
    backdrop-filter: blur(10px); z-index: 9999;
    font-size: 1rem; font-weight: 500; opacity: 0;
    transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    border: 1px solid rgba(255,255,255,0.2);
    max-width: 350px; min-width: 280px;
  `;
  popup.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="font-size:1.4rem; font-weight:bold; background:rgba(255,255,255,0.2);
        width:32px; height:32px; border-radius:50%; display:flex; align-items:center;
        justify-content:center; flex-shrink:0;">${config.icon}</div>
      <div style="flex: 1; line-height: 1.4;">${mensaje}</div>
    </div>
  `;

  document.body.appendChild(popup);
  requestAnimationFrame(() => {
    popup.style.opacity = '1';
    popup.style.transform = 'translateX(-50%) scale(1)';
  });
  setTimeout(() => {
    popup.style.opacity = '0';
    popup.style.transform = 'translateX(-50%) scale(0.9)';
    setTimeout(() => popup.remove(), 500);
  }, 3500);
}

window.mostrarPopup = mostrarPopup;
