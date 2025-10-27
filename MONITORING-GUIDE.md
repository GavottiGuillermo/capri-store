# 📊 Monitoreo de GitHub Actions

## 🎯 Workflows Configurados

### 1. **🔄 Keep Capri Store Alive**
- **Frecuencia:** Cada 12 minutos
- **Función:** Mantener servicio activo y prevenir sleep
- **Archivo:** `.github/workflows/keep-alive.yml`

### 2. **📊 Daily Health Report**  
- **Frecuencia:** Diario a las 9:00 AM UTC
- **Función:** Reporte completo de salud del sistema
- **Archivo:** `.github/workflows/daily-health-report.yml`

## 🔍 **Cómo Ver el Estado**

### **En GitHub (Recomendado):**

1. **Ve a tu repositorio:** https://github.com/GavottiGuillermo/capri-store

2. **Pestaña "Actions":** 
   ```
   https://github.com/GavottiGuillermo/capri-store/actions
   ```

3. **Workflows disponibles:**
   - 🔄 Keep Capri Store Alive
   - 📊 Daily Health Report

### **Estados que verás:**

#### ✅ **Exitoso (Verde)**
```
✅ Keep Capri Store Alive
   ✅ Ping Health Check
   ✅ Check WhatsApp Status  
   ✅ WhatsApp Maintenance
   ✅ Memory Check
   ✅ Summary
```

#### ❌ **Fallido (Rojo)**
```
❌ Keep Capri Store Alive  
   ✅ Ping Health Check
   ❌ Check WhatsApp Status  # <- Error aquí
   ⚠️ WhatsApp Maintenance
   ⚠️ Memory Check
   ⚠️ Summary
```

#### 🟡 **En Progreso (Amarillo)**
```
🟡 Keep Capri Store Alive
   🔄 Ejecutándose...
```

## 📱 **URLs de Monitoreo Directo**

### **GitHub Actions Dashboard:**
```
https://github.com/GavottiGuillermo/capri-store/actions
```

### **Keep-Alive Workflow:**
```
https://github.com/GavottiGuillermo/capri-store/actions/workflows/keep-alive.yml
```

### **Daily Report Workflow:**
```
https://github.com/GavottiGuillermo/capri-store/actions/workflows/daily-health-report.yml
```

### **Últimas Ejecuciones:**
```
https://github.com/GavottiGuillermo/capri-store/actions/runs
```

## 🔔 **Notificaciones**

### **Configurar Alertas por Email:**

1. Ve a tu perfil GitHub → Settings
2. Notifications → Actions
3. Habilita: "Send notifications for failed workflows"

### **Ver en Móvil:**
- Instala la app "GitHub" 
- Ve a: Repositories → capri-store → Actions

## 📊 **Qué Información Verás**

### **En cada ejecución verás:**

#### 📡 **Ping Health Check:**
```
✅ Servicio respondiendo correctamente
📊 Status Code: 200
📄 Response: {"status":"OK","timestamp":"..."}
```

#### 📱 **WhatsApp Status:**
```
✅ Estado de WhatsApp obtenido correctamente  
📱 WhatsApp Ready: true
✅ WhatsApp está conectado y funcionando
```

#### 🔧 **Mantenimiento:**
```
✅ Mantenimiento ejecutado correctamente
🔧 Maintenance Status Code: 200
```

#### 📊 **Memoria:**
```
✅ Información de memoria obtenida
📊 Uso de memoria: 45%
```

## 🚨 **Alertas y Problemas**

### **Si ves esto, HAY PROBLEMA:**

#### ❌ **Servicio Caído:**
```
❌ Servicio no responde correctamente
📊 Status Code: 503
```
**Acción:** Verificar Render dashboard

#### ⚠️ **WhatsApp Desconectado:**
```
⚠️ WhatsApp no está conectado - puede necesitar atención
📱 WhatsApp Ready: false
```
**Acción:** Escanear QR code

#### 🚨 **Memoria Alta:**
```
⚠️ USO DE MEMORIA ALTO: 87%
```
**Acción:** Verificar logs de Render

## ⚡ **Ejecución Manual**

### **Para ejecutar manualmente:**

1. Ve a: https://github.com/GavottiGuillermo/capri-store/actions
2. Selecciona "🔄 Keep Capri Store Alive"
3. Click "Run workflow"
4. Click "Run workflow" (confirmar)

## 📈 **Historial y Estadísticas**

### **Ver rendimiento histórico:**
- GitHub Actions guarda logs por 90 días
- Puedes ver tendencias de uptime
- Estadísticas de éxito/fallo
- Tiempos de respuesta

### **Métricas importantes:**
- ✅ **Success Rate:** Debe ser >95%
- ⏱️ **Response Time:** Debe ser <3 segundos  
- 📱 **WhatsApp Uptime:** Debe ser >90%
- 💾 **Memory Usage:** Debe ser <80%

## 🔧 **Troubleshooting**

### **Si Keep-Alive falla constantemente:**
1. Verificar Render status
2. Revisar logs del servicio
3. Verificar variables de entorno

### **Si WhatsApp siempre aparece desconectado:**
1. Ir a `/whatsapp-status` manualmente
2. Escanear QR si aparece
3. Verificar sesión PostgreSQL

### **Para debug avanzado:**
- Ver logs completos en cada ejecución
- Ejecutar workflows manualmente  
- Verificar endpoints individuales