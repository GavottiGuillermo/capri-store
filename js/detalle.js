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
      
      // Validación más estricta - Si stock es 0, siempre deshabilitar
      const stockValido = maxStock < 999 ? (maxStock > 0 && cantidadInput <= maxStock) : true;
      
      // Verificación especial para stock cero
      if (maxStock === 0) {
        btnAgregar.disabled = true;
        btnAgregar.textContent = 'Sin stock';
        btnAgregar.classList.remove('bg-vino-tinto', 'hover:bg-rosado');
        btnAgregar.classList.add('btn-secondary');
        console.log('❌ Botón deshabilitado - SIN STOCK');
        return;
      }
      
      if (talleValido && cantidadValida && stockValido) {
        btnAgregar.disabled = false;
        btnAgregar.textContent = 'Agregar al carrito';
        btnAgregar.classList.remove('bg-rosado', 'opacity-50', 'btn-secondary');
        btnAgregar.classList.add('bg-vino-tinto', 'hover:bg-rosado');
        console.log('✅ Botón habilitado - Stock:', maxStock);
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
      
      // Validación CRÍTICA de stock antes de agregar al carrito
      console.log('🔍 VALIDACIÓN CRÍTICA - Verificando stock antes de agregar...');
      
      // NUEVO: Verificar cuántas unidades ya hay en el carrito
      let cantidadEnCarrito = 0;
      try {
        const cartItems = JSON.parse(localStorage.getItem('cartItems')) || [];
        const productoEnCarrito = cartItems.find(item => {
          // Buscar el mismo producto con el mismo talle
          return item.nombre && item.nombre.includes(producto.nombre) && item.nombre.includes(`(Talle: ${size})`);
        });
        
        if (productoEnCarrito) {
          cantidadEnCarrito = productoEnCarrito.cantidad || 0;
          console.log('🛒 Cantidad ya en carrito:', cantidadEnCarrito);
        }
      } catch (error) {
        console.warn('Error verificando carrito:', error);
        cantidadEnCarrito = 0;
      }
      
      try {
        const API_BASE = (window.location.hostname.includes('capristorezte.com.ar'))
          ? 'https://capri-store.onrender.com'
          : '';
          
        const stockResp = await fetch(`${API_BASE}/stock-producto/${id}`, { cache: 'no-store' });
        
        if (stockResp.ok) {
          const stockData = await stockResp.json();
          
          if (stockData.ok) {
            const stockActual = stockData.stock || 0;
            const stockDisponible = stockActual - cantidadEnCarrito;
            console.log('📊 Stock total:', stockActual, 'En carrito:', cantidadEnCarrito, 'Disponible:', stockDisponible, 'Solicitando:', quantity);
            
            if (stockActual === 0) {
              console.log('❌ CRÍTICO: Sin stock disponible - Recargando página');
              alert('El producto ya no se encuentra en stock. La página se actualizará.');
              location.reload();
              return;
            }
            
            if (stockDisponible <= 0) {
              console.log('❌ CRÍTICO: Ya tienes todo el stock disponible en el carrito');
              alert(`Ya tienes todo el stock disponible (${stockActual}) de este producto en tu carrito.`);
              return;
            }
            
            if (quantity > stockDisponible) {
              console.log('❌ CRÍTICO: Cantidad solicitada excede stock disponible');
              alert(`Solo puedes agregar ${stockDisponible} unidades más de este producto. Ya tienes ${cantidadEnCarrito} en tu carrito.`);
              return;
            }
            
            console.log('✅ Validación de stock exitosa - Procediendo a agregar al carrito');
          } else {
            console.log('❌ Error en respuesta del servidor de stock');
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
        const API_BASE = (window.location.hostname.includes('capristorezte.com.ar'))
          ? 'https://capri-store.onrender.com'
          : '';
          
        const stockFinalResp = await fetch(`${API_BASE}/stock-producto/${id}`, { cache: 'no-store' });
        
        if (stockFinalResp.ok) {
          const stockFinalData = await stockFinalResp.json();
          
          if (stockFinalData.ok) {
            const stockFinalActual = stockFinalData.stock || 0;
            
            // RECALCULAR cantidad en carrito para la validación final
            let cantidadFinalEnCarrito = 0;
            try {
              const cartItemsFinal = JSON.parse(localStorage.getItem('cartItems')) || [];
              const productoFinalEnCarrito = cartItemsFinal.find(item => {
                return item.nombre && item.nombre.includes(producto.nombre) && item.nombre.includes(`(Talle: ${size})`);
              });
              
              if (productoFinalEnCarrito) {
                cantidadFinalEnCarrito = productoFinalEnCarrito.cantidad || 0;
                console.log('🛒 VALIDACIÓN FINAL - Cantidad recalculada en carrito:', cantidadFinalEnCarrito);
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
          `${producto.nombre} (Talle: ${size})`,
          Number(producto.precio),
          producto.img,
          quantity,
          producto
        );
        if (typeof mostrarPopup === 'function') {
          mostrarPopup(`Producto agregado al carrito: ${producto.nombre} (Talle: ${size}) x${quantity}`);
        }
        console.log('✅ Producto agregado exitosamente al carrito');
      } else {
        console.error('❌ Función agregarAlCarrito no disponible');
        alert('Error: No se pudo agregar el producto al carrito.');
        return;
      }
      
      // Resetear formulario solo si se agregó exitosamente
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
