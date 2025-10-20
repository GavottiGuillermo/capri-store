/**
 * Sistema de bloqueo de instancia (Singleton Lock)
 * Previene que múltiples deploys de Render ejecuten WhatsApp simultáneamente
 */

const { Pool } = require('pg');

class InstanceLock {
  constructor() {
    this.pool = null;
    this.instanceId = `${process.env.RENDER_INSTANCE_ID || 'local'}-${Date.now()}`;
    this.lockKey = 'whatsapp_instance_lock';
    this.heartbeatInterval = null;
    this.isLocked = false;
    
    console.log(`🔐 InstanceLock creado - ID: ${this.instanceId}`);
  }

  async initialize() {
    if (!process.env.DATABASE_URL) {
      console.log('⚠️ DATABASE_URL no configurado - Lock deshabilitado (modo local)');
      this.isLocked = true; // En local, siempre permitir
      return true;
    }

    try {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        },
        max: 2, // Solo 2 conexiones para el lock
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
      });

      console.log('🔐 Pool de conexiones para InstanceLock creado');
      
      // Crear tabla de locks si no existe
      await this.createLockTable();
      
      return true;
    } catch (error) {
      console.error('❌ Error inicializando InstanceLock:', error.message);
      return false;
    }
  }

  async createLockTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS instance_locks (
        lock_key VARCHAR(255) PRIMARY KEY,
        instance_id VARCHAR(255) NOT NULL,
        locked_at TIMESTAMP NOT NULL,
        last_heartbeat TIMESTAMP NOT NULL,
        metadata JSONB
      );
      
      CREATE INDEX IF NOT EXISTS idx_locks_heartbeat 
      ON instance_locks(last_heartbeat);
    `;

    try {
      await this.pool.query(query);
      console.log('✅ Tabla instance_locks verificada/creada');
    } catch (error) {
      console.error('❌ Error creando tabla de locks:', error.message);
      throw error;
    }
  }

  async acquireLock(timeout = 60000) { // Aumentado a 60s para dar tiempo suficiente
    if (!this.pool) {
      console.log('⚠️ Pool no inicializado - asumiendo lock local');
      this.isLocked = true;
      return true;
    }

    const startTime = Date.now();
    let attempt = 0;
    
    while (Date.now() - startTime < timeout) {
      attempt++;
      
      try {
        // Limpiar locks antiguos más agresivamente
        const cleaned = await this.cleanStaleLocks();
        
        // Intentar adquirir el lock
        const acquired = await this.tryAcquireLock();
        
        if (acquired) {
          this.isLocked = true;
          console.log(`✅ Lock adquirido por ${this.instanceId}`);
          
          // Iniciar heartbeat cada 30 segundos
          this.startHeartbeat();
          console.log(`✅ Lock adquirido - Esta es la ÚNICA instancia activa de WhatsApp`);
          
          return true;
        }
        
        // Mostrar progreso cada 5 intentos
        if (attempt % 5 === 0) {
          const currentLock = await this.getCurrentLock();
          if (currentLock) {
            const timeSinceHeartbeat = Date.now() - new Date(currentLock.last_heartbeat).getTime();
            console.log(`⏳ Lock ocupado por ${currentLock.instance_id} (heartbeat hace ${Math.round(timeSinceHeartbeat/1000)}s)`);
          } else {
            console.log('⏳ Lock ocupado, esperando...');
          }
        } else {
          console.log('⏳ Lock ocupado, esperando...');
        }
        
        // Esperar menos tiempo para responder más rápido
        await new Promise(resolve => setTimeout(resolve, 1500));
        
      } catch (error) {
        console.error('❌ Error adquiriendo lock:', error.message);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.error('❌ Timeout adquiriendo lock');
    console.error('❌ No se pudo adquirir el lock - otra instancia está activa');
    console.error('💡 Si esto persiste, verifica que no haya deploys múltiples en Render');
    return false;
  }

  async tryAcquireLock() {
    const query = `
      INSERT INTO instance_locks (lock_key, instance_id, locked_at, last_heartbeat, metadata)
      VALUES ($1, $2, NOW(), NOW(), $3)
      ON CONFLICT (lock_key) DO NOTHING
      RETURNING *;
    `;
    
    const metadata = {
      render_instance: process.env.RENDER_INSTANCE_ID || 'local',
      node_version: process.version,
      started_at: new Date().toISOString()
    };

    try {
      const result = await this.pool.query(query, [
        this.lockKey,
        this.instanceId,
        JSON.stringify(metadata)
      ]);
      
      return result.rowCount > 0;
    } catch (error) {
      console.error('❌ Error en tryAcquireLock:', error.message);
      return false;
    }
  }

  async cleanStaleLocks() {
    // Limpiar locks más agresivamente para transiciones rápidas de Render
    // 75 segundos (2.5 x heartbeat interval) - más agresivo para deploys
    const query = `
      DELETE FROM instance_locks
      WHERE lock_key = $1
        AND last_heartbeat < NOW() - INTERVAL '75 seconds';
    `;

    try {
      const result = await this.pool.query(query, [this.lockKey]);
      
      if (result.rowCount > 0) {
        console.log(`🧹 Limpiados ${result.rowCount} locks antiguos`);
      }
      
      return result.rowCount;
    } catch (error) {
      console.error('❌ Error limpiando locks antiguos:', error.message);
      return 0;
    }
  }

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.updateHeartbeat();
      } catch (error) {
        console.error('❌ Error en heartbeat del lock:', error.message);
      }
    }, 30000); // 30 segundos

    console.log('💓 Heartbeat del lock iniciado (cada 30s)');
  }

  async updateHeartbeat() {
    if (!this.pool || !this.isLocked) return;

    const query = `
      UPDATE instance_locks
      SET last_heartbeat = NOW()
      WHERE lock_key = $1 AND instance_id = $2
      RETURNING *;
    `;

    try {
      const result = await this.pool.query(query, [this.lockKey, this.instanceId]);
      
      if (result.rowCount === 0) {
        console.error('⚠️ Lock perdido - otra instancia tomó el control');
        this.isLocked = false;
        
        // Detener heartbeat
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }
        
        // Señal crítica: debemos cerrar WhatsApp
        process.emit('instanceLockLost');
      } else {
        console.log('💓 Heartbeat del lock actualizado');
      }
    } catch (error) {
      console.error('❌ Error actualizando heartbeat:', error.message);
    }
  }

  async releaseLock() {
    if (!this.pool || !this.isLocked) {
      console.log('ℹ️ No hay lock para liberar');
      return;
    }

    // Detener heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    const query = `
      DELETE FROM instance_locks
      WHERE lock_key = $1 AND instance_id = $2;
    `;

    try {
      await this.pool.query(query, [this.lockKey, this.instanceId]);
      console.log(`✅ Lock liberado por ${this.instanceId}`);
      this.isLocked = false;
    } catch (error) {
      console.error('❌ Error liberando lock:', error.message);
    }
  }

  async getCurrentLock() {
    if (!this.pool) return null;

    const query = `
      SELECT * FROM instance_locks
      WHERE lock_key = $1;
    `;

    try {
      const result = await this.pool.query(query, [this.lockKey]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Error obteniendo lock actual:', error.message);
      return null;
    }
  }

  async cleanup() {
    await this.releaseLock();
    
    if (this.pool) {
      await this.pool.end();
      console.log('🔐 Pool de InstanceLock cerrado');
    }
  }
}

module.exports = InstanceLock;
