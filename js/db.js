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
  get pool() {
    return pool;
  }
};
