# SOLUCIÓN PARA TIMEOUT SMTP EN RENDER

## 🚨 **Problema Detectado**

El error `Connection timeout` (`ETIMEDOUT`, `CONN`) indica que **Render está bloqueando las conexiones SMTP salientes**. Esto es común en servicios de hosting para prevenir spam.

```
❌ Error: Connection timeout
❌ Code: ETIMEDOUT  
❌ Command: CONN
```

## 🛠️ **Soluciones Implementadas**

### **Solución 1: Cambiar configuración SMTP**

**Variables de entorno en Render:**
```bash
# En lugar de puerto 587 TLS, usar puerto 465 SSL
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info.capristorezte@gmail.com
SMTP_PASS=tu_app_password_de_16_caracteres
SMTP_FROM=info.capristorezte@gmail.com
ADMIN_EMAILS=gavottiguillermo@gmail.com
```

### **Solución 2: Sistema de Fallback Multi-Proveedor**

He creado `email-render.js` que prueba automáticamente:
1. **Gmail SSL** (puerto 465) - Más confiable
2. **Gmail TLS** (puerto 587) - Backup 
3. **Outlook** (puerto 587) - Alternativa

### **Solución 3: Endpoint Optimizado**

El archivo `contact-render.js` contiene un endpoint simplificado y optimizado.

## 🔧 **Pasos para Implementar**

### **Paso 1: Configurar Variables en Render**

En el dashboard de Render:

1. Ve a tu servicio → Settings → Environment
2. Configura estas variables:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info.capristorezte@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx  # Tu App Password de 16 caracteres
SMTP_FROM=info.capristorezte@gmail.com
ADMIN_EMAILS=gavottiguillermo@gmail.com
```

### **Paso 2: Usar el Nuevo Sistema**

**Opción A: Reemplazar endpoint de contacto**

Copia el código de `contact-render.js` y reemplaza el endpoint `/contact` en `server.js`.

**Opción B: Agregar las funciones**

1. Agrega al principio de `server.js`:
```javascript
const { enviarCorreoContactoRender } = require('./email-render');
```

2. En el endpoint `/contact`, reemplaza el envío por:
```javascript
const resultado = await enviarCorreoContactoRender(nombre, email, mensaje);
```

### **Paso 3: Probar el Sistema**

**Probar configuración SMTP:**
```bash
curl https://capri-store.onrender.com/test-smtp-render
```

**Probar contacto:**
```bash
curl -X POST https://capri-store.onrender.com/contact \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Test","email":"test@example.com","mensaje":"Prueba"}'
```

## ⚡ **Solución Rápida (Implementar YA)**

### **1. En Render Dashboard → Environment Variables:**

```bash
SMTP_PORT=465
SMTP_SECURE=true
```

### **2. Agregar al inicio de server.js:**

```javascript
// Función de envío simplificada para Render
async function enviarCorreoRender(nombre, email, mensaje) {
  try {
    // Configuración SSL para Render
    const transporter = nodemailer.createTransporter({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // SSL
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      connectionTimeout: 5000,
      greetingTimeout: 3000,
      socketTimeout: 10000
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.ADMIN_EMAILS.split(','),
      subject: `Nueva consulta de ${nombre} - Capri Store`,
      text: `Nombre: ${nombre}\nEmail: ${email}\nMensaje: ${mensaje}\n\nFecha: ${new Date().toLocaleString('es-AR')}`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email enviado:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('❌ Error email:', error.message);
    return { success: false, error: error.message };
  }
}
```

### **3. En el endpoint `/contact`, cambiar por:**

```javascript
app.post('/contact', async (req, res) => {
  const { nombre, email, mensaje } = req.body;
  
  if (!nombre || !email || !mensaje) {
    return res.status(400).json({ success: false, error: 'Datos incompletos' });
  }
  
  const resultado = await enviarCorreoRender(nombre, email, mensaje);
  
  if (resultado.success) {
    res.json({ success: true, message: 'Consulta enviada correctamente' });
  } else {
    res.status(500).json({ success: false, error: 'Error enviando consulta' });
  }
});
```

## 🚀 **Resultado Esperado**

Después de estos cambios, deberías ver en los logs:

```
✅ SMTP configurado: smtp.gmail.com:465 (secure: true)
📧 Enviando email usando: Gmail SSL
✅ Email enviado exitosamente
```

En lugar de:

```
❌ Error: Connection timeout
❌ Code: ETIMEDOUT
```

## 🔄 **Si Sigue Fallando**

### **Plan B: Usar SendGrid (Gratis en Render)**

1. Registrarse en SendGrid
2. Obtener API Key
3. Cambiar configuración:

```bash
SENDGRID_API_KEY=tu_api_key_aqui
```

### **Plan C: Webhook a Zapier/Make**

Enviar datos a webhook externo que maneje el email.

## 📞 **Contacto de Emergencia**

Mientras se arregla el email, agregar mensaje alternativo:

```javascript
res.json({ 
  success: true, 
  message: 'Consulta recibida. Te contactaremos por WhatsApp.',
  whatsapp: '+54 9 3487 123456'
});
```

**El problema principal es que Render bloquea SMTP saliente en puerto 587. El puerto 465 SSL suele funcionar mejor.**