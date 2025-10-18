# Sistema de Instance Lock para WhatsApp

## 🎯 Problema que Resuelve

Cuando haces múltiples deploys en Render (o cualquier plataforma), pueden existir **2 o más instancias corriendo simultáneamente** durante unos minutos. Esto causa:

- ❌ **Competencia por la sesión de WhatsApp** - ambas instancias intentan conectarse
- ❌ **Desconexiones constantes** - WhatsApp se confunde con múltiples conexiones
- ❌ **Consumo excesivo de memoria** - múltiples browsers Puppeteer corriendo
- ❌ **Riesgo de ban** - WhatsApp puede bloquear tu número por actividad sospechosa

## ✅ Solución: Instance Lock

El sistema de `InstanceLock` usa PostgreSQL como un semáforo distribuido:

1. **Solo UNA instancia** puede tener el "lock" activo a la vez
2. La instancia con el lock es la **única que ejecuta WhatsApp**
3. Otras instancias esperan o se cierran automáticamente
4. Si una instancia muere, el lock se libera automáticamente (gracias al heartbeat)

## 🔧 Cómo Funciona

### 1. Tabla de Locks en PostgreSQL

```sql
CREATE TABLE instance_locks (
  lock_key VARCHAR(255) PRIMARY KEY,        -- 'whatsapp_instance_lock'
  instance_id VARCHAR(255) NOT NULL,        -- ID único de esta instancia
  locked_at TIMESTAMP NOT NULL,             -- Cuándo se adquirió
  last_heartbeat TIMESTAMP NOT NULL,        -- Última señal de vida
  metadata JSONB                            -- Info adicional
);
```

### 2. Proceso de Inicialización

```javascript
// Paso 1: Inicializar sistema de lock
await instanceLock.initialize();

// Paso 2: Intentar adquirir el lock (timeout 60s)
const lockAcquired = await instanceLock.acquireLock(60000);

if (!lockAcquired) {
  throw new Error('Otra instancia está activa');
}

// Paso 3: Inicializar WhatsApp (solo si tiene el lock)
await whatsappClient.initialize();
```

### 3. Heartbeat (cada 30 segundos)

La instancia activa actualiza `last_heartbeat` cada 30 segundos:

```sql
UPDATE instance_locks 
SET last_heartbeat = NOW() 
WHERE lock_key = 'whatsapp_instance_lock' 
  AND instance_id = 'mi-instancia-123';
```

### 4. Limpieza Automática

Locks sin heartbeat por más de **2 minutos** se consideran "muertos" y se eliminan:

```sql
DELETE FROM instance_locks 
WHERE last_heartbeat < NOW() - INTERVAL '2 minutes';
```

## 📊 Monitoreo

### Ver el Lock Actual

```bash
# En PostgreSQL
SELECT * FROM instance_locks;
```

### Health Check con Info de Lock

```bash
curl https://tu-app.onrender.com/health
```

Respuesta:
```json
{
  "status": "OK",
  "whatsapp_ready": true,
  "instance_lock": {
    "has_lock": true,
    "current_lock": {
      "instance_id": "render-abc123-1234567890",
      "locked_at": "2025-10-18T04:26:44.000Z",
      "last_heartbeat": "2025-10-18T04:27:14.000Z",
      "is_this_instance": true
    }
  }
}
```

## 🚨 Situaciones de Error

### 1. No puede adquirir el lock

**Síntoma**: Error en logs: `Could not acquire instance lock - another instance is active`

**Causa**: Otra instancia tiene el lock activo

**Solución**: 
- Espera 2-3 minutos (la instancia anterior se liberará)
- O ejecuta manualmente: `DELETE FROM instance_locks;`

### 2. Lock perdido durante ejecución

**Síntoma**: Log `INSTANCE LOCK PERDIDO` + WhatsApp se cierra

**Causa**: Otra instancia más nueva tomó el control

**Solución**: Es el comportamiento esperado. Render reiniciará esta instancia.

### 3. Múltiples instancias activas

**Síntoma**: Logs de diferentes instance_id apareciendo simultáneamente

**Causa**: Configuración incorrecta de Render

**Solución**:
1. Verifica `render.yaml` tenga `numInstances: 1`
2. En Render Dashboard → Settings → verifica "Auto-Deploy" estrategia
3. Manualmente: para todos los servicios excepto uno

## 🔒 Seguridad

- ✅ Lock se libera automáticamente en SIGTERM/SIGINT
- ✅ Locks huérfanos se limpian automáticamente (>2 min sin heartbeat)
- ✅ Previene race conditions con `ON CONFLICT DO NOTHING`
- ✅ No bloquea otros servicios (solo afecta a WhatsApp)

## 📝 Configuración en `render.yaml`

```yaml
services:
  - type: web
    name: capri-store-backend
    numInstances: 1  # ← MUY IMPORTANTE: Solo 1 instancia
    healthCheckPath: /health
    startTimeout: 120  # Dar tiempo para adquirir lock
```

## 🧪 Testing Local

En desarrollo local (sin DATABASE_URL), el lock se desactiva automáticamente:

```javascript
if (!process.env.DATABASE_URL) {
  // Lock deshabilitado - siempre permitir en local
  this.isLocked = true;
  return true;
}
```

## 📌 Resumen

| Concepto | Descripción |
|----------|-------------|
| **Lock Key** | `whatsapp_instance_lock` (solo uno para toda la app) |
| **Timeout adquisición** | 60 segundos |
| **Heartbeat** | Cada 30 segundos |
| **Expiración** | 2 minutos sin heartbeat |
| **Instancias permitidas** | 1 (la que tiene el lock) |

## 🆘 Comandos de Emergencia

```sql
-- Ver lock actual
SELECT * FROM instance_locks;

-- Forzar liberación del lock
DELETE FROM instance_locks WHERE lock_key = 'whatsapp_instance_lock';

-- Ver historial de locks (si guardas logs)
SELECT instance_id, locked_at, last_heartbeat,
       (NOW() - last_heartbeat) as time_since_heartbeat
FROM instance_locks
ORDER BY locked_at DESC;
```

---

**Autor**: Sistema de Instance Lock v1.0  
**Fecha**: Octubre 2025  
**Objetivo**: Prevenir instancias múltiples de WhatsApp en deploys
