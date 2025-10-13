const { RemoteAuth } = require('whatsapp-web.js');
const { Pool } = require('pg');

/**
 * Estrategia de autenticación remota usando PostgreSQL
 * Permite persistir la sesión de WhatsApp en la base de datos
 */
class PostgresAuthStrategy extends RemoteAuth {
  constructor(options = {}) {
    // RemoteAuth requiere backupSyncIntervalMs mínimo de 60000ms (1 minuto)
    const remoteAuthOptions = {
      ...options,
      backupSyncIntervalMs: 300000, // 5 minutos
      dataPath: options.dataPath || './temp-auth/'
    };
    
    super(remoteAuthOptions);
    
    this.clientId = options.clientId || 'default';
    this.dataPath = options.dataPath || './';
    
    // Configurar conexión a PostgreSQL usando variables de entorno
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
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
    
    try {
      const query = 'DELETE FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      console.log(`✅ Sesión eliminada. Filas afectadas: ${result.rowCount}`);
      return true;
    } catch (error) {
      console.error('❌ Error eliminando sesión:', error.message);
      return false;
    }
  }

  async destroy() {
    console.log('🔚 Cerrando conexión PostgreSQL...');
    await this.pool.end();
  }

  async getSessionData() {
    console.log('📥 Obteniendo datos de sesión desde PostgreSQL...');
    
    try {
      const query = 'SELECT session_data FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      
      if (result.rows.length > 0) {
        const sessionData = result.rows[0].session_data;
        console.log('✅ Datos de sesión encontrados en PostgreSQL');
        return sessionData;
      } else {
        console.log('📭 No se encontraron datos de sesión en PostgreSQL');
        return null;
      }
    } catch (error) {
      console.error('❌ Error obteniendo datos de sesión:', error.message);
      return null;
    }
  }

  async setSessionData(sessionData) {
    console.log('💾 Guardando datos de sesión en PostgreSQL...');
    
    try {
      const query = `
        INSERT INTO whatsapp_sessions (id, session_data, created_at, updated_at) 
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id) 
        DO UPDATE SET 
          session_data = EXCLUDED.session_data,
          updated_at = CURRENT_TIMESTAMP
      `;
      
      const result = await this.pool.query(query, [this.clientId, sessionData]);
      console.log('✅ Datos de sesión guardados en PostgreSQL');
      return true;
    } catch (error) {
      console.error('❌ Error guardando datos de sesión:', error.message);
      return false;
    }
  }

  async getSessionDataPath() {
    // Esta función se mantiene para compatibilidad pero no se usa con PostgreSQL
    return `${this.dataPath}session-${this.clientId}`;
  }
}

module.exports = PostgresAuthStrategy;