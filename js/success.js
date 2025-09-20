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

// --- LIMPIEZA DE CARRITO INMEDIATA AL ENTRAR A SUCCESS ---
if (paymentId) {
    // Marcar que hubo una compra exitosa
    localStorage.setItem('compraExitosa', 'true');
    localStorage.setItem('compraExitosaTimestamp', Date.now().toString());
    
    if (typeof limpiarCarritoDespuesDeCompra === 'function') {
        limpiarCarritoDespuesDeCompra();
        console.log('✅ Carrito limpiado usando limpiarCarritoDespuesDeCompra() (inicio success)');
    } else {
        // Fallback manual si la función no existe
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('carrito'); // CORREGIDO: usar 'carrito' en lugar de 'cartItems'
            localStorage.removeItem('datosCompra');
            localStorage.removeItem('productosCompra');
            localStorage.removeItem('totalCompra');
            localStorage.removeItem('costoEnvio');
            localStorage.removeItem('productoDetalle'); // Limpiar también el producto de detalle
            console.log('✅ Carrito y datos de compra limpiados (fallback, inicio success)');
            if (typeof updateCartCounterAnimated === 'function') {
                updateCartCounterAnimated(0);
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('🎉 Success.js cargado - Página de éxito iniciada');
    console.log('🔍 DOM Content Loaded ejecutado');
    
    try {
        // Inicializar funciones principales
        console.log('🔍 Iniciando consultarYMostrarNumeroPedido...');
        consultarYMostrarNumeroPedido();
        
        console.log('✅ Funciones inicializadas correctamente');
    } catch (error) {
        console.error('❌ Error en la inicialización:', error);
    }
});

// Variables globales para control de reintentos
let intentosRealizados = 0;
const MAX_INTENTOS = 10; // Máximo 10 intentos (20 segundos)

// Función principal para consultar número de pedido
function consultarYMostrarNumeroPedido() {
    console.log('🔍 === INICIANDO CONSULTA DE NÚMERO DE PEDIDO ===');
    
    try {
        // Reiniciar contador de intentos
        intentosRealizados = 0;
        
        // Obtener payment_id de la URL
        const urlParams = new URLSearchParams(window.location.search);
        const paymentId = urlParams.get('payment_id') || urlParams.get('paymentId');
        
        console.log('💳 Payment ID desde URL:', paymentId);
        
        if (paymentId) {
            console.log('✅ Payment ID encontrado, consultando...');
            consultarNumeroPedido(paymentId);
        } else {
            console.error('❌ No se encontró payment_id en la URL');
            mostrarError('No se pudo obtener la información del pago. Por favor contacte soporte.');
        }
    } catch (error) {
        console.error('❌ Error en consultarYMostrarNumeroPedido:', error);
        mostrarError('Error al procesar la información del pago.');
    }
}

// Función simplificada para consultar número de pedido
function consultarNumeroPedido(paymentId) {
    console.log('🔍 === CONSULTAR NUMERO PEDIDO ===');
    console.log('💳 PaymentId:', paymentId);
    console.log('🔄 Intento:', intentosRealizados + 1, 'de', MAX_INTENTOS);
    
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
        
        if (data.pedido_encontrado) {
            console.log('✅ Pedido encontrado!');
            console.log('🔢 Número display:', data.numero_display);
            mostrarNumeroPedido(data.numero_display, data.numero_pedido);
        } else {
            console.log('❌ Pedido no encontrado...');
            intentosRealizados++;
            
            if (intentosRealizados < MAX_INTENTOS) {
                console.log(`🔄 Reintentando en 2 segundos... (${intentosRealizados}/${MAX_INTENTOS})`);
                setTimeout(() => consultarNumeroPedido(paymentId), 2000);
            } else {
                console.log('❌ Se alcanzó el máximo de intentos. Mostrando error.');
                mostrarError('No se pudo encontrar la información del pedido. El webhook puede estar procesándose. Por favor recargue la página en unos minutos o contacte soporte si persiste el problema.');
            }
        }
    })
    .catch(error => {
        console.error('❌ Error en consulta:', error);
        intentosRealizados++;
        
        if (intentosRealizados < MAX_INTENTOS) {
            console.log(`🔄 Reintentando en 3 segundos por error... (${intentosRealizados}/${MAX_INTENTOS})`);
            setTimeout(() => consultarNumeroPedido(paymentId), 3000);
        } else {
            console.log('❌ Se alcanzó el máximo de intentos por errores.');
            mostrarError('Error de conectividad. Por favor recargue la página o contacte soporte.');
        }
    });
}

// Función CRÍTICA: mostrar el número de pedido y hacer visible el contenedor
function mostrarNumeroPedido(numeroDisplay, idCompleto) {
    console.log('🎯 === MOSTRAR NUMERO PEDIDO ===');
    console.log('🔢 Numero display:', numeroDisplay);
    console.log('🆔 ID completo:', idCompleto);
    
    // PASO 1: Ocultar mensaje de procesamiento
    const procesandoDiv = document.getElementById('procesando-pedido');
    if (procesandoDiv) {
        procesandoDiv.classList.add('d-none');
        console.log('✅ Mensaje de procesamiento ocultado');
    } else {
        console.log('⚠️ Elemento procesando-pedido no encontrado');
    }
    
    // PASO 2: MOSTRAR el contenedor de confirmación (CRÍTICO)
    const confirmadoDiv = document.getElementById('pedido-confirmado');
    if (confirmadoDiv) {
        console.log('🔍 Estado inicial del contenedor:', confirmadoDiv.className);
        confirmadoDiv.classList.remove('d-none');
        confirmadoDiv.style.display = 'block'; // Forzar display
        console.log('✅ Contenedor pedido-confirmado mostrado');
        console.log('🔍 Estado final del contenedor:', confirmadoDiv.className);
    } else {
        console.error('❌ Contenedor pedido-confirmado NO encontrado');
    }
    
    // PASO 3: Insertar número de pedido
    const numeroPedidoDiv = document.getElementById('numero-pedido');
    if (numeroPedidoDiv) {
        const htmlContent = `
            <div class="mt-3 p-3 bg-light rounded border" style="border-color: #6b0a0a !important;">
                <div class="text-center">
                    <h6 class="mb-2 capri-color">Tu número de pedido es:</h6>
                    <h2 class="capri-color fw-bold" style="font-size: 2.5rem;">${numeroDisplay}</h2>
                </div>
            </div>
        `;
        
        numeroPedidoDiv.innerHTML = htmlContent;
        console.log('✅ Número de pedido insertado en DOM');
        console.log('🔍 HTML insertado:', htmlContent.substring(0, 100) + '...');
        
        // LIMPIAR CARRITO DESPUÉS DE MOSTRAR PEDIDO EXITOSO
        // Ya se limpió el carrito al inicio de success.js
        setTimeout(() => {
            if (typeof updateCartCounterAnimated === 'function') {
                updateCartCounterAnimated(0);
            }
        }, 1000); // Delay para que el usuario vea el número primero
        
        // VERIFICAR VISIBILIDAD DEL ELEMENTO Y SU PADRE
        console.log('🔍 Verificando visibilidad...');
        console.log('- Element display:', getComputedStyle(numeroPedidoDiv).display);
        console.log('- Element visibility:', getComputedStyle(numeroPedidoDiv).visibility);
        
        const parent = numeroPedidoDiv.parentElement;
        if (parent) {
            console.log('- Parent display:', getComputedStyle(parent).display);
            console.log('- Parent visibility:', getComputedStyle(parent).visibility);
        }
        
    } else {
        console.error('❌ Elemento numero-pedido no encontrado');
    }
    
    console.log('🎊 === PROCESO COMPLETADO ===');
    
    // PASO 4: (Ya se limpia el carrito arriba con la función estándar)
}

// Función para mostrar errores
function mostrarError(mensaje) {
    console.log('❌ Mostrando error:', mensaje);
    const procesandoDiv = document.getElementById('procesando-pedido');
    if (procesandoDiv) {
        procesandoDiv.classList.add('d-none');
    }
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
        confirmadoDiv.style.display = 'block';
    }
}

// --- DEFINICIÓN GLOBAL DE LIMPIEZA DE CARRITO SI NO EXISTE ---
if (typeof limpiarCarritoDespuesDeCompra !== 'function') {
    function limpiarCarritoDespuesDeCompra() {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('carrito'); // CORREGIDO: usar 'carrito' 
            localStorage.removeItem('datosCompra');
            localStorage.removeItem('productosCompra');
            localStorage.removeItem('totalCompra');
            localStorage.removeItem('costoEnvio');
            localStorage.removeItem('productoDetalle'); // Limpiar también el producto de detalle
            if (typeof updateCartCounterAnimated === 'function') {
                updateCartCounterAnimated(0);
            }
        }
    }
}
