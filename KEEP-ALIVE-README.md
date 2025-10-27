# Keep-Alive para Render Free Tier

## 🎯 Objetivo
Mantener el servicio Capri Store activo 24/7 en Render Free Tier y prevenir expiración de sesiones WhatsApp.

## ⚠️ Problema en Render Free Tier
- **Servicio se duerme** después de 15 minutos de inactividad
- **Sesiones WhatsApp expiran** si no hay actividad por varios días
- **Cold starts** lentos al despertar el servicio

## ✅ Solución Implementada

### 1. **Keep-Alive Script (`keep-alive.js`)**
```bash
node keep-alive.js
```

**Funciones:**
- 📡 **Ping cada 14 minutos** → Evita que Render duerma el servicio
- 🔍 **Health check cada 5 minutos** → Monitorea estado general
- 📱 **Mantenimiento WhatsApp cada 30 minutos** → Verifica y mantiene conexión

### 2. **Auto-limpieza de Sesiones Expiradas**
Endpoint: `POST /whatsapp-clean-expired`
- Detecta sesiones expiradas automáticamente
- Limpia y regenera QR si es necesario
- Llamado automáticamente por keep-alive script

### 3. **Lógica de Recuperación Automática**
En `whatsapp-service.js`:
- Detecta errores de "Execution context destroyed"
- Limpia sesión PostgreSQL automáticamente
- Reintenta inicialización con sesión limpia
- Genera nuevo QR automáticamente

## 🚀 Opciones de Deployment

### Opción 1: **Computadora Local** (Temporal)
```bash
# En tu computadora
node keep-alive.js
```
- ✅ Fácil de configurar
- ❌ Requiere computadora encendida 24/7

### Opción 2: **GitHub Actions** (Recomendado)
Crear `.github/workflows/keep-alive.yml`:
```yaml
name: Keep Capri Store Alive
on:
  schedule:
    - cron: '*/10 * * * *'  # Cada 10 minutos
  workflow_dispatch:

jobs:
  keep-alive:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Capri Store
        run: |
          curl -f https://capri-store.onrender.com/health || exit 1
          echo "Service is alive!"
```

### Opción 3: **Railway/Vercel Deployment**
Deplojar `keep-alive.js` como servicio separado:
- ✅ Gratis
- ✅ Confiable 24/7
- ✅ Independiente del servicio principal

### Opción 4: **Cron Job External**
Usar servicios como:
- UptimeRobot (gratis)
- Pingdom
- StatusCake

## 📊 Monitoreo

### Health Check Response
```json
{
  "status": "OK",
  "whatsapp_ready": true,
  "uptime": 3600,
  "deployment": {
    "simplified": true,
    "single_instance": true,
    "postgresql_sessions": true
  }
}
```

### WhatsApp Status Response
```json
{
  "whatsapp_ready": true,
  "client_state": "CONNECTED",
  "qr_generated": false,
  "business_name": "Capri Store"
}
```

## 🔧 Comandos Útiles

### Verificar Estado
```bash
curl https://capri-store.onrender.com/health
curl https://capri-store.onrender.com/whatsapp-status
```

### Limpiar Sesión Expirada
```bash
curl -X POST https://capri-store.onrender.com/whatsapp-clean-expired
```

### Forzar Reconexión
```bash
curl -X POST https://capri-store.onrender.com/whatsapp-reconnect
```

## 🎯 Beneficios

### Para el Servicio
- ✅ **0% downtime** (servicio siempre activo)
- ✅ **Response times consistentes** (sin cold starts)
- ✅ **WhatsApp siempre conectado**

### Para los Clientes
- ✅ **Notificaciones instantáneas** de compras
- ✅ **Checkout sin demoras**
- ✅ **Experiencia de usuario mejorada**

### Para el Negocio
- ✅ **No se pierden ventas** por servicio dormido
- ✅ **Notificaciones confiables** 24/7
- ✅ **Monitoreo automático** del sistema

## 📱 Alertas Automáticas

El keep-alive detecta y reporta:
- 🔍 Servicio no responde
- 📱 WhatsApp desconectado
- 🗄️ Problemas de base de datos
- ⚠️ Sesiones expiradas

## 🛠️ Troubleshooting

### Si WhatsApp se desconecta:
1. Keep-alive detecta automáticamente
2. Llama a `/whatsapp-clean-expired`
3. Se genera nuevo QR
4. Notifica para escanear

### Si el servicio no responde:
1. Keep-alive reintenta 3 veces
2. Envía alerta si persiste
3. Render reinicia automáticamente

## 📈 Próximos Pasos

1. **Implementar** keep-alive en GitHub Actions
2. **Configurar** alertas por email/Discord
3. **Monitorear** logs por 1 semana
4. **Optimizar** intervalos según uso real