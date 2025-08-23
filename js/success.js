// js/success.js - Lógica para la página de éxito de compra
// Cumple con CSP (Content Security Policy) de MercadoPago

console.log('🚀 === SUCCESS.JS INICIANDO ===');
console.log('📅 Timestamp:', new Date().toISOString());
console.log('🌐 URL actual:', window.location.href);
console.log('📋 Parámetros URL:', window.location.search);

// Test inmediato (sin esperar DOM)
console.log('🧪 TEST INMEDIATO - Archivo success.js cargado');

// Test de parámetros URL
const urlParams = new URLSearchParams(window.location.search);
const paymentId = urlParams.get('payment_id') || urlParams.get('paymentId');
console.log('💳 Payment ID detectado en URL:', paymentId);

// Ejecutar inmediatamente (sin esperar DOMContentLoaded)
console.log('🏃‍♂️ EJECUTANDO INMEDIATAMENTE - Sin esperar DOM');
try {
    // Buscar número de pedido inmediatamente si tenemos payment_id
    if (paymentId) {
        console.log('🔍 Payment ID encontrado, consultando inmediatamente:', paymentId);
        consultarNumeroPedido(paymentId);
    } else {
        console.log('❌ No se encontró payment_id en la URL');
        console.log('📋 Parámetros disponibles:', Array.from(urlParams.entries()));
    }
} catch (error) {
    console.error('❌ Error en ejecución inmediata:', error);
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('🎉 Success.js cargado - Página de éxito iniciada');
    console.log('🔍 DOM Content Loaded ejecutado');
    
    try {
        // Inicializar funciones principales
        console.log('📋 Iniciando mostrarDatosCompra...');
        mostrarDatosCompra();
        
        console.log('🔍 Iniciando consultarYMostrarNumeroPedido...');
        consultarYMostrarNumeroPedido();
        
        console.log('⚙️ Iniciando configurarEventos...');
        configurarEventos();
        
        // Configurar evento del botón del carrito
        const cartButton = document.getElementById('cart-button');
        if (cartButton && typeof toggleSidebar === 'function') {
            cartButton.addEventListener('click', toggleSidebar);
        }
        
        console.log('✅ Todas las funciones inicializadas correctamente');
    } catch (error) {
        console.error('❌ Error en la inicialización:', error);
    }
});

// Función simplificada para consultar número de pedido
function consultarNumeroPedido(paymentId) {
    console.log('🔍 === CONSULTAR NUMERO PEDIDO ===');
    console.log('💳 PaymentId:', paymentId);
    
    const apiUrl = `https://capri-store.onrender.com/numero-pedido/${paymentId}`;
    console.log('🌐 URL de consulta:', apiUrl);
    
    fetch(apiUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        console.log('📡 Respuesta del servidor recibida');
        console.log('📊 Status:', response.status);
        console.log('✅ Ok:', response.ok);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return response.json();
    })
    .then(data => {
        console.log('📦 Datos recibidos del servidor:', data);
        
        if (data.existe) {
            console.log('✅ Pedido encontrado!');
            console.log('🔢 Número display:', data.numero_display);
            mostrarNumeroPedido(data.numero_display, data.id_pedido_completo);
        } else {
            console.log('❌ Pedido no encontrado');
            setTimeout(() => consultarNumeroPedido(paymentId), 2000);
        }
    })
    .catch(error => {
        console.error('❌ Error en consulta:', error);
        // Reintentar después de 3 segundos
        setTimeout(() => consultarNumeroPedido(paymentId), 3000);
    });
}

// Función para mostrar el número de pedido en la página
function mostrarNumeroPedido(numeroDisplay, idCompleto) {
    console.log('🎯 === MOSTRAR NUMERO PEDIDO ===');
    console.log('🔢 Numero display:', numeroDisplay);
    console.log('🆔 ID completo:', idCompleto);
    
    // Ocultar mensaje de procesamiento
    const procesandoDiv = document.getElementById('procesando-pedido');
    if (procesandoDiv) {
        procesandoDiv.classList.add('d-none');
        console.log('✅ Mensaje de procesamiento ocultado');
    }
    
    // Mostrar confirmación
    const confirmadoDiv = document.getElementById('pedido-confirmado');
    if (confirmadoDiv) {
        confirmadoDiv.classList.remove('d-none');
        console.log('✅ Mensaje de confirmación mostrado');
    }
    
    // Mostrar número de pedido
    const numeroPedidoDiv = document.getElementById('numero-pedido');
    if (numeroPedidoDiv) {
        numeroPedidoDiv.innerHTML = `
            <div class="mt-3 p-3 bg-light rounded">
                <h6 class="mb-2 capri-color">Tu número de pedido es:</h6>
                <h4 class="capri-color fw-bold">${numeroDisplay}</h4>
                <small class="text-muted">ID: ${idCompleto}</small>
            </div>
        `;
        console.log('✅ Número de pedido insertado en DOM');
    } else {
        console.error('❌ Elemento numero-pedido no encontrado');
    }
}

// Función principal para mostrar datos de la compra
function mostrarDatosCompra() {
    console.log('📋 mostrarDatosCompra() ejecutada');
}

// Función principal para consultar número de pedido
function consultarYMostrarNumeroPedido() {
    console.log('🔍 consultarYMostrarNumeroPedido() iniciada');
    
    try {
        // Obtener payment_id de la URL
        const urlParams = new URLSearchParams(window.location.search);
        const paymentId = urlParams.get('payment_id') || urlParams.get('paymentId');
        
        console.log('💳 Payment ID desde URL:', paymentId);
        console.log('📋 Todos los parámetros:', Object.fromEntries(urlParams));
        
        if (paymentId) {
            console.log('✅ Payment ID encontrado, consultando...');
            consultarNumeroPedido(paymentId);
        } else {
            console.error('❌ No se encontró payment_id en la URL');
            // Mostrar error al usuario
            mostrarError('No se pudo obtener la información del pago. Por favor contacte soporte.');
        }
    } catch (error) {
        console.error('❌ Error en consultarYMostrarNumeroPedido:', error);
        mostrarError('Error al procesar la información del pago.');
    }
}

// Función para configurar eventos
function configurarEventos() {
    console.log('⚙️ configurarEventos() ejecutada');
}

// Función para mostrar errores
function mostrarError(mensaje) {
    console.log('❌ Mostrando error:', mensaje);
    
    // Ocultar mensaje de procesamiento
    const procesandoDiv = document.getElementById('procesando-pedido');
    if (procesandoDiv) {
        procesandoDiv.classList.add('d-none');
    }
    
    // Mostrar error
    const confirmadoDiv = document.getElementById('pedido-confirmado');
    if (confirmadoDiv) {
        confirmadoDiv.className = 'alert alert-warning';
        confirmadoDiv.innerHTML = `
            <h5 class="alert-heading">
                <i class="fas fa-exclamation-triangle me-2"></i>Atención
            </h5>
            <p class="mb-0">${mensaje}</p>
        `;
        confirmadoDiv.classList.remove('d-none');
    }
}
