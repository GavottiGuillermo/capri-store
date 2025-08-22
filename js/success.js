// js/success.js - Lógica para la página de éxito de compra
// Cumple con CSP (Content Security Policy) de MercadoPago

document.addEventListener('DOMContentLoaded', function() {
    console.log('🎉 Success.js cargado - Página de éxito iniciada');
    
    // Inicializar funciones principales
    mostrarDatosCompra();
    consultarYMostrarNumeroPedido();
    configurarEventos();
    
    // Configurar evento del botón del carrito
    const cartButton = document.getElementById('cart-button');
    if (cartButton && typeof toggleSidebar === 'function') {
        cartButton.addEventListener('click', toggleSidebar);
    }
});

// Función principal para mostrar datos de la compra
function mostrarDatosCompra() {
    try {
        console.log('📋 Cargando datos de compra desde localStorage...');
        
        const datosCompra = JSON.parse(localStorage.getItem('datosCompra') || 'null');
        const productosCompra = JSON.parse(localStorage.getItem('productosCompra') || '[]');
        const totalCompra = localStorage.getItem('totalCompra') || '0';
        const costoEnvio = localStorage.getItem('costoEnvio') || '0';
        
        console.log('💾 Datos recuperados:', {
            datosCompra,
            productosCompra: productosCompra.length,
            totalCompra,
            costoEnvio
        });
        
        // Mostrar información del cliente
        mostrarInfoCliente(datosCompra);
        
        // Mostrar productos comprados
        mostrarProductosComprados(productosCompra, totalCompra, costoEnvio);
        
        // Mostrar información de entrega
        mostrarInfoEntrega(datosCompra);
        
    } catch (error) {
        console.error('❌ Error cargando datos de compra:', error);
        mostrarErrorDatos();
    }
}

// Función para mostrar información del cliente
function mostrarInfoCliente(datosCompra) {
    if (!datosCompra) return;
    
    const infoClienteDiv = document.getElementById('info-cliente');
    if (!infoClienteDiv) return;
    
    infoClienteDiv.innerHTML = `
        <h5 class="text-vino-tinto mb-3">
            <i class="fas fa-user mr-2"></i>Información del Cliente
        </h5>
        <div class="row">
            <div class="col-md-6">
                <p><strong>Nombre:</strong> ${datosCompra.nombre || 'N/A'} ${datosCompra.apellido || ''}</p>
                <p><strong>Email:</strong> ${datosCompra.email || 'N/A'}</p>
            </div>
            <div class="col-md-6">
                <p><strong>Teléfono:</strong> ${datosCompra.telefono || 'N/A'}</p>
                <p><strong>Tipo de entrega:</strong> ${datosCompra.tipoEntrega === 'envio' ? 'Envío a domicilio' : 'Retiro en local'}</p>
            </div>
        </div>
    `;
}

// Función para mostrar productos comprados
function mostrarProductosComprados(productos, total, costoEnvio) {
    const productosDiv = document.getElementById('productos-comprados');
    if (!productosDiv || !Array.isArray(productos) || productos.length === 0) {
        return;
    }
    
    const subtotal = parseFloat(total) - parseFloat(costoEnvio);
    
    let productosHtml = `
        <h5 class="text-vino-tinto mb-3">
            <i class="fas fa-shopping-bag mr-2"></i>Productos Comprados
        </h5>
        <div class="table-responsive">
            <table class="table table-striped">
                <thead class="bg-vino-tinto text-white">
                    <tr>
                        <th>Producto</th>
                        <th class="text-center">Cantidad</th>
                        <th class="text-right">Precio Unit.</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    productos.forEach(producto => {
        const precio = parseFloat(producto.precio) || 0;
        const cantidad = parseInt(producto.cantidad) || 0;
        const totalProducto = precio * cantidad;
        
        productosHtml += `
            <tr>
                <td>
                    <strong>${producto.nombre}</strong>
                    ${producto.talle ? `<br><small class="text-muted">Talle: ${producto.talle}</small>` : ''}
                </td>
                <td class="text-center">${cantidad}</td>
                <td class="text-right">$${precio.toFixed(2)}</td>
                <td class="text-right font-weight-bold">$${totalProducto.toFixed(2)}</td>
            </tr>
        `;
    });
    
    // Totales
    productosHtml += `
                </tbody>
                <tfoot class="bg-light">
                    <tr>
                        <th colspan="3" class="text-right">Subtotal:</th>
                        <th class="text-right">$${subtotal.toFixed(2)}</th>
                    </tr>
    `;
    
    if (parseFloat(costoEnvio) > 0) {
        productosHtml += `
                    <tr>
                        <th colspan="3" class="text-right">Envío:</th>
                        <th class="text-right">$${parseFloat(costoEnvio).toFixed(2)}</th>
                    </tr>
        `;
    }
    
    productosHtml += `
                    <tr class="bg-vino-tinto text-white">
                        <th colspan="3" class="text-right">Total Final:</th>
                        <th class="text-right">$${parseFloat(total).toFixed(2)}</th>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
    
    productosDiv.innerHTML = productosHtml;
}

// Función para mostrar información de entrega
function mostrarInfoEntrega(datosCompra) {
    if (!datosCompra) return;
    
    const bloqueEnvio = document.getElementById('bloque-envio');
    if (!bloqueEnvio) return;
    
    // Solo mostrar si es envío a domicilio
    if (datosCompra.tipoEntrega === 'envio' && datosCompra.direccion) {
        bloqueEnvio.style.display = 'block';
        bloqueEnvio.innerHTML = `
            <h5 class="text-vino-tinto mb-3">
                <i class="fas fa-truck mr-2"></i>Información de Envío
            </h5>
            <p><strong>Dirección de entrega:</strong><br>
               ${datosCompra.direccion}
            </p>
            <div class="alert alert-info">
                <i class="fas fa-info-circle mr-2"></i>
                <strong>Importante:</strong> Nos pondremos en contacto contigo para coordinar la entrega y confirmar el costo final del envío.
            </div>
        `;
    } else {
        bloqueEnvio.style.display = 'none';
    }
}

// Función principal para consultar y mostrar el número de pedido
async function consultarYMostrarNumeroPedido() {
    console.log('🔍 === INICIANDO CONSULTA DE NÚMERO DE PEDIDO ===');
    
    const numeroPedidoDiv = document.getElementById('numero-pedido');
    if (!numeroPedidoDiv) {
        console.error('❌ No se encontró el elemento #numero-pedido');
        return;
    }
    
    // Obtener payment ID de la URL
    const urlParams = new URLSearchParams(window.location.search);
    const paymentId = urlParams.get('payment_id') || urlParams.get('paymentId');
    
    if (!paymentId) {
        console.error('❌ No se encontró payment_id en la URL');
        mostrarErrorPaymentId(numeroPedidoDiv);
        return;
    }
    
    console.log(`💳 Payment ID encontrado: ${paymentId}`);
    
    // Iniciar consulta específica
    await consultarNumeroPedidoReal(paymentId, numeroPedidoDiv);
}

// Función específica para consultar el número de pedido por payment ID
async function consultarNumeroPedidoReal(paymentId, numeroPedidoDiv, intento = 1) {
    if (!paymentId || !numeroPedidoDiv) {
        console.error('❌ Faltan parámetros obligatorios');
        return;
    }
    
    console.log(`🔍 === CONSULTA ESPECÍFICA DE PEDIDO (Intento ${intento}) ===`);
    console.log(`Payment ID: ${paymentId}`);
    
    try {
        // Mostrar loading
        numeroPedidoDiv.innerHTML = `
            <div class="text-center p-4">
                <div class="spinner-border text-primary" role="status">
                    <span class="sr-only">Cargando...</span>
                </div>
                <p class="mt-2 text-muted">Consultando número de pedido...</p>
            </div>`;
        
        // Determinar URL del API
        const API_BASE = (window.location.hostname.includes('capristorezte.com.ar'))
            ? 'https://capri-store.onrender.com'
            : '';
        
        console.log(`🔗 API Base: ${API_BASE}`);
        
        // CONSULTA ÚNICA Y ESPECÍFICA por payment ID
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 segundos timeout
        
        const consultaUrl = `${API_BASE}/numero-pedido/${paymentId}`;
        console.log(`📡 Consultando URL ESPECÍFICA: ${consultaUrl}`);
        
        const response = await fetch(consultaUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        console.log(`📥 Response: ${response.status} ${response.ok ? 'OK' : 'ERROR'}`);
        
        if (response.ok) {
            const resultado = await response.json();
            console.log(`📋 Resultado:`, resultado);
            
            if (resultado.existe) {
                console.log(`✅ PEDIDO ENCONTRADO: ${resultado.id_pedido_completo} -> ${resultado.numero_display}`);
                mostrarNumeroPedidoEnPantalla(resultado.numero_display, numeroPedidoDiv, resultado.id_pedido_completo);
                return; // ✅ Encontrado y mostrado
            } else {
                console.log(`❌ PEDIDO NO EXISTE en BD para payment ID: ${paymentId}`);
                
                // Si es el primer intento, reintentar una vez más
                if (intento === 1) {
                    console.log('🔄 Reintentando en 2 segundos...');
                    setTimeout(() => {
                        consultarNumeroPedidoReal(paymentId, numeroPedidoDiv, 2);
                    }, 2000);
                    return;
                }
                
                // Ya no hay más reintentos - mostrar mensaje de error
                console.log(`💡 Explicación: ${resultado.explicacion || 'Pedido no procesado correctamente'}`);
                mostrarPedidoNoEncontrado(numeroPedidoDiv, paymentId);
                return;
            }
        } else {
            const errorText = await response.text();
            console.log(`❌ Error HTTP: ${response.status} - ${errorText}`);
            
            // Si es el primer intento, reintentar una vez más
            if (intento === 1) {
                console.log('🔄 Reintentando en 2 segundos por error HTTP...');
                setTimeout(() => {
                    consultarNumeroPedidoReal(paymentId, numeroPedidoDiv, 2);
                }, 2000);
                return;
            }
            
            // Mostrar error final después de reintentos
            mostrarErrorConexion(numeroPedidoDiv, paymentId, response.status, intento);
            return;
        }
        
    } catch (error) {
        console.error('❌ ERROR CRÍTICO:', error.message);
        
        // Si es el primer intento y es timeout, reintentar
        if (intento === 1 && (error.name === 'AbortError' || error.message.includes('timeout'))) {
            console.log('🔄 Reintentando en 3 segundos por timeout...');
            setTimeout(() => {
                consultarNumeroPedidoReal(paymentId, numeroPedidoDiv, 2);
            }, 3000);
            return;
        }
        
        // Error final
        mostrarErrorSistema(numeroPedidoDiv, error.message);
    }
}

// Función para mostrar el número del pedido en pantalla
function mostrarNumeroPedidoEnPantalla(numeroDisplay, numeroPedidoDiv, numeroCompleto = null) {
    numeroPedidoDiv.innerHTML = `
        <div class="mt-4 mb-4 p-4 border rounded" style="background-color: #f8f9fa; border-color: #6b0a0a !important;">
            <div class="text-center">
                <h4 class="mb-3" style="color:#6b0a0a; font-weight:600;">Tu número de Pedido es:</h4>
                <div class="display-2 fw-bold p-3 rounded" style="color:#6b0a0a; background-color: white; border: 3px solid #6b0a0a; text-shadow: 2px 2px 4px rgba(0,0,0,0.1);">
                    ${numeroDisplay}
                </div>
                <p class="mt-3 mb-0" style="color:#6b0a0a; font-weight:500;">
                    <i class="fas fa-info-circle mr-2"></i>
                    Guarda este número para consultas sobre tu pedido
                </p>
                ${numeroCompleto ? `<small class="text-muted">Número completo: ${numeroCompleto}</small>` : ''}
            </div>
        </div>`;
}

// Funciones para mostrar diferentes tipos de errores
function mostrarErrorPaymentId(numeroPedidoDiv) {
    numeroPedidoDiv.innerHTML = `
        <div class="alert alert-danger text-center">
            <i class="fas fa-exclamation-circle mb-2" style="font-size: 2rem; color: #721c24;"></i>
            <h5 style="color: #721c24;">Error en la URL</h5>
            <p style="color: #721c24;">
                No se encontró el ID de pago en la URL.<br>
                <small>Verifica que llegaste desde MercadoPago correctamente.</small>
            </p>
        </div>
    `;
}

function mostrarPedidoNoEncontrado(numeroPedidoDiv, paymentId) {
    numeroPedidoDiv.innerHTML = `
        <div class="alert alert-warning text-center">
            <i class="fas fa-exclamation-triangle mb-2" style="font-size: 2rem; color: #856404;"></i>
            <h5 style="color: #856404;">Pedido no encontrado</h5>
            <p style="color: #856404;">
                No se encontró información del pedido para este pago.<br>
                <small>Payment ID: ${paymentId}</small>
            </p>
            <p style="color: #856404;">
                <small>Si realizaste el pago correctamente, contacta con soporte.</small>
            </p>
        </div>
    `;
}

function mostrarErrorConexion(numeroPedidoDiv, paymentId, status, intentos) {
    numeroPedidoDiv.innerHTML = `
        <div class="alert alert-danger text-center">
            <i class="fas fa-exclamation-circle mb-2" style="font-size: 2rem; color: #721c24;"></i>
            <h5 style="color: #721c24;">Error de conexión</h5>
            <p style="color: #721c24;">
                No se pudo consultar el estado del pedido después de ${intentos} intentos.<br>
                <small>Payment ID: ${paymentId} | Error ${status}</small>
            </p>
        </div>
    `;
}

function mostrarErrorSistema(numeroPedidoDiv, mensaje) {
    numeroPedidoDiv.innerHTML = `
        <div class="alert alert-danger text-center">
            <i class="fas fa-exclamation-circle mb-2" style="font-size: 2rem; color: #721c24;"></i>
            <h5 style="color: #721c24;">Error del sistema</h5>
            <p style="color: #721c24;">
                Ocurrió un error al consultar el pedido.<br>
                <small>${mensaje}</small>
            </p>
        </div>
    `;
}

function mostrarErrorDatos() {
    const infoClienteDiv = document.getElementById('info-cliente');
    if (infoClienteDiv) {
        infoClienteDiv.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle mr-2"></i>
                No se pudieron cargar los datos de compra.
            </div>
        `;
    }
}

// Configurar eventos adicionales
function configurarEventos() {
    console.log('🔧 Configurando eventos adicionales...');
    
    // Limpiar localStorage después de mostrar los datos (opcional)
    // setTimeout(() => {
    //     console.log('🧹 Limpiando localStorage...');
    //     localStorage.removeItem('carrito');
    //     localStorage.removeItem('datosCompra');
    //     localStorage.removeItem('productosCompra');
    //     localStorage.removeItem('totalCompra');
    //     localStorage.removeItem('costoEnvio');
    // }, 5000);
    
    console.log('✅ Success.js configurado completamente');
}
