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
      // Marcar sin stock consultando servidor (fallback a cache)
      try {
        const path = decodeURIComponent((producto.img || producto.txt || ''));
        const m = path.match(/\/(\d+)-[^/]+/);
        const id = m && m[1] ? parseInt(m[1], 10) : null;
        if (id) {
          const API_BASE = (window.location.hostname.includes('capristorezte.com.ar'))
            ? 'https://capri-store.onrender.com'
            : '';
          let agotado = false;
          try {
            const respAg = await fetch(`${API_BASE}/stock-agotado`, { cache: 'no-store' });
            if (respAg.ok) {
              const js = await respAg.json();
              agotado = Array.isArray(js.ids) && js.ids.includes(id);
              if (Array.isArray(js.ids)) {
                localStorage.setItem('agotados', JSON.stringify(js.ids));
                localStorage.setItem('agotados_last_sync', String(Date.now()));
              }
            }
          } catch {}
          if (!agotado) {
            const cached = new Set(JSON.parse(localStorage.getItem('agotados') || '[]'));
            agotado = cached.has(id);
          }
          if (agotado) {
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
      const cantidadValida = inputCantidad.value && Number(inputCantidad.value) > 0;
      if (talleValido && cantidadValida) {
        btnAgregar.disabled = false;
        btnAgregar.classList.remove('bg-rosado', 'opacity-50');
        btnAgregar.classList.add('bg-vino-tinto', 'hover:bg-rosado');
      } else {
        btnAgregar.disabled = true;
        btnAgregar.classList.remove('bg-vino-tinto', 'hover:bg-rosado');
        btnAgregar.classList.add('bg-rosado', 'opacity-50');
      }
    }
    selectTalle.addEventListener('change', validarFormulario);
    inputCantidad.addEventListener('input', validarFormulario);
    validarFormulario();
    productForm.addEventListener("submit", async function(e) {
      e.preventDefault();
      const productoStr = localStorage.getItem('productoDetalle');
      const producto = productoStr ? JSON.parse(productoStr) : null;
      const size = selectTalle.value;
      const quantity = parseInt(inputCantidad.value);
      if (!producto || !size || !quantity || quantity < 1) return;
      let id = producto.id_articulo;
      if (!id && producto.img) {
        const m = decodeURIComponent(producto.img).match(/\/(\d+)-[^/]+/);
        if (m && m[1]) id = parseInt(m[1], 10);
      }
      const bodyStock = JSON.stringify({ ids: [id] });
      if (!id) {
        alert('No se pudo determinar el ID del producto.');
        return;
      }
      try {
        const resp = await fetch('https://capri-store.onrender.com/validar-stock-carrito', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStock
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          alert('Error al validar stock. Intenta nuevamente.');
          return;
        }
        if (data.faltantes && data.faltantes.includes(id)) {
          alert('El producto ' + producto.nombre + ' ya no se encuentra en stock.');
          return;
        }
      } catch (err) {
        alert('Error de conexión al validar stock.');
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
