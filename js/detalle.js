// detalle.js
// Lógica exclusiva para la ventana de detalle de producto en Capri Store

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

document.addEventListener('DOMContentLoaded', async function() {
  // Obtener el producto seleccionado desde localStorage
  const productoStr = localStorage.getItem('productoDetalle');
  const producto = productoStr ? JSON.parse(productoStr) : null;
  const selectTalleGlobal = document.getElementById('size');
  const inputCantidadGlobal = document.getElementById('quantity');
  if (selectTalleGlobal) {
    configurarCampoTalle(selectTalleGlobal, producto?.talle, producto);
  }
  if (producto && producto.txt) {
    try {
      // Obtener los datos actualizados desde el .txt del producto
      const resp = await fetch(producto.txt);
      // Forzar decodificación UTF-8
      const buffer = await resp.arrayBuffer();
      const decoder = new TextDecoder('utf-8');
      const txt = decoder.decode(buffer);
      // Extraer información entre llaves en formato secuencial
      // Formato: {Nombre}{Descripción}{Precio}{Talle}{Detalle}
      const matches = txt.match(/\{([^}]+)\}/g);
      let nombre = producto.nombre, textoTarjeta = producto.desc, precio = producto.precio, talle = producto.talle || 'M', detalle = '';
      if (matches && matches.length >= 5) {
        nombre = matches[0].replace(/[{}]/g, '').trim();
        textoTarjeta = matches[1].replace(/[{}]/g, '').trim();
        precio = matches[2].replace(/[{}]/g, '').trim();
        talle = matches[3].replace(/[{}]/g, '').trim();
        detalle = matches[4].replace(/[{}]/g, '').trim();
      }
      document.getElementById('mainImage').src = producto.img;
      document.getElementById('mainImage').alt = nombre;
      document.getElementById('nombre-producto').textContent = nombre;
      document.getElementById('precio-producto').textContent = precio ? ('$' + precio + ' ARS') : '';
      
      // Solo mostrar descripción si hay contenido válido
      const descElement = document.querySelector('.descripcion-producto');
      if (textoTarjeta && textoTarjeta !== 'null' && textoTarjeta.trim() !== '') {
        descElement.textContent = textoTarjeta;
        descElement.style.display = 'block';
      } else {
        descElement.style.display = 'none';
      }
      
      // Solo mostrar sección de detalles si hay contenido válido
      const seccionDetalles = document.getElementById('seccion-detalles');
      const detalleContenido = document.getElementById('detalle-contenido');
      if (detalle && detalle !== 'null' && detalle.trim() !== '') {
        detalleContenido.textContent = detalle;
        seccionDetalles.style.display = 'block';
      } else {
        seccionDetalles.style.display = 'none';
      }
      
      const selectTalle = selectTalleGlobal;
      const inputCantidad = inputCantidadGlobal;
      if (selectTalle) {
        configurarCampoTalle(selectTalle, talle, producto);
      }
      if (inputCantidad) {
        inputCantidad.value = 1;
        inputCantidad.disabled = true;
        inputCantidad.style.backgroundColor = '#f8f9fa';
        inputCantidad.style.cursor = 'not-allowed';
      }
      // Consultar stock usando nuevo endpoint
      try {
        const path = decodeURIComponent((producto.img || producto.txt || ''));
        const m = path.match(/\/(\d+)-[^/]+/);
        const id = m && m[1] ? parseInt(m[1], 10) : null;
        if (id) {
          let stockDisponible = 0;
          try {
                const stockResp = await fetch(detalleResolveApiUrl(`/stock-producto/${id}`), { cache: 'no-store' });
            if (stockResp.ok) {
              const stockData = await stockResp.json();
              if (stockData && typeof stockData.stock !== 'undefined') {
                stockDisponible = stockData.stock || 0;
                console.log('📊 Stock obtenido del servidor:', stockDisponible);
                
                // Mostrar stock disponible
                mostrarStockDisponible(stockDisponible);
                
                // Configurar cantidad y botón según stock
                if (inputCantidad) {
                  inputCantidad.max = stockDisponible;
                  console.log('🔢 Stock establecido:', stockDisponible, 'max:', inputCantidad.max);
                  
                  if (stockDisponible > 0) {
                    // HAY STOCK - Habilitar funcionalidad
                    inputCantidad.disabled = false;
                    inputCantidad.style.backgroundColor = '';
                    inputCantidad.style.cursor = '';
                    inputCantidad.value = 1;
                    
                    // Habilitar botón
                    const btn = document.getElementById('btnAgregarCarrito');
                    if (btn) {
                      btn.disabled = false;
                      btn.textContent = 'Agregar al carrito';
                      btn.classList.remove('btn-secondary');
                      btn.classList.add('btn-vino-tinto');
                    }
                    
                    // Agregar validación estricta en el input
                    inputCantidad.addEventListener('input', function() {
                      const valor = parseInt(this.value) || 0;
                      const maxPermitido = parseInt(this.max) || 0;
                      if (valor > maxPermitido && maxPermitido > 0) {
                        this.value = maxPermitido;
                        console.log('⚠️ Cantidad ajustada al máximo permitido:', maxPermitido);
                      }
                    });
                    
                    inputCantidad.addEventListener('change', function() {
                      const valor = parseInt(this.value) || 0;
                      const maxPermitido = parseInt(this.max) || 0;
                      if (valor > maxPermitido && maxPermitido > 0) {
                        this.value = maxPermitido;
                        console.log('⚠️ Cantidad ajustada al máximo permitido:', maxPermitido);
                      }
                      if (valor < 1) {
                        this.value = 1;
                      }
                    });
                  } else {
                    // NO HAY STOCK - Bloquear todo
                    console.log('❌ SIN STOCK - Bloqueando interfaz');
                    inputCantidad.disabled = true;
                    inputCantidad.style.backgroundColor = '#f8f9fa';
                    inputCantidad.style.cursor = 'not-allowed';
                    inputCantidad.value = 0;
                    
                    // Deshabilitar botón
                    const btn = document.getElementById('btnAgregarCarrito');
                    if (btn) {
                      btn.disabled = true;
                      btn.textContent = 'Sin stock';
                      btn.classList.remove('btn-vino-tinto');
                      btn.classList.add('btn-secondary');
                    }
                  }
                  
                  // Revalidar formulario después de actualizar el stock
                  if (typeof window.validarFormularioDetalle === 'function') {
                    console.log('🔄 Revalidando formulario después de cargar stock');
                    window.validarFormularioDetalle();
                  }
                }
              }
            }
          } catch {}
          
          if (stockDisponible === 0) {
            const btn = document.getElementById('btnAgregarCarrito');
            if (btn) {
              btn.disabled = true;
              btn.textContent = 'Sin stock';
              btn.classList.remove('btn-vino-tinto');
              btn.classList.add('btn-secondary');
            }
            // Revalidar formulario cuando no hay stock
            if (typeof window.validarFormularioDetalle === 'function') {
              window.validarFormularioDetalle();
            }
          }
        }
      } catch {}
      // Actualizar la sección de detalles si existe información de detalle
      if (detalle) {
        const detallesList = document.querySelector('.list-unstyled');
        if (detallesList) {
          detallesList.innerHTML = '';
          // Dividir el detalle en líneas y crear elementos de lista
          const lineas = detalle.split('\n');
          lineas.forEach(linea => {
            if (linea.trim()) {
              const li = document.createElement('li');
              li.textContent = linea.trim();
              detallesList.appendChild(li);
            }
          });
        }
      }
    } catch (e) {
      // Si falla el fetch, mostrar lo que haya en localStorage
      document.getElementById('mainImage').src = producto.img;
      document.getElementById('mainImage').alt = producto.nombre;
      document.getElementById('nombre-producto').textContent = producto.nombre;
      document.getElementById('precio-producto').textContent = '$' + producto.precio + ' ARS';
      document.querySelector('.descripcion-producto').textContent = producto.desc;
      // Fallback: marcar sin stock si está en cache
      try {
        const path = decodeURIComponent((producto.img || producto.txt || ''));
        const m = path.match(/\/(\d+)-[^/]+/);
        const id = m && m[1] ? parseInt(m[1], 10) : null;
        if (id && window.localStorage) {
          const agotados = new Set(JSON.parse(localStorage.getItem('agotados') || '[]'));
          if (agotados.has(id)) {
            const btn = document.getElementById('btnAgregarCarrito');
            if (btn) {
              btn.disabled = true;
              btn.textContent = 'Sin stock';
              btn.classList.remove('btn-vino-tinto');
              btn.classList.add('btn-secondary');
            }
          }
        }
      } catch {}
      // Configurar talle y cantidad fijos (fallback)
      const selectTalle = selectTalleGlobal;
      const inputCantidad = inputCantidadGlobal;
      if (selectTalle) {
        configurarCampoTalle(selectTalle, producto?.talle, producto);
      }
      if (inputCantidad) {
        inputCantidad.value = 1;
        inputCantidad.disabled = true;
        inputCantidad.style.backgroundColor = '#f8f9fa';
        inputCantidad.style.cursor = 'not-allowed';
      }
    }
  } else if (producto) {
    // Si no hay txt, usar los datos guardados
    document.getElementById('mainImage').src = producto.img;
    document.getElementById('mainImage').alt = producto.nombre;
    document.getElementById('nombre-producto').textContent = producto.nombre;
    document.getElementById('precio-producto').textContent = '$' + producto.precio + ' ARS';
    document.querySelector('.descripcion-producto').textContent = producto.desc;
    // Configurar talle y cantidad fijos
    const selectTalle = selectTalleGlobal;
    const inputCantidad = inputCantidadGlobal;
    if (selectTalle) {
      configurarCampoTalle(selectTalle, producto?.talle, producto);
    }
    if (inputCantidad) {
      inputCantidad.value = 1;
      inputCantidad.disabled = true;
      inputCantidad.style.backgroundColor = '#f8f9fa';
      inputCantidad.style.cursor = 'not-allowed';
    }
  } else {
    document.getElementById('nombre-producto').textContent = 'Producto no encontrado';
    document.getElementById('precio-producto').textContent = '';
    document.querySelector('.descripcion-producto').textContent = '';
    // Deshabilitar campos cuando no hay producto
    const selectTalle = selectTalleGlobal;
    const inputCantidad = inputCantidadGlobal;
    if (selectTalle) {
      configurarCampoTalle(selectTalle, '', producto);
    }
    if (inputCantidad) {
      inputCantidad.value = 1;
      inputCantidad.disabled = true;
      inputCantidad.style.backgroundColor = '#f8f9fa';
      inputCantidad.style.cursor = 'not-allowed';
    }
  }
});

// Lógica de agregar al carrito desde el detalle

document.addEventListener('DOMContentLoaded', function() {
  // Event listener para botón "Seguir Comprando"
  const seguirComprandoBtn = document.getElementById('seguirComprandoBtn');
  if (seguirComprandoBtn) {
    seguirComprandoBtn.addEventListener('click', function() {
      if (typeof closeCartSidenav === 'function') closeCartSidenav();
      window.location.href = 'index.html';
    });
  }

  const btnAgregar = document.getElementById('btnAgregarCarrito');
  const selectTalle = document.getElementById('size');
  const inputCantidad = document.getElementById('quantity');
  const productForm = document.getElementById('productForm');
  if (btnAgregar && selectTalle && inputCantidad && productForm) {
    // Obtener el producto para usar su talle original
    const productoStr = localStorage.getItem('productoDetalle');
    const producto = productoStr ? JSON.parse(productoStr) : null;
    const metaTalleInicial = obtenerInfoTalleFormulario(producto?.talle, producto);
    const talleOriginal = metaTalleInicial.valor;
    
    selectTalle.value = talleOriginal;
    if (metaTalleInicial.opcional) {
      selectTalle.dataset.optional = 'true';
      selectTalle.required = false;
    }
    inputCantidad.value = 1;
    btnAgregar.disabled = false;
    btnAgregar.classList.remove('btn-secondary');
    btnAgregar.classList.add('btn-vino-tinto');
    
    function validarFormulario() {
      const talleOpcional = selectTalle.dataset.optional === 'true';
      const talleValido = talleOpcional || selectTalle.value !== "";
      const cantidadInput = parseInt(inputCantidad.value) || 0;
      const maxStock = parseInt(inputCantidad.max) || 999; // Valor por defecto alto si no hay max establecido
      const cantidadValida = cantidadInput > 0 && cantidadInput <= maxStock;
      
      console.log('🔍 Validando formulario:', {
        talle: selectTalle.value,
        talleValido,
        cantidad: cantidadInput,
        maxStock,
        cantidadValida,
        inputMax: inputCantidad.max
      });
      
      // Mostrar mensaje si excede el stock y forzar corrección
      if (cantidadInput > maxStock && maxStock < 999 && maxStock > 0) {
        console.log('⚠️ Cantidad excede stock. Cantidad:', cantidadInput, 'Stock:', maxStock);
        inputCantidad.value = maxStock;
        cantidadInput = maxStock; // Actualizar la variable local
      }
      
      // Validación más estricta - Si stock es 0, siempre deshabilitar
      const stockValido = maxStock < 999 ? (maxStock > 0 && cantidadInput <= maxStock) : true;
      
      // Verificación especial para stock cero
      if (maxStock === 0) {
        btnAgregar.disabled = true;
        btnAgregar.textContent = 'Sin stock';
        btnAgregar.classList.remove('btn-vino-tinto');
        btnAgregar.classList.add('btn-secondary');
        console.log('❌ Botón deshabilitado - SIN STOCK');
        return;
      }
      
      if (talleValido && cantidadValida && stockValido) {
        btnAgregar.disabled = false;
        btnAgregar.textContent = 'Agregar al carrito';
        btnAgregar.classList.remove('btn-secondary');
        btnAgregar.classList.add('btn-vino-tinto');
        console.log('✅ Botón habilitado - Stock:', maxStock);
      } else {
        btnAgregar.disabled = true;
        btnAgregar.classList.remove('btn-vino-tinto');
        btnAgregar.classList.add('btn-secondary');
        console.log('❌ Botón deshabilitado - stockValido:', stockValido, 'maxStock:', maxStock, 'cantidad:', cantidadInput);
      }
    }
    
    // Hacer la función disponible globalmente para llamarla después de cargar el stock
    window.validarFormularioDetalle = validarFormulario;
    selectTalle.addEventListener('change', validarFormulario);
    inputCantidad.addEventListener('input', validarFormulario);
    validarFormulario();
    productForm.addEventListener("submit", async function(e) {
      e.preventDefault();
      const productoStr = localStorage.getItem('productoDetalle');
      const producto = productoStr ? JSON.parse(productoStr) : null;
      const talleOpcional = selectTalle.dataset.optional === 'true';
      const sizeValue = selectTalle.value || '';
      const size = talleOpcional ? (sizeValue || 'UNICO') : sizeValue;
      const sizeLabel = talleOpcional ? 'Único' : size;
      const quantity = parseInt(inputCantidad.value);
      const maxStock = parseInt(inputCantidad.max) || 0;
      
      if (!producto || (!size && !talleOpcional) || !quantity || quantity < 1) {
        console.log('❌ Datos incompletos del formulario');
        return;
      }
      
      // Validación estricta de stock antes de proceder
      if (maxStock > 0 && quantity > maxStock) {
        mostrarPopup(`Solo hay ${maxStock} unidades disponibles. Ajustando cantidad.`, 'warning');
        inputCantidad.value = maxStock;
        console.log('❌ Cantidad excede stock máximo');
        return;
      }
      
      console.log('🔍 Validando envío - Cantidad:', quantity, 'Stock máximo:', maxStock);
      
      let id = producto.id_articulo;
      if (!id && producto.img) {
        const m = decodeURIComponent(producto.img).match(/\/(\d+)-[^/]+/);
        if (m && m[1]) id = parseInt(m[1], 10);
      }
      
      if (!id) {
        mostrarPopup('No se pudo determinar el ID del producto.', 'error');
        return;
      }
      
      // Validación CRÍTICA de stock antes de agregar al carrito
      console.log('🔍 VALIDACIÓN CRÍTICA - Verificando stock antes de agregar...');
      
      // NUEVO: Verificar cuántas unidades ya hay en el carrito
      let cantidadEnCarrito = 0;
      try {
        // Usar la misma lógica que agregarAlCarrito - buscar por nombre e img
        const nombreCompleto = `${producto.nombre} (Talle: ${sizeLabel})`;
        const cartRaw = localStorage.getItem("carrito");
        const cartItems = cartRaw ? JSON.parse(cartRaw) : [];
        
        // Buscar exactamente como lo hace agregarAlCarrito: por nombre e img
        const productoEnCarrito = cartItems.find(item => 
          item.nombre === nombreCompleto && item.img === producto.img
        );
        
        if (productoEnCarrito) {
          cantidadEnCarrito = productoEnCarrito.cantidad || 0;
          console.log('🛒 Cantidad ya en carrito (CORREGIDA):', cantidadEnCarrito);
        }
      } catch (error) {
        console.warn('Error verificando carrito:', error);
        cantidadEnCarrito = 0;
      }
      
      try {
        const stockResp = await fetch(detalleResolveApiUrl(`/stock-producto/${id}`), { cache: 'no-store' });
        
        if (stockResp.ok) {
          const stockData = await stockResp.json();
          
          // Validar que la respuesta tenga los datos necesarios
          if (stockData && typeof stockData.stock !== 'undefined') {
            const stockActual = stockData.stock || 0;
            const stockDisponible = stockActual - cantidadEnCarrito;
            console.log('📊 Stock total:', stockActual, 'En carrito:', cantidadEnCarrito, 'Disponible:', stockDisponible, 'Solicitando:', quantity);
            
            if (stockActual === 0) {
              console.log('❌ CRÍTICO: Sin stock disponible - Recargando página');
              mostrarPopup('El producto ya no se encuentra en stock. La página se actualizará.', 'warning');
              location.reload();
              return;
            }
            
            if (stockDisponible <= 0) {
              console.log('❌ CRÍTICO: Ya tienes todo el stock disponible en el carrito');
              mostrarPopup(`Ya tienes todo el stock disponible (${stockActual}) de este producto en tu carrito.`, 'info');
              return;
            }
            
            if (quantity > stockDisponible) {
              console.log('❌ CRÍTICO: Cantidad solicitada excede stock disponible');
              mostrarPopup(`Solo puedes agregar ${stockDisponible} unidades más de este producto. Ya tienes ${cantidadEnCarrito} en tu carrito.`, 'warning');
              return;
            }
            
            console.log('✅ Validación de stock exitosa - Procediendo a agregar al carrito');
          } else {
            console.error('❌ Respuesta del servidor inválida:', stockData);
            alert('Error al verificar stock. Por favor, recarga la página.');
            location.reload();
            return;
          }
        } else {
          console.log('❌ Error al consultar stock del servidor');
          alert('Error de conexión al verificar stock. Por favor, recarga la página.');
          location.reload();
          return;
        }
      } catch (error) {
        console.error('❌ Error crítico verificando stock:', error);
        alert('Error al verificar stock. Por favor, recarga la página.');
        location.reload();
        return;
      }
      
      // SI LLEGAMOS AQUÍ, TODAS LAS VALIDACIONES PASARON EXITOSAMENTE
      console.log('✅ TODAS LAS VALIDACIONES PASARON - Agregando al carrito');
      
      // VALIDACIÓN FINAL: Verificar una última vez el stock justo antes de agregar
      console.log('🔍 VALIDACIÓN FINAL - Última verificación de stock...');
      try {
        const stockFinalResp = await fetch(detalleResolveApiUrl(`/stock-producto/${id}`), { cache: 'no-store' });
        
        if (stockFinalResp.ok) {
          const stockFinalData = await stockFinalResp.json();
          
          if (stockFinalData && typeof stockFinalData.stock !== 'undefined') {
            const stockFinalActual = stockFinalData.stock || 0;
            
            // VALIDACIÓN FINAL CON CARRITO EN TIEMPO REAL
            let cantidadFinalEnCarrito = 0;
            try {
              const nombreCompleto = `${producto.nombre} (Talle: ${sizeLabel})`;
              const cartRaw = localStorage.getItem("carrito");
              const cartItems = cartRaw ? JSON.parse(cartRaw) : [];
              
              // Buscar exactamente como lo hace agregarAlCarrito: por nombre e img
              const productoFinalEnCarrito = cartItems.find(item => 
                item.nombre === nombreCompleto && item.img === producto.img
              );
              
              if (productoFinalEnCarrito) {
                cantidadFinalEnCarrito = productoFinalEnCarrito.cantidad || 0;
                console.log('🛒 VALIDACIÓN FINAL - Cantidad en carrito (CORREGIDA):', cantidadFinalEnCarrito);
              }
            } catch (error) {
              console.warn('Error verificando carrito en validación final:', error);
              cantidadFinalEnCarrito = 0;
            }
            
            const stockFinalDisponible = stockFinalActual - cantidadFinalEnCarrito;
            console.log('📊 VALIDACIÓN FINAL - Stock actual:', stockFinalActual, 'En carrito:', cantidadFinalEnCarrito, 'Disponible:', stockFinalDisponible, 'Solicitando:', quantity);
            
            if (stockFinalActual === 0) {
              console.log('❌ VALIDACIÓN FINAL FALLÓ: Sin stock');
              alert('El producto se agotó mientras procesabas la compra. La página se actualizará.');
              location.reload();
              return;
            }
            
            if (stockFinalDisponible <= 0) {
              console.log('❌ VALIDACIÓN FINAL FALLÓ: Todo el stock ya está en carrito');
              alert('Ya no hay stock disponible para agregar. Otro usuario pudo haber tomado las últimas unidades.');
              location.reload();
              return;
            }
            
            if (quantity > stockFinalDisponible) {
              console.log('❌ VALIDACIÓN FINAL FALLÓ: Cantidad excede stock disponible');
              alert(`Solo quedan ${stockFinalDisponible} unidades disponibles. La página se actualizará para mostrar el stock correcto.`);
              location.reload();
              return;
            }
            
            console.log('✅ VALIDACIÓN FINAL EXITOSA - Procediendo a agregar al carrito');
            
          } else {
            console.log('❌ VALIDACIÓN FINAL: Error en respuesta del servidor');
            alert('Error al verificar stock final. La página se actualizará.');
            location.reload();
            return;
          }
        } else {
          console.log('❌ VALIDACIÓN FINAL: Error de conexión');
          alert('Error de conexión al verificar stock final. La página se actualizará.');
          location.reload();
          return;
        }
      } catch (error) {
        console.error('❌ Error en validación final de stock:', error);
        alert('Error crítico al verificar stock. La página se actualizará.');
        location.reload();
        return;
      }
      
      // Lógica para agregar al carrito (usa función global)
      if (typeof agregarAlCarrito === 'function') {
        agregarAlCarrito(
          `${producto.nombre} (Talle: ${sizeLabel})`,
          Number(producto.precio),
          producto.img,
          quantity,
          producto
        );
        if (typeof mostrarPopup === 'function') {
          mostrarPopup(`Producto agregado al carrito: ${producto.nombre} (Talle: ${sizeLabel}) x${quantity}`);
        }
        console.log('✅ Producto agregado exitosamente al carrito');
      } else {
        console.error('❌ Función agregarAlCarrito no disponible');
        alert('Error: No se pudo agregar el producto al carrito.');
        return;
      }
      
      // Resetear formulario solo si se agregó exitosamente
      productForm.reset();
      // Mantener el talle original del producto (no forzar "M")
      configurarCampoTalle(selectTalle, producto?.talle, producto);
      inputCantidad.value = 1;
      btnAgregar.disabled = false;
      btnAgregar.classList.remove('btn-secondary');
      btnAgregar.classList.add('btn-vino-tinto');
      validarFormulario();
    });
  }
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

// Función para mostrar el stock disponible
function mostrarStockDisponible(stock) {
  // Buscar si ya existe el elemento de stock
  let stockElement = document.getElementById('stock-disponible');
  
  if (!stockElement) {
    // Crear elemento de stock si no existe
    stockElement = document.createElement('div');
    stockElement.id = 'stock-disponible';
    stockElement.className = 'mt-3 mb-2';
    
    // Insertarlo después del botón "Agregar al carrito"
    const botonAgregar = document.getElementById('btnAgregarCarrito');
    if (botonAgregar && botonAgregar.parentNode) {
      botonAgregar.parentNode.insertBefore(stockElement, botonAgregar.nextSibling);
    } else {
      // Fallback: insertarlo después del precio si no encuentra el botón
      const precioElement = document.getElementById('precio-producto');
      if (precioElement && precioElement.parentNode) {
        precioElement.parentNode.insertBefore(stockElement, precioElement.nextSibling);
      }
    }
  }
  
  // Configurar el contenido y estilo según el stock
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

// Función para mostrar pop-ups elegantes (copia de scripts.js para compatibilidad)
function mostrarPopup(mensaje, tipo = 'success') {
  if (window.mostrarPopup && typeof window.mostrarPopup === 'function' && window.mostrarPopup !== mostrarPopup) {
    window.mostrarPopup(mensaje, tipo);
    return;
  }
  
  let popup = document.getElementById("popup-carrito");
  if (popup) popup.remove();
  
  // Definir colores y iconos según el tipo
  const tipos = {
    success: { 
      bg: 'linear-gradient(135deg, #6b0a0a 0%, #8b1538 100%)', 
      icon: '✓', 
      color: '#fff' 
    },
    error: { 
      bg: 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)', 
      icon: '⚠', 
      color: '#fff' 
    },
    warning: { 
      bg: 'linear-gradient(135deg, #ffc107 0%, #e0a800 100%)', 
      icon: '!', 
      color: '#212529' 
    },
    info: { 
      bg: 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)', 
      icon: 'ℹ', 
      color: '#fff' 
    }
  };
  
  const config = tipos[tipo] || tipos.success;
  
  popup = document.createElement("div");
  popup.id = "popup-carrito";
  popup.style.cssText = `
    position: fixed;
    top: 30px;
    left: 50%;
    transform: translateX(-50%) scale(0.8);
    background: ${config.bg};
    color: ${config.color};
    padding: 20px 28px;
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.15);
    backdrop-filter: blur(10px);
    z-index: 9999;
    font-size: 1rem;
    font-weight: 500;
    opacity: 0;
    transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    border: 1px solid rgba(255,255,255,0.2);
    max-width: 350px;
    min-width: 280px;
  `;
  
  // Crear contenido con icono y mensaje
  popup.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="
        font-size: 1.4rem; 
        font-weight: bold; 
        background: rgba(255,255,255,0.2); 
        width: 32px; 
        height: 32px; 
        border-radius: 50%; 
        display: flex; 
        align-items: center; 
        justify-content: center;
        flex-shrink: 0;
      ">${config.icon}</div>
      <div style="flex: 1; line-height: 1.4;">${mensaje}</div>
    </div>
  `;
  
  document.body.appendChild(popup);
  
  // Animar aparición con rebote elegante
  requestAnimationFrame(() => {
    popup.style.opacity = '1';
    popup.style.transform = 'translateX(-50%) scale(1)';
  });
  
  // Animar desaparición
  setTimeout(() => {
    popup.style.opacity = '0';
    popup.style.transform = 'translateX(-50%) scale(0.9)';
    setTimeout(() => popup.remove(), 500);
  }, 3500);
}

window.mostrarPopup = mostrarPopup;
