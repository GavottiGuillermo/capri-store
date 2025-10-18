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
    console.log('🔍 CONSTRUCTOR: Pool objeto disponible:', !!this.pool);
    console.log('🔍 CONSTRUCTOR: ClientId configurado:', this.clientId);
  }

  async sessionExists(options = {}) {
    try {
      console.log('🔍 SESSION EXISTS: Verificando si existe sesión en PostgreSQL...');
      console.log('🔍 SESSION EXISTS: Buscando clientId:', this.clientId);
      const query = 'SELECT id FROM whatsapp_sessions WHERE id = $1';
      const result = await this.pool.query(query, [this.clientId]);
      
      console.log('📊 SESSION EXISTS: Query result rows:', result.rows.length);
      
      const exists = result.rows.length > 0;
      console.log(`📊 SESSION EXISTS: Sesión existe: ${exists ? '✅ SÍ' : '❌ NO'}`);
      return exists;
    } catch (error) {
      console.error('❌ SESSION EXISTS ERROR:', error.message);
      console.error('❌ SESSION EXISTS STACK:', error.stack);
      return false;
    }
  }

  async save(options = {}) {
    try {
      const sessionData = options.session;
      console.log('💾 ============ SAVE LLAMADO ============');
      console.log('💾 Tipo de options:', typeof options);
      console.log('💾 Keys en options:', Object.keys(options));
      console.log('💾 Tipo de session:', typeof sessionData);
      
      if (typeof sessionData === 'string') {
        console.log('💾 Session es STRING, tamaño:', sessionData.length, 'chars');
        console.log('💾 Primeros 200 chars:', sessionData.substring(0, 200));
      } else if (typeof sessionData === 'object') {
        console.log('💾 Session es OBJECT, keys:', Object.keys(sessionData));
        const jsonStr = JSON.stringify(sessionData);
        console.log('💾 Session JSON size:', jsonStr.length, 'chars');
        console.log('💾 Primeros 200 chars:', jsonStr.substring(0, 200));
      }
      
      const query = `
        INSERT INTO whatsapp_sessions (id, session_data, created_at, updated_at) 
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id) 
        DO UPDATE SET 
          session_data = EXCLUDED.session_data,
          updated_at = CURRENT_TIMESTAMP
      `;
      
      await this.pool.query(query, [this.clientId, sessionData]);
      console.log('✅ Sesión guardada exitosamente en PostgreSQL store');
      console.log('💾 ========================================');
      return true;
    } catch (error) {
      console.error('❌ Error guardando sesión en store:', error.message);
      console.error('❌ Stack completo:', error.stack);
      return false;
    }
  }

  async extract(options = {}) {
    try {
      console.log('� EXTRACT LLAMADO: RemoteAuth está intentando cargar sesión');
      console.log('�📥 ✅ Sesión cargada desde PostgreSQL exitosamente');
      console.log('📥 Extrayendo sesión desde PostgreSQL...');
      const query = 'SELECT session_data FROM whatsapp_sessions WHERE id = $1';
      console.log('🔍 EXTRACT: Ejecutando query para clientId:', this.clientId);
      const result = await this.pool.query(query, [this.clientId]);
      
      console.log('📊 EXTRACT: Query result rows:', result.rows.length);
      
      if (result.rows.length > 0) {
        const sessionData = result.rows[0].session_data;
        console.log('✅ EXTRACT: Sesión recuperada desde PostgreSQL store');
        console.log('📊 EXTRACT: Datos de sesión disponibles para restaurar conexión');
        console.log('📊 EXTRACT: Tipo de dato:', typeof sessionData);
        console.log('📊 EXTRACT: Es string?', typeof sessionData === 'string');
        console.log('📊 EXTRACT: Tamaño:', sessionData ? sessionData.length : 0, 'chars');
        return sessionData;
      } else {
        console.log('📭 EXTRACT: No se encontró sesión en PostgreSQL store');
        return null;
      }
    } catch (error) {
      console.error('❌ EXTRACT ERROR:', error.message);
      console.error('❌ EXTRACT STACK:', error.stack);
      return null;
    }
  }

  async delete(options = {}) {
    try {
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
    // Configurar conexión a PostgreSQL
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    const clientId = options.clientId || 'default';
    const store = new PostgreSQLStore(pool, clientId);
    
    // Configurar RemoteAuth con store personalizado
    const remoteAuthOptions = {
      store: store,
      backupSyncIntervalMs: 120000, // 2 minutos para pruebas más rápidas
      dataPath: options.dataPath || './temp-auth/'
    };
    
    super(remoteAuthOptions);
    
    this.clientId = clientId;
    this.dataPath = options.dataPath || './';
    this.pool = pool;
    this.store = store;
    
    console.log('📦 PostgresAuthStrategy inicializado para cliente:', this.clientId);
    console.log('⏰ Intervalo de sincronización: 2 minutos');
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