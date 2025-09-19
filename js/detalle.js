// detalle.js
// Lógica exclusiva para la ventana de detalle de producto en Capri Store

document.addEventListener('DOMContentLoaded', async function() {
  // Obtener el producto seleccionado desde localStorage
  const productoStr = localStorage.getItem('productoDetalle');
  const producto = productoStr ? JSON.parse(productoStr) : null;
  if (producto && producto.txt) {
    try {
      // Obtener los datos actualizados desde el .txt del producto
      const resp = await fetch(producto.txt);
      const txt = await resp.text();
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
      document.querySelector('.descripcion-producto').textContent = textoTarjeta;
      // Configurar talle y cantidad fijos
      const selectTalle = document.getElementById('size');
      const inputCantidad = document.getElementById('quantity');
      if (selectTalle && talle) {
        selectTalle.value = talle;
        selectTalle.disabled = true;
        selectTalle.style.backgroundColor = '#f8f9fa';
        selectTalle.style.cursor = 'not-allowed';
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
          const API_BASE = (window.location.hostname.includes('capristorezte.com.ar'))
            ? 'https://capri-store.onrender.com'
            : '';
          let stockDisponible = 0;
          try {
            const stockResp = await fetch(`${API_BASE}/stock-producto/${id}`, { cache: 'no-store' });
            if (stockResp.ok) {
              const stockData = await stockResp.json();
              if (stockData.ok) {
                stockDisponible = stockData.stock || 0;
                
                // Mostrar stock disponible
                mostrarStockDisponible(stockDisponible);
                
                // Configurar cantidad máxima
                if (inputCantidad) {
                  inputCantidad.max = stockDisponible;
                  console.log('🔢 Stock establecido:', stockDisponible, 'max:', inputCantidad.max);
                  if (stockDisponible > 0) {
                    inputCantidad.disabled = false;
                    inputCantidad.style.backgroundColor = '';
                    inputCantidad.style.cursor = '';
                    inputCantidad.value = 1;
                    
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
      const selectTalle = document.getElementById('size');
      const inputCantidad = document.getElementById('quantity');
      if (selectTalle) {
        if (producto.talle) {
          selectTalle.value = producto.talle;
        }
        selectTalle.disabled = true;
        selectTalle.style.backgroundColor = '#f8f9fa';
        selectTalle.style.cursor = 'not-allowed';
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
    const selectTalle = document.getElementById('size');
    const inputCantidad = document.getElementById('quantity');
    if (selectTalle) {
      if (producto.talle) {
        selectTalle.value = producto.talle;
      }
      selectTalle.disabled = true;
      selectTalle.style.backgroundColor = '#f8f9fa';
      selectTalle.style.cursor = 'not-allowed';
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
    const selectTalle = document.getElementById('size');
    const inputCantidad = document.getElementById('quantity');
    if (selectTalle) {
      selectTalle.disabled = true;
      selectTalle.style.backgroundColor = '#f8f9fa';
      selectTalle.style.cursor = 'not-allowed';
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
  const btnAgregar = document.getElementById('btnAgregarCarrito');
  const selectTalle = document.getElementById('size');
  const inputCantidad = document.getElementById('quantity');
  const productForm = document.getElementById('productForm');
  if (btnAgregar && selectTalle && inputCantidad && productForm) {
    selectTalle.value = "M";
    inputCantidad.value = 1;
    btnAgregar.disabled = false;
    btnAgregar.classList.remove('bg-rosado', 'opacity-50');
    btnAgregar.classList.add('bg-vino-tinto', 'hover:bg-rosado');
    function validarFormulario() {
      const talleValido = selectTalle.value !== "";
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
      
      // Validación más estricta
      const stockValido = maxStock < 999 ? (maxStock > 0 && cantidadInput <= maxStock) : true;
      
      if (talleValido && cantidadValida && stockValido) {
        btnAgregar.disabled = false;
        btnAgregar.classList.remove('bg-rosado', 'opacity-50');
        btnAgregar.classList.add('bg-vino-tinto', 'hover:bg-rosado');
        console.log('✅ Botón habilitado');
      } else {
        btnAgregar.disabled = true;
        btnAgregar.classList.remove('bg-vino-tinto', 'hover:bg-rosado');
        btnAgregar.classList.add('bg-rosado', 'opacity-50');
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
      const size = selectTalle.value;
      const quantity = parseInt(inputCantidad.value);
      const maxStock = parseInt(inputCantidad.max) || 0;
      
      if (!producto || !size || !quantity || quantity < 1) {
        console.log('❌ Datos incompletos del formulario');
        return;
      }
      
      // Validación estricta de stock antes de proceder
      if (maxStock > 0 && quantity > maxStock) {
        alert(`Solo hay ${maxStock} unidades disponibles. Ajustando cantidad.`);
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
        alert('No se pudo determinar el ID del producto.');
        return;
      }
      
      // Validar stock actualizado antes de agregar
      try {
        const API_BASE = (window.location.hostname.includes('capristorezte.com.ar'))
          ? 'https://capri-store.onrender.com'
          : '';
          
        const stockResp = await fetch(`${API_BASE}/stock-producto/${id}`, { cache: 'no-store' });
        
        if (stockResp.ok) {
          const stockData = await stockResp.json();
          
          if (stockData.ok) {
            const stockActual = stockData.stock || 0;
            
            if (stockActual === 0) {
              alert('El producto ya no se encuentra en stock.');
              location.reload();
              return;
            }
            
            if (quantity > stockActual) {
              alert(`Solo hay ${stockActual} unidades disponibles. Se ajustará la cantidad.`);
              inputCantidad.value = stockActual;
              inputCantidad.max = stockActual;
              mostrarStockDisponible(stockActual);
              return;
            }
          }
        }
      } catch (error) {
        console.warn('Error verificando stock actualizado:', error);
      }
      
      // Lógica para agregar al carrito (usa función global)
      if (typeof agregarAlCarrito === 'function') {
        agregarAlCarrito(
          `${producto.nombre} (Talle: ${size})`,
          Number(producto.precio),
          producto.img,
          quantity,
          producto
        );
        if (typeof mostrarPopup === 'function') {
          mostrarPopup(`Producto agregado al carrito: ${producto.nombre} (Talle: ${size}) x${quantity}`);
        }
      }
      productForm.reset();
      selectTalle.value = "M";
      inputCantidad.value = 1;
      btnAgregar.disabled = false;
      btnAgregar.classList.remove('bg-rosado', 'opacity-50');
      btnAgregar.classList.add('bg-vino-tinto', 'hover:bg-rosado');
      validarFormulario();
    });
  }
});

// Función para mostrar el stock disponible
function mostrarStockDisponible(stock) {
  // Buscar si ya existe el elemento de stock
  let stockElement = document.getElementById('stock-disponible');
  
  if (!stockElement) {
    // Crear elemento de stock si no existe
    stockElement = document.createElement('div');
    stockElement.id = 'stock-disponible';
    stockElement.className = 'mb-3';
    
    // Insertarlo después del precio
    const precioElement = document.getElementById('precio-producto');
    if (precioElement && precioElement.parentNode) {
      precioElement.parentNode.insertBefore(stockElement, precioElement.nextSibling);
    }
  }
  
  // Configurar el contenido y estilo según el stock
  if (stock > 0) {
    stockElement.innerHTML = `
      <div class="d-flex align-items-center">
        <i class="fas fa-check-circle text-success mr-2"></i>
        <span class="text-success font-weight-bold">Stock Disponible: ${stock}</span>
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
