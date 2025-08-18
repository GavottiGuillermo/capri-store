# Capri Store - E-commerce

## Descripción
Este proyecto contiene una página web de comercio electrónico creada con Bootstrap, HTML5, CSS3 y JavaScript, con integración completa de Mercado Pago, sistema de contacto con envío automático de correos y gestión de stock.

## Características principales
- ✅ Carrito de compras con persistencia en localStorage
- ✅ Integración real con Mercado Pago
- ✅ Cálculo de envío con Andreani API
- ✅ **Sistema de contacto con correos automáticos**
- ✅ **Confirmación de pedidos por email**
- ✅ Animaciones y transiciones suaves
- ✅ Diseño responsive
- ✅ Backend Express con PostgreSQL

## Configuración de Variables de Entorno

### 1. Crear archivo .env
Copia el archivo `.env.example` como `.env` y configura tus valores:

```bash
cp .env.example .env
```

### 2. Configurar Zoho Mail para correos automáticos
```env
# Email principal de Capri Store
SMTP_USER=contacto@capristore.com.ar

# Contraseña de aplicación de Zoho (NO tu contraseña normal)
SMTP_PASS=tu_contraseña_de_aplicacion_zoho

# Emails administrativos que recibirán consultas
ADMIN_EMAILS=gavottiguillermo@gmail.com,luisinaolivieri.lo@gmail.com
```

**⚠️ IMPORTANTE**: Para `SMTP_PASS` debes usar una **contraseña específica de aplicación**:
1. Ve a [Zoho Mail](https://mail.zoho.com) → Configuración → Seguridad
2. Busca "Contraseñas de aplicación" o "App Passwords"
3. Genera una nueva contraseña para "Aplicación de correo"
4. Usa esa contraseña generada en `SMTP_PASS`

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

## Sistema de Contacto con Correos Automáticos

### Funcionalidades del formulario de contacto:
1. **Validación en tiempo real** de todos los campos
2. **Correo de confirmación automático** al usuario
3. **Notificación inmediata** a los administradores
4. **Interfaz responsive** con feedback visual

### Flujo de correos:
1. **Usuario completa formulario** → Valida datos
2. **Se envía correo de confirmación** al usuario con mensaje de agradecimiento
3. **Se notifica a administradores** con todos los datos de contacto
4. **Administradores pueden responder directamente** al email del cliente

### Configuración de correos administrativos:
```env
# Los emails que recibirán las consultas
ADMIN_EMAILS=gavottiguillermo@gmail.com,luisinaolivieri.lo@gmail.com
```

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
├── index.html              # Página principal con formulario de contacto
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
│   ├── server.js          # Servidor Express (backend)
│   └── andreani-api.js    # Integración con Andreani
└── assets/
    ├── img/               # Imágenes del sitio
    └── mail/              # Scripts de contacto (legacy)
```

## Tecnologías utilizadas
- **Frontend**: HTML5, CSS3, JavaScript, Bootstrap 4.5
- **Backend**: Node.js, Express
- **Base de datos**: PostgreSQL
- **Correos**: Nodemailer con Zoho Mail
- **Pagos**: Mercado Pago SDK v2.7.0
- **Envíos**: Andreani API
- **Email**: Nodemailer con Zoho Mail

## Deploy en producción
- El proyecto está configurado para deploy automático en Render
- Las variables de entorno se configuran en el panel de Render
- URLs de producción: https://www.capristorezte.com.ar

## Funcionalidades implementadas
1. **Carrito de compras**: Agregar, quitar, actualizar cantidades
2. **Checkout completo**: Formulario con validación
3. **Cálculo de envío**: Integración con Andreani API
4. **Pago real**: Integración completa con Mercado Pago
5. **Confirmación por email**: Envío automático de confirmaciones
6. **Responsive**: Funciona en todos los dispositivos
7. **Animaciones**: Transiciones suaves y efectos visuales

## Notas importantes
- El access token incluido es de TEST, solo para pruebas
- Para producción, configurar credenciales reales en variables de entorno
- El carrito se mantiene entre sesiones usando localStorage
- Las páginas de retorno manejan automáticamente el estado del pago

---
&copy; 2024 Capri Store - Todos los derechos reservados
