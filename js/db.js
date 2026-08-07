const { Pool } = require('pg');

const DEFAULT_DB_SCHEMA = process.env.DB_SCHEMA || 'public';

function sanitizeIdentifier(value, fallback) {
  const fallbackIdentifier = fallback || 'public';
  if (!value || typeof value !== 'string') {
    return fallbackIdentifier;
  }
  const trimmed = value.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_]/g, '');
  return safe || fallbackIdentifier;
}

const DB_SCHEMA = sanitizeIdentifier(DEFAULT_DB_SCHEMA, 'public');

function qualifyTable(tableName) {
  const safeTable = sanitizeIdentifier(tableName, tableName);
  return `"${DB_SCHEMA}"."${safeTable}"`;
}

const PRODUCTOS_TABLE = qualifyTable('productos');
// Tabla propia de la web (no existe del lado Java): guarda el detalle de cada devolución
// para poder mostrarlo en Cash Flow, ya que sp_devolver_articulo borra el pago asociado
// sin dejar rastro de qué se devolvió ni por qué monto.
const DEVOLUCIONES_TABLE = qualifyTable('devoluciones_web');

// Optional DB pool (may remain null en modo stateless)
let pool = null;

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('No DATABASE_URL configured');
  }

  console.log('🔌 Inicializando conexión a PostgreSQL...');
  console.log('🏷️ Esquema PostgreSQL seleccionado:', DB_SCHEMA);
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Necesario para Render/Neon
    },
    max: 20, // máximo 20 conexiones
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  console.log('✅ Conexión PostgreSQL establecida');
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${DEVOLUCIONES_TABLE} (
      id SERIAL PRIMARY KEY,
      id_articulo INTEGER NOT NULL,
      prenda VARCHAR(255),
      color VARCHAR(255),
      talle VARCHAR(255),
      monto DOUBLE PRECISION,
      metodo_pago VARCHAR(50),
      nombre_cliente VARCHAR(255),
      fecha_devolucion DATE NOT NULL DEFAULT CURRENT_DATE,
      creado_en TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  client.release();

  return pool;
}

// Reintenta consultas a PostgreSQL con backoff incremental
async function executeQueryWithRetry(poolInstance, query, params = [], maxRetries = 3, baseDelayMs = 500) {
  if (!poolInstance) {
    throw new Error('Pool de base de datos no inicializado');
  }

  const attempts = Math.max(1, maxRetries);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await poolInstance.query(query, params);
    } catch (error) {
      lastError = error;
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] ❌ Query falló (intento ${attempt}/${attempts}): ${error.message}`);
      if (attempt === attempts) {
        throw error;
      }
      const delayMs = baseDelayMs * attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('executeQueryWithRetry terminó sin resultado ni error');
}

function normalizePaymentId(rawId) {
  if (rawId === undefined || rawId === null) {
    return null;
  }
  const str = String(rawId).trim();
  if (!str) {
    return null;
  }
  const matches = str.match(/\d+/g);
  if (matches && matches.length > 0) {
    return matches[matches.length - 1];
  }
  return str;
}

function buildPaymentIdContext(rawId) {
  const normalized = normalizePaymentId(rawId);
  if (!normalized) {
    return { normalized: null, sdkId: null, dbParams: [] };
  }
  const numericValue = Number(normalized);
  const numeric = Number.isNaN(numericValue) ? null : numericValue;
  return {
    normalized,
    sdkId: numeric ?? normalized,
    dbParams: [normalized, numeric ?? normalized]
  };
}

module.exports = {
  initializeDatabase,
  executeQueryWithRetry,
  sanitizeIdentifier,
  qualifyTable,
  normalizePaymentId,
  buildPaymentIdContext,
  DB_SCHEMA,
  PRODUCTOS_TABLE,
  DEVOLUCIONES_TABLE,
  get pool() {
    return pool;
  }
};
