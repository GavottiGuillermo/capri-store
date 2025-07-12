# Capri Store - E-commerce

## Descripción
Este proyecto contiene una página web de comercio electrónico creada con Bootstrap, HTML5, CSS3 y JavaScript, con integración completa de Mercado Pago y Andreani API.

## Características principales
- ✅ Carrito de compras con persistencia en localStorage
- ✅ Integración real con Mercado Pago
- ✅ Cálculo de envío con Andreani API
- ✅ Animaciones y transiciones suaves
- ✅ Diseño responsive
- ✅ Backend Express para pagos y correos

## Integración de Mercado Pago

### Para probar localmente:
1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Configurar variables de entorno (opcional):
   ```bash
   # Crear archivo .env (opcional)
   MERCADOPAGO_ACCESS_TOKEN_TEST=tu_access_token_de_test
   EMAIL_USER=tu_email_zoho
   EMAIL_PASS=tu_password_zoho
   ```

3. Iniciar el servidor:
   ```bash
   npm start
   ```

4. Abrir en el navegador:
   ```
   http://localhost:3001
   ```

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
├── index.html              # Página principal
├── detalle.html           # Página de detalles del producto
├── checkout.html          # Página de checkout
├── success.html           # Página de pago exitoso
├── failure.html           # Página de error en pago
├── pending.html           # Página de pago pendiente
├── package.json           # Dependencias y scripts
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
- **Frontend**: HTML5, CSS3, JavaScript, Bootstrap 5
- **Backend**: Node.js, Express
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
