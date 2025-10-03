# 📱 Configuración de WhatsApp Business para Capri Store

## ✅ **INTEGRACIÓN COMPLETADA**

Se ha reemplazado completamente el sistema de emails por **WhatsApp Business API**, ofreciendo comunicación directa y más efectiva con los clientes.

## 🔧 **Configuración Requerida**

### Variables de Entorno

```bash
# WhatsApp Business (OBLIGATORIO)
ADMIN_WHATSAPP=5493487456789  # Número del administrador (formato: código país + número)

# Base de datos y otros servicios (mantener)
DATABASE_URL=postgresql://...
MP_ACCESS_TOKEN=...
MP_PUBLIC_KEY=...
PORT=3000
```

### Formato del Número
- ✅ Correcto: `5493487456789` (54 = Argentina, 9 = celular, número)
- ❌ Incorrecto: `+54 9 3487 456789` (sin espacios ni símbolos)

## 🚀 **Cómo Funciona**

### 1. **Primera Vez (Autenticación)**
```bash
npm start
# Aparecerá un código QR en la consola
# Escanéalo con WhatsApp para vincular
```

### 2. **Flujo de Contacto**
1. Cliente llena formulario web
2. ⚡ **Notificación instantánea al admin** por WhatsApp
3. 📱 **Confirmación al cliente** (si proporcionó teléfono)
4. 💬 **Respuesta directa** desde WhatsApp

## 📋 **Nuevos Campos del Formulario**

```html
<!-- Campos requeridos -->
<input name="nombre" required>
<textarea name="mensaje" required></textarea>

<!-- Campos opcionales -->
<input name="email" type="email">
<input name="telefono" type="tel">  <!-- NUEVO: para confirmación WhatsApp -->
```

## 📱 **Mensajes Automáticos**

### Para Administrador:
```
🛍️ NUEVA CONSULTA - Capri Store

👤 Cliente: Juan Pérez
📧 Email: juan@email.com
📱 Teléfono: +54 9 3487 123456
📅 Fecha: 02/10/2024 14:30

💬 Mensaje:
Consulta sobre productos...

━━━━━━━━━━━━━━━━━━━━
🚀 Responde directamente para contactar al cliente
💡 ID: abc123
```

### Para Cliente (si tiene WhatsApp):
```
¡Hola Juan! 👋

Gracias por contactar a Capri Store. Hemos recibido tu consulta:

"Consulta sobre productos..."

📞 Te responderemos a la brevedad por este mismo número.
⏱️ Tiempo de respuesta: 2-4 horas hábiles

🛍️ Mientras tanto, explora nuestros productos en capristorezte.com.ar

━━━━━━━━━━━━━━━━━━━━
✨ Capri Store - Zárate, Buenos Aires
```

## 🛠️ **Endpoints Nuevos**

### `/contact` (POST)
```json
{
  "nombre": "Juan Pérez",
  "email": "juan@email.com",      // opcional
  "telefono": "+54 9 3487 123456", // opcional
  "mensaje": "Consulta sobre productos"
}
```

### `/whatsapp-status` (GET)
```json
{
  "whatsapp_ready": true,
  "client_initialized": true,
  "admin_number": "+5493487****789",
  "business_name": "Capri Store"
}
```

### `/health` (GET)
```json
{
  "status": "OK",
  "timestamp": "2024-10-02T18:30:00.000Z",
  "uptime": 3600,
  "whatsapp_ready": true,
  "business_name": "Capri Store"
}
```

## ⚡ **Ventajas sobre Email**

- ✅ **Sin problemas de Render**: No usa puertos bloqueados
- ✅ **Comunicación directa**: Cliente y admin en el mismo chat
- ✅ **Mayor engagement**: 98% de emails de WhatsApp se leen
- ✅ **Respuesta inmediata**: Notificaciones push instantáneas
- ✅ **Menos spam**: Los mensajes llegan directamente
- ✅ **Multimedia**: Posibilidad de enviar fotos, audios, etc.

## 🔧 **Troubleshooting**

### Problema: QR no aparece
```bash
# Eliminar sesión anterior
rm -rf .wwebjs_auth/session-capri-store-session
npm start
```

### Problema: WhatsApp desconectado
- ⚠️ El teléfono debe tener internet
- 🔄 Se reconecta automáticamente
- 📱 Revisar que WhatsApp esté abierto en el teléfono

### Problema: Mensajes no llegan
- ✅ Verificar `ADMIN_WHATSAPP` en variables de entorno
- 📱 Comprobar formato del número (sin espacios ni símbolos)
- 🔍 Revisar logs: `whatsapp_ready: true`

## 📞 **Número de Contacto Actual**

**Admin WhatsApp**: +54 9 3487 456789
*(Actualizar en variable `ADMIN_WHATSAPP` según corresponda)*

---
🎉 **¡WhatsApp Business integrado exitosamente en Capri Store!**