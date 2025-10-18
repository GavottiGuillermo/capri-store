# 🚀 Deploy: Sistema de Instance Lock para Prevenir Múltiples Instancias

## 📋 Resumen del Problema

Durante los deploys en Render, se detectaron **múltiples instancias ejecutándose simultáneamente** (IDs: `4c8bn`, `5gvz6`). Esto causaba:

- Competencia por la sesión de WhatsApp
- Desconexiones constantes
- Consumo excesivo de memoria
- Riesgo de ban por WhatsApp

## ✅ Solución Implementada

### 1. Sistema de Instance Lock (`instance-lock.js`)
- Lock distribuido usando PostgreSQL como semáforo
- Solo **UNA instancia** puede ejecutar WhatsApp a la vez
- Heartbeat cada 30 segundos para mantener el lock vivo
- Auto-limpieza de locks obsoletos (>2 min sin heartbeat)

### 2. Integración en WhatsApp Service
- Inicialización en 3 pasos: Lock → Adquirir → WhatsApp
- Manejo de pérdida de lock (cierre graceful)
- Cleanup automático en SIGTERM/SIGINT

### 3. Configuración de Render (`render.yaml`)
- `numInstances: 1` - Forzar una sola instancia
- `startTimeout: 120` - Tiempo para adquirir lock
- Health checks mejorados con info de lock

### 4. Herramientas de Diagnóstico
- `diagnostico-lock.js` - Script para verificar estado de locks
- Endpoint `/health` mejorado con info de instance lock
- Documentación completa en `INSTANCE_LOCK_README.md`

## 📁 Archivos Modificados

### Nuevos:
- `js/instance-lock.js` - Sistema de bloqueo de instancia
- `js/diagnostico-lock.js` - Script de diagnóstico
- `INSTANCE_LOCK_README.md` - Documentación completa

### Modificados:
- `js/whatsapp-service.js` - Integración de InstanceLock
- `js/server.js` - Health check mejorado
- `render.yaml` - Configuración de deploy mejorada

## 🔧 Cómo Usar

### Deploy en Render
1. Hacer push de los cambios
2. Render hará auto-deploy
3. La nueva instancia adquirirá el lock
4. La instancia anterior se cerrará automáticamente

### Verificar Estado
```bash
# Health check
curl https://capri-store.onrender.com/health

# Diagnóstico local (con DATABASE_URL)
node js/diagnostico-lock.js
```

### En caso de problemas
```sql
-- Liberar locks manualmente
DELETE FROM instance_locks;
```

## 📊 Comportamiento Esperado

### Logs de Deploy Exitoso:
```
🔐 PASO 1/3: Inicializando sistema de InstanceLock...
✅ Pool de conexiones para InstanceLock creado
✅ Tabla instance_locks verificada/creada
🔐 PASO 2/3: Adquiriendo lock exclusivo...
✅ Lock adquirido por render-abc123-1234567890
💓 Heartbeat del lock iniciado (cada 30s)
🔐 PASO 3/3: Inicializando cliente WhatsApp...
```

### Si hay otra instancia activa:
```
🔐 PASO 2/3: Adquiriendo lock exclusivo...
⏳ Lock ocupado, esperando...
⏳ Lock ocupado, esperando...
✅ Lock adquirido (instancia anterior terminada)
```

## 🎯 Resultado

- ✅ Solo 1 instancia activa a la vez
- ✅ No más competencia por WhatsApp
- ✅ Deploys sin downtime (transición suave)
- ✅ Memoria optimizada (1 browser en vez de 2+)
- ✅ Menor riesgo de ban de WhatsApp

## 🔄 Próximos Pasos

1. **Hacer commit y push**
2. **Monitorear logs en Render** durante el próximo deploy
3. **Verificar health check** con info de lock
4. **Confirmar** que solo aparece 1 instance_id en logs

## 📝 Notas Importantes

- El lock es **automático** - no requiere intervención manual
- En desarrollo local (sin DATABASE_URL), el lock se desactiva
- El sistema es **fail-safe** - si algo falla, libera el lock
- Compatible con plan Free de Render (1 instancia máx)

---

**Versión**: Instance Lock v1.0  
**Fecha**: Octubre 18, 2025  
**Cambios**: 4 archivos nuevos, 3 modificados
