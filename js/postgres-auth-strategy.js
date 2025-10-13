const { RemoteAuth } = require('whatsapp-web.js');
const { Pool } = require('pg');

/**
 * Store personalizado para PostgreSQL
 */
class PostgreSQLStore {
  constructor(pool, clientId) {
    this.pool = pool;
    this.clientId = clientId;
  }

  async sessionExists(options) {
    try {
      const query = 'SELECT id FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Error verificando existencia de sesión:', error.message);
      return false;
    }
  }

  async save(options) {
    try {
      const sessionData = options.session;
      const query = `
        INSERT INTO whatsapp_sessions (id, session_data, created_at, updated_at) 
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id) 
        DO UPDATE SET 
          session_data = EXCLUDED.session_data,
          updated_at = CURRENT_TIMESTAMP
      `;
      
      await this.pool.query(query, [this.clientId, sessionData]);
      console.log('✅ Sesión guardada en PostgreSQL store');
      return true;
    } catch (error) {
      console.error('❌ Error guardando sesión en store:', error.message);
      return false;
    }
  }

  async extract(options) {
    try {
      const query = 'SELECT session_data FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      
      if (result.rows.length > 0) {
        console.log('✅ Sesión extraída de PostgreSQL store');
        return result.rows[0].session_data;
      } else {
        console.log('📭 No se encontró sesión en PostgreSQL store');
        return null;
      }
    } catch (error) {
      console.error('❌ Error extrayendo sesión del store:', error.message);
      return null;
    }
  }

  async delete(options) {
    try {
      const query = 'DELETE FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      console.log(`✅ Sesión eliminada del store. Filas afectadas: ${result.rowCount}`);
      return true;
    } catch (error) {
      console.error('❌ Error eliminando sesión del store:', error.message);
      return false;
    }
  }
}

/**
 * Estrategia de autenticación remota usando PostgreSQL
 * Permite persistir la sesión de WhatsApp en la base de datos
 */
class PostgresAuthStrategy extends RemoteAuth {
  constructor(options = {}) {
    // Configurar conexión a PostgreSQL usando variables de entorno
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    const clientId = options.clientId || 'default';
    const store = new PostgreSQLStore(pool, clientId);
    
    // RemoteAuth requiere backupSyncIntervalMs mínimo de 60000ms (1 minuto) y un store
    const remoteAuthOptions = {
      store: store,
      backupSyncIntervalMs: 300000, // 5 minutos
      dataPath: options.dataPath || './temp-auth/'
    };
    
    super(remoteAuthOptions);
    
    this.clientId = clientId;
    this.dataPath = options.dataPath || './';
    this.pool = pool;
    this.store = store;
    
    console.log('📦 PostgresAuthStrategy inicializado para cliente:', this.clientId);
  }

  async beforeBrowserInitialized() {
    console.log('🔧 Inicializando estrategia de autenticación PostgreSQL...');
    
    try {
      // Verificar conexión a la base de datos
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('✅ Conexión a PostgreSQL establecida');
    } catch (error) {
      console.error('❌ Error conectando a PostgreSQL:', error.message);
      throw error;
    }
  }

  async logout() {
    console.log('🗑️ Eliminando datos de sesión de PostgreSQL...');
    return await this.store.delete({});
  }

  async destroy() {
    console.log('🔚 Cerrando conexión PostgreSQL...');
    await this.pool.end();
  }
}

module.exports = PostgresAuthStrategy;