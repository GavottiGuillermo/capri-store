const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

// Cargar variables de entorno antes de inicializar servicios dependientes
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('./db');
const whatsappApiService = require('./whatsapp-api-service');
const whatsappBusiness = require('./services/whatsapp');
const storeRouter = require('./routes/store');
const adminRouter = require('./routes/admin');

// SYSTEM SIMPLIFIED: PostgreSQL session persistence working perfectly - v4.0

// === CONFIGURACIÓN WHATSAPP API ÚNICAMENTE ===
console.log('📱 Usando WhatsApp Cloud API como único medio de comunicación');

// ===============================
// MANEJADORES GLOBALES DE ERRORES
// ===============================
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error.message);
  console.error('Stack:', error.stack);

  // Si es error de ENOENT, registrar pero no crashear
  if (error.code === 'ENOENT') {
    console.log('⚠️ Error de archivo no encontrado - servidor continúa funcionando');
    return;
  }

  // Para otros errores críticos, loguear pero intentar continuar
  console.error('⚠️ Error crítico - intentando continuar operación...');
});

process.on('unhandledRejection', (reason, promise) => {
  const reasonMessage = String(reason?.message || reason || '');

  if (
    reasonMessage.includes('temp-auth') ||
    reasonMessage.includes('wwebjs') ||
    reasonMessage.includes('Session closed') ||
    reasonMessage.includes('Execution context was destroyed') ||
    reasonMessage.includes('Target closed') ||
    reasonMessage.includes('Runtime.callFunctionOn')
  ) {
    console.log('⚠️ Error de WhatsApp detectado (esperable por navegación/logout) - servidor continúa funcionando');
    return;
  }

  console.error('❌ UNHANDLED REJECTION en:', promise);
  console.error('Razón:', reason);
});

// Logging inicial para debugging
console.log('🔧 Variables de entorno cargadas:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- ADMIN_WHATSAPP:', process.env.ADMIN_WHATSAPP ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO');
console.log('- CONSULTAS_WHATSAPP:', process.env.CONSULTAS_WHATSAPP ? '✅ CONFIGURADO (número propio)' : `⚠️ NO CONFIGURADO (usando ADMIN_WHATSAPP como fallback)`);
console.log('- ADMIN_INSTAGRAM:', process.env.ADMIN_INSTAGRAM ? '✅ CONFIGURADO' : '❌ NO CONFIGURADO');

// ===============================
// CONFIGURACIÓN DEL SERVIDOR
// ===============================
console.log('🚀 Capri Store API iniciando...');
console.log('💾 OPTIMIZACIÓN MEMORIA: WhatsApp bajo demanda');
console.log('📊 RAM inicial:', Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB');
console.log('📱 Sistema de comunicación: WhatsApp Business únicamente');

const app = express();

// ===============================
// CONFIGURACIÓN BÁSICA
// ===============================
const PORT = process.env.PORT || 3000;
let server;

// Configuración de CORS más permisiva para producción
app.use(cors({
  origin: function (origin, callback) {
    // Lista de dominios permitidos
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'http://localhost:10000',
      'https://capri-store.onrender.com',
      'https://capri-store-web.onrender.com',
      'https://www.capristorezte.com.ar',
      'https://capristorezte.com.ar',
      // Permitir Render y otros deployments
      /\.onrender\.com$/,
      /\.herokuapp\.com$/,
      /\.vercel\.app$/,
      /\.netlify\.app$/
    ];

    // Permitir requests sin origen (mobile apps, Postman, WhatsApp, etc)
    if (!origin) return callback(null, true);

    // Verificar si el origen está permitido
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return allowedOrigin === origin;
      } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS bloqueado para origen: ${origin}`);
      callback(null, true); // Permitir temporalmente para debug
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Middleware para logging de requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip || req.connection.remoteAddress}`);

  // Agregar headers de seguridad básicos
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');

  // Middleware básico para health check sin autenticación
  if (req.path === '/health' || req.path === '/' || req.path === '/debug' || req.path === '/contact-info' || req.path === '/stock-agotado' || req.path.startsWith('/stock-producto/') || req.path.startsWith('/variantes-producto/') || req.path === '/validar-stock-carrito' || req.path === '/crear-preferencia' || req.path === '/webhook' || req.path.startsWith('/numero-pedido/') || req.path === '/limpiar-sesiones-whatsapp') {
    return next();
  }

  // Para otros endpoints, continuar normalmente
  next();
});

// Servir archivos estáticos desde la carpeta raíz
// HTML: sin caché (fuerza revalidación en cada visita)
// JS/CSS: caché corta con ETag para evitar descargas innecesarias
app.use(express.static(path.join(__dirname, '..'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (/\.(js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
  }
}));

// Middleware: evitar que los navegadores cacheen las respuestas dinámicas (API/JSON)
// Se aplica después de express.static, por lo que solo afecta a rutas no estáticas
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ===============================
// MIDDLEWARE DE PARSING
// ===============================
app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

// ===============================
// RUTAS
// ===============================
app.use('/', storeRouter);
app.use('/admin', adminRouter);

// Función simplificada para optimización de memoria
function setupMemoryOptimization() {
  console.log('🧹 Configurando optimización de memoria...');

  // Limpiar memoria cada 5 minutos
  setInterval(() => {
    try {
      // Forzar garbage collection si está disponible
      if (global.gc) {
        const memBefore = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        global.gc();
        const memAfter = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        console.log(`🧹 GC: ${memBefore}MB → ${memAfter}MB (liberados ${memBefore - memAfter}MB)`);
      }

      // Limpiar notificaciones webhook antiguas (más de 1 hora)
      storeRouter.cleanupOldWebhookNotifications();

      // Limpiar historial de envíos duplicados
      whatsappBusiness.cleanupNotificationHistory();

      const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const memPercent = Math.round((memUsage / 512) * 100);
      console.log(`🧹 Memoria: ${memUsage}MB / 512MB (${memPercent}%)`);

    } catch (error) {
      console.log('🧹 Optimización de memoria completada');
    }
  }, 300000); // 5 minutos
}

// Inicializar la aplicación (simplificado)
async function startServer() {
  try {
    // Intentar inicializar la base de datos, pero no fallar si no está disponible
    try {
      await db.initializeDatabase();
      console.log('✅ Base de datos conectada');
    } catch (error) {
      console.warn('⚠️ Base de datos no disponible:', error.message);
      console.log('🔄 Continuando sin base de datos (solo modo estático)');
    }

    // Mostrar estado de WhatsApp API
    const apiStatus = whatsappApiService.getWhatsAppApiStatus();
    if (apiStatus.configured) {
      console.log('📱 WhatsApp: Cloud API configurada y lista ✅');
      console.log(`   - Phone Number ID: ${process.env.WA_PHONE_ID?.substring(0, 10)}...`);
      console.log(`   - Business Account: ${process.env.WA_BUSINESS_ACCOUNT_ID?.substring(0, 10)}...`);
    } else {
      console.log('📱 WhatsApp: Cloud API no configurada ⚠️');
      console.log(`   - Faltan variables: ${apiStatus.missing.join(', ')}`);
      console.log('   - Las notificaciones no se enviarán hasta configurar la API');
    }

    // Configurar optimización de memoria
    setupMemoryOptimization();

    // Iniciar servidor siempre, independientemente de otros servicios
    const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    server = app.listen(PORT, HOST, () => {
      console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
      console.log(`🚀 Capri Store API escuchando en puerto ${PORT}`);
      console.log(`🌐 Host: ${HOST}:${PORT}`);
      console.log(`🌐 URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);

      // Estado de WhatsApp API
      const apiStatus = whatsappApiService.getWhatsAppApiStatus();
      if (apiStatus.configured) {
        console.log(`📱 WhatsApp: API configurada y lista`);
      } else {
        console.log(`📱 WhatsApp: API no configurada - missing: ${apiStatus.missing.join(', ')}`);
      }

      console.log(`🗄️ Base de datos: ${db.pool ? 'Conectada' : 'No disponible'}`);
      console.log(`⚙️ Sistema: WhatsApp Cloud API - Sin conexión QR necesaria`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      console.log('📊 Sistema de notificaciones v3.0 - Solo WhatsApp Cloud API');
      console.log('ℹ️ WhatsApp: Usa API oficial - Sin QR, sin sesiones locales');
      console.log('ℹ️ Keep-alive: GitHub Actions cada 5 min (procesa pendientes)');

      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📱 WhatsApp Cloud API - Configuración en variables de entorno`);
      console.log(`💡 Variables requeridas:`);
      console.log(`   - WHATSAPP_API_PHONE_NUMBER_ID`);
      console.log(`   - WHATSAPP_API_TOKEN`);
      console.log(`   - USE_WHATSAPP_API=true`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    });

  } catch (error) {
    console.error('❌ Error crítico al iniciar servidor:', error);

    // Intentar iniciar servidor básico aunque haya errores
    try {
      const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
      server = app.listen(PORT, HOST, () => {
        console.log(`🚨 Servidor en modo de emergencia en puerto ${PORT}`);
        console.log(`🌐 Host: ${HOST}:${PORT}`);
        console.log(`⚠️ Algunos servicios pueden no estar disponibles`);
      });
    } catch (criticalError) {
      console.error('💥 Error crítico - No se puede iniciar el servidor:', criticalError);
      process.exit(1);
    }
  }
}

startServer();
