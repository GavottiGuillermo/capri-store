# 🔧 Configuración para Render (Producción)

## Variables de Entorno Obligatorias

### 📱 Información de Contacto
```
ADMIN_WHATSAPP=5493487456789
ADMIN_INSTAGRAM=capri_store_oficial
ADMIN_EMAIL=contacto@capristore.com.ar
```
*Configura tus datos de contacto directo*

### 🗄️ Base de Datos (PostgreSQL)
```
DATABASE_URL=postgresql://username:password@hostname:port/database
```
*Render te proporciona esta URL automáticamente si tienes PostgreSQL*

### 💰 MercadoPago
```
MERCADOPAGO_ACCESS_TOKEN=APP_USR-tu_token_de_produccion
```
*Usa tu token de PRODUCCIÓN (APP_USR-), no el de TEST*

## 📋 Pasos en Render Dashboard

1. **Ve a tu servicio en Render**
2. **Clic en "Environment"**
3. **Agregar cada variable de entorno**
4. **Hacer Deploy**

## ⚠️ Importante

- **ADMIN_WHATSAPP**: El número que recibirá las notificaciones de compras (formato: 5493487456789)
- **ADMIN_INSTAGRAM**: Tu usuario de Instagram sin @ (ej: capri_store_oficial)
- **ADMIN_EMAIL**: Email para contacto directo (ej: contacto@capristore.com.ar)
- **DATABASE_URL**: Se configura automáticamente si tienes PostgreSQL en Render
- **MERCADOPAGO_ACCESS_TOKEN**: Debe ser de PRODUCCIÓN para ventas reales

## 🔄 Después de Configurar

1. Render redesplegará automáticamente
2. En los logs verás: "📱 Inicializando servicio WhatsApp..."
3. **La primera vez aparecerá un QR en los logs**
4. Escanéalo con WhatsApp Web para autenticar el sistema de notificaciones

## 📱 Autenticación WhatsApp (Solo para notificaciones de compras)

**SOLO LA PRIMERA VEZ:**
- Ve a los logs de Render
- Busca el código QR que aparece en ASCII
- Escanéalo con WhatsApp > Dispositivos Vinculados > Vincular Dispositivo
- Una vez autenticado, se guardará la sesión automáticamente
- **Nota**: Esto es solo para notificaciones automáticas de compras, el contacto directo funciona sin autenticación

## 🧪 Testing

Después de configurar, prueba:
```
https://tu-app.onrender.com/health
```

Debe mostrar:
```json
{
  "status": "OK",
  "whatsapp_available": true,
  "whatsapp_ready": true,
  "business_name": "Capri Store"
}
```