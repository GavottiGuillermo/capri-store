const { RemoteAuth } = require('whatsapp-web.js');
const { Pool } = require('pg');

// FORCE DEPLOY: Fixed extract() method for PostgreSQL session recovery - v2.1

/**
 * Store personalizado para PostgreSQL que implementa la interfaz requerida por RemoteAuth
 */
class PostgreSQLStore {
  constructor(pool, clientId) {
    this.pool = pool;
    this.clientId = clientId;
    console.log(`📦 PostgreSQLStore inicializado para cliente: ${clientId}`);
  }

  async sessionExists(options = {}) {
    try {
      console.log('🔍 Verificando si existe sesión en PostgreSQL...');
      const query = 'SELECT id FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      
      const exists = result.rows.length > 0;
      console.log(`📊 Sesión existe: ${exists ? '✅ SÍ' : '❌ NO'}`);
      return exists;
    } catch (error) {
      console.error('❌ Error verificando sesión:', error.message);
      return false;
    }
  }

  async save(options = {}) {
    try {
      console.log('💾 Guardando sesión en PostgreSQL...');
      
      const sessionName = options.session;
      if (!sessionName) {
        console.error('❌ No session name provided');
        return false;
      }
      
      // Leer archivo ZIP creado por RemoteAuth
      const fs = require('fs');
      const zipPath = `${sessionName}.zip`;
      let dataToSave = null;
      
      try {
        if (fs.existsSync(zipPath)) {
          const zipBuffer = fs.readFileSync(zipPath);
          const zipBase64 = zipBuffer.toString('base64');
          console.log('💾 ZIP leído, tamaño:', Math.round(zipBase64.length / 1024), 'KB');
          dataToSave = zipBase64;
        } else {
          console.log('⚠️ No se encontró archivo ZIP en:', zipPath);
          return false;
        }
      } catch (readError) {
        console.error('❌ Error leyendo ZIP:', readError.message);
        return false;
      }
      
      if (!dataToSave) {
        console.error('❌ No hay datos para guardar');
        return false;
      }
      
      const query = `
        INSERT INTO whatsapp_sessions (id, session_data, created_at, updated_at) 
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id) 
        DO UPDATE SET 
          session_data = EXCLUDED.session_data,
          updated_at = CURRENT_TIMESTAMP
      `;
      
      await this.pool.query(query, [this.clientId, dataToSave]);
      console.log('✅ Sesión guardada exitosamente en PostgreSQL');
      return true;
    } catch (error) {
      console.error('❌ Error guardando sesión:', error.message);
      return false;
    }
  }

  async extract(options = {}) {
    try {
      if (this.pool.ended) {
        console.log('⚠️ Pool PostgreSQL ya cerrado, no se puede cargar sesión');
        return null;
      }
      
      console.log('📥 Cargando sesión desde PostgreSQL...');
      
      const sessionName = options.session;
      const zipPath = options.path;
      
      const query = 'SELECT session_data FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      
      if (result.rows.length > 0) {
        const sessionData = result.rows[0].session_data;
        const sizeKB = Math.round(sessionData.length / 1024);
        console.log(`✅ Sesión recuperada desde PostgreSQL (${sizeKB} KB)`);
        
        // Si RemoteAuth nos pasó un path, escribir el archivo ZIP
        if (zipPath && sessionData) {
          try {
            const fs = require('fs');
            console.log('📄 Escribiendo archivo ZIP...');
            
            const zipBuffer = Buffer.from(sessionData, 'base64');
            fs.writeFileSync(zipPath, zipBuffer);
            
            console.log('✅ Archivo ZIP creado exitosamente');
            return true; // RemoteAuth espera true cuando hay path
          } catch (writeError) {
            console.error('❌ Error escribiendo archivo ZIP:', writeError.message);
            return false;
          }
        }
        
        return sessionData;
      } else {
        console.log('📭 No se encontró sesión en PostgreSQL');
        return null;
      }
    } catch (error) {
      console.error('❌ Error cargando sesión:', error.message);
      return null;
    }
  }

  async delete(options = {}) {
    try {
      if (this.pool.ended) {
        console.log('⚠️ Pool PostgreSQL ya cerrado, no se puede eliminar sesión');
        return false;
      }
      
      console.log('🗑️ Eliminando sesión de PostgreSQL...');
      const query = 'DELETE FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      console.log(`✅ Sesión eliminada. Filas afectadas: ${result.rowCount}`);
      return true;
    } catch (error) {
      console.error('❌ Error eliminando sesión del store:', error.message);
      return false;
    }
  }
}

/**
 * Estrategia de autenticación remota usando PostgreSQL
 * Implementa RemoteAuth con store personalizado para persistencia real
 */
class PostgresAuthStrategy extends RemoteAuth {
  constructor(options = {}) {
    // Validar que options existe y tiene clientId
    if (!options || typeof options !== 'object') {
      throw new Error('PostgresAuthStrategy: options debe ser un objeto');
    }
    
    if (!options.clientId || typeof options.clientId !== 'string') {
      throw new Error('PostgresAuthStrategy: clientId es requerido y debe ser string');
    }
    
    // Validar DATABASE_URL
    if (!process.env.DATABASE_URL) {
      throw new Error('PostgresAuthStrategy: DATABASE_URL no está configurado');
    }
    
    // Configurar conexión a PostgreSQL
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    const clientId = options.clientId;
    const store = new PostgreSQLStore(pool, clientId);
    
    // Validar que dataPath existe
    const dataPath = options.dataPath || './temp-auth/';
    if (!dataPath || typeof dataPath !== 'string') {
      throw new Error('PostgresAuthStrategy: dataPath inválido');
    }
    
    // Configurar RemoteAuth con store personalizado
    const remoteAuthOptions = {
      store: store,
      backupSyncIntervalMs: 120000, // 2 minutos para pruebas más rápidas
      dataPath: dataPath
    };
    
    super(remoteAuthOptions);
    
    this.clientId = clientId;
    this.dataPath = dataPath;
    this.pool = pool;
    this.store = store;
    
    console.log('📦 PostgresAuthStrategy inicializado para cliente:', this.clientId);
    console.log('📁 Data path:', this.dataPath);
    console.log('⏰ Intervalo de sincronización: 2 minutos');
  }

  async beforeBrowserInitialized() {
    console.log('🔧 Inicializando estrategia de autenticación PostgreSQL...');
    
    // CRÍTICO: Llamar al método de la clase padre PRIMERO
    // Esto configura this.sessionName y otras propiedades
    await super.beforeBrowserInitialized();
    
    try {
      // Verificar conexión a la base de datos
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('✅ Conexión a PostgreSQL establecida');
      console.log('📝 Session name configurado:', this.sessionName);
    } catch (error) {
      console.error('❌ Error conectando a PostgreSQL:', error.message);
      throw error;
    }
  }

  async logout() {
    console.log('🗑️ Eliminando datos de sesión de PostgreSQL...');
    console.log('📍 Stack trace de quien llamó logout():');
    console.trace();
    return await this.store.delete({});
  }

  async clearSessionOnly() {
    console.log('🧹 Limpiando solo datos de sesión (manteniendo pool activo)...');
    console.log('📍 Stack trace de quien llamó clearSessionOnly():');
    console.trace();
    return await this.store.delete({});
  }

  async destroy() {
    // No cerrar el pool durante regeneración de QR - se reutilizará
    console.log('🔚 destroy() llamado - Manteniendo pool activo para regeneración');
    // El pool se cerrará solo cuando termine el proceso Node.js
  }
  
  async forceDestroy() {
    // Solo para cierre final del servidor
    console.log('🔚 Cerrando conexión PostgreSQL forzosamente...');
    try {
      if (!this.pool.ended) {
        await this.pool.end();
        console.log('✅ Pool PostgreSQL cerrado correctamente');
      } else {
        console.log('⚠️ Pool PostgreSQL ya estaba cerrado');
      }
    } catch (error) {
      console.error('❌ Error cerrando pool PostgreSQL:', error.message);
    }
  }
}

module.exports = PostgresAuthStrategy;
