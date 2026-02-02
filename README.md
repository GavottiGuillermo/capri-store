# Capri Store - E-commerce

## Descripción
Este proyecto contiene una página web de comercio electrónico creada con Bootstrap, HTML5, CSS3 y JavaScript, con integración completa de Mercado Pago, sistema de contacto directo por WhatsApp y notificaciones automáticas de compras.

## Características principales
- ✅ Carrito de compras con persistencia en localStorage
- ✅ Integración real con Mercado Pago
- ✅ Cálculo de envío con Andreani API
- ✅ **Sistema de contacto directo por WhatsApp, Instagram y Email**
- ✅ **Notificaciones automáticas de compras por WhatsApp Business**
- ✅ Animaciones y transiciones suaves
- ✅ Diseño responsive
- ✅ Backend Express con PostgreSQL

## Configuración de Variables de Entorno

### 1. Crear archivo .env
Copia el archivo `.env.example` como `.env` y configura tus valores:

```bash
cp .env.example .env
```

### 2. Configurar información de contacto
```env
# Información de contacto directo
ADMIN_WHATSAPP=5493415123456
ADMIN_INSTAGRAM=capri_store_oficial
ADMIN_EMAIL=contacto@capristore.com.ar
```

### 3. Configurar Mercado Pago
```env
# Para pruebas
MERCADOPAGO_ACCESS_TOKEN_TEST=TEST-tu_access_token_de_test

# Para producción
MERCADOPAGO_ACCESS_TOKEN=tu_access_token_de_produccion
```

## Instalación y Ejecución

### Para probar localmente:
1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Configurar variables de entorno:
   ```bash
   # Copia y configura el archivo .env
   cp .env.example .env
   # Edita .env con tus valores reales
   ```

3. Iniciar el servidor:
   ```bash
   npm start
   ```

4. Abrir en el navegador:
   ```
   http://localhost:3001
   ```

## Sistema de Contacto Directo

### Funcionalidades de contacto:
1. **Contacto directo por WhatsApp** - Enlace que abre WhatsApp con mensaje predefinido
2. **Contacto por Instagram** - Enlace directo al perfil de Instagram
3. **Contacto por Email** - Enlace que abre el cliente de email con datos prellenados
4. **Interfaz responsive** con botones claros y accesibles

### Sistema de notificaciones WhatsApp Business:
1. **Configuración automática** - QR code para conectar dispositivo
2. **Notificaciones de compras** - Envío automático cuando se realiza una compra
3. **Información detallada** - Datos del cliente, productos y totales
4. **Conexión robusta** - Manejo automático de reconexiones

### Primera configuración de WhatsApp Business:
1. Ejecutar `npm start` para iniciar el servidor
2. Escanear el código QR que aparece en consola con WhatsApp Web
3. El sistema quedará conectado automáticamente
4. Las notificaciones se enviarán al número configurado en `ADMIN_WHATSAPP`

## Integración de Mercado Pago

### Para testing:
- El código incluye un access token de test predeterminado
- Agregar productos al carrito
- Proceder al checkout
- Completar el formulario
- Hacer clic en "Iniciar Pago"
- Se creará una preferencia real en Mercado Pago
- Redirección automática al checkout de Mercado Pago

### URLs de retorno:
- **Éxito**: `/success.html`
- **Error**: `/failure.html`
- **Pendiente**: `/pending.html`

## Estructura del proyecto
```
/
├── index.html              # Página principal con contacto directo
├── detalle.html           # Página de detalles del producto
├── checkout.html          # Página de checkout
├── success.html           # Página de pago exitoso
├── failure.html           # Página de error en pago
├── pending.html           # Página de pago pendiente
├── package.json           # Dependencias y scripts
├── .env.example           # Variables de entorno (template)
├── css/
│   └── styles.css         # Estilos personalizados
├── js/
│   ├── scripts.js         # JavaScript del frontend
│   ├── events.js          # Manejo de eventos y contacto
│   ├── server.js          # Servidor Express (backend)
│   ├── whatsapp-service.js # Servicio de WhatsApp Business
│   └── andreani-api.js    # Integración con Andreani
└── assets/
    └── img/               # Imágenes del sitio
```

## Tecnologías utilizadas
- **Frontend**: HTML5, CSS3, JavaScript, Bootstrap 4.5
- **Backend**: Node.js, Express
- **Base de datos**: PostgreSQL
- **Notificaciones**: WhatsApp Business API (whatsapp-web.js)
- **Pagos**: Mercado Pago SDK v2.7.0
- **Envíos**: Andreani API

## Deploy en producción
- El proyecto está configurado para deploy automático en Render
- Las variables de entorno se configuran en el panel de Render
- URLs de producción: https://www.capristorezte.com.ar

## Funcionalidades implementadas
1. **Carrito de compras**: Agregar, quitar, actualizar cantidades
2. **Checkout completo**: Formulario con validación
3. **Cálculo de envío**: Integración con Andreani API
4. **Pago real**: Integración completa con Mercado Pago
5. **Contacto directo**: Enlaces a WhatsApp, Instagram y Email
6. **Notificaciones WhatsApp**: Confirmaciones automáticas de compras
7. **Responsive**: Funciona en todos los dispositivos
8. **Animaciones**: Transiciones suaves y efectos visuales

## Notas importantes
- El access token incluido es de TEST, solo para pruebas
- Para producción, configurar credenciales reales en variables de entorno
- El carrito se mantiene entre sesiones usando localStorage
- Las páginas de retorno manejan automáticamente el estado del pago

---
&copy; 2026 Capri Store - Todos los derechos reservados
