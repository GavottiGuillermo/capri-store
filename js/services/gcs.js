const { Storage } = require('@google-cloud/storage');

// ===============================
// CONFIGURACIÓN DE GOOGLE CLOUD STORAGE
// ===============================
// El mismo bucket que usa la app de escritorio Java (Controlador_Pestanias.java).
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'imagenes-web-capri';
const PUBLIC_URL_PREFIX = `https://storage.googleapis.com/${BUCKET_NAME}/`;
const PRODUCTOS_JSON_PATH = 'productos.json';

let storage = null;

if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    storage = new Storage({ credentials, projectId: credentials.project_id });
  } catch (error) {
    console.error('❌ GOOGLE_APPLICATION_CREDENTIALS_JSON inválido:', error.message);
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Modo local: variable estándar de Google apuntando a un archivo de credenciales.
  storage = new Storage();
} else {
  console.error('❌ GCS no configurado - faltan GOOGLE_APPLICATION_CREDENTIALS_JSON o GOOGLE_APPLICATION_CREDENTIALS');
}

function isConfigured() {
  return storage !== null;
}

function getBucket() {
  if (!storage) {
    throw new Error('Google Cloud Storage no está configurado');
  }
  return storage.bucket(BUCKET_NAME);
}

function publicUrlFor(destPath) {
  return `${PUBLIC_URL_PREFIX}${destPath}`;
}

// Extrae el path relativo al bucket a partir de una URL pública guardada en productos.json.
function pathFromPublicUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return url.startsWith(PUBLIC_URL_PREFIX) ? url.slice(PUBLIC_URL_PREFIX.length) : null;
}

async function uploadBuffer(destPath, buffer, contentType) {
  const bucket = getBucket();
  const file = bucket.file(destPath);
  await file.save(buffer, { contentType: contentType || 'application/octet-stream' });
  return publicUrlFor(destPath);
}

// Borrado best-effort: si el archivo no existe, no es un error (igual que el catch-ignored del Java).
async function deleteFile(destPath) {
  try {
    await getBucket().file(destPath).delete();
  } catch (error) {
    if (error.code !== 404) {
      console.error(`⚠️ No se pudo borrar ${destPath} de GCS:`, error.message);
    }
  }
}

// Borra todos los blobs bajo un prefijo (una carpeta completa), best-effort igual que deleteFile.
async function deleteFolder(prefix) {
  try {
    await getBucket().deleteFiles({ prefix, force: true });
  } catch (error) {
    console.error(`⚠️ No se pudo borrar la carpeta ${prefix} de GCS:`, error.message);
  }
}

async function readTextFile(destPath) {
  try {
    const [contents] = await getBucket().file(destPath).download();
    return contents.toString('utf8');
  } catch (error) {
    if (error.code === 404) return null;
    throw error;
  }
}

async function getProductosJson() {
  const contenido = await readTextFile(PRODUCTOS_JSON_PATH);
  if (!contenido) return [];
  const parsed = JSON.parse(contenido);
  return Array.isArray(parsed) ? parsed : [];
}

async function saveProductosJson(productos) {
  const bucket = getBucket();
  await bucket.file(PRODUCTOS_JSON_PATH).save(JSON.stringify(productos), {
    contentType: 'application/json; charset=utf-8'
  });
}

// Formato del .txt de catálogo (sin talle, ver CLAUDE.md): 4 líneas {titulo}\n{texto}\n{precio}\n{detalle}
function buildTxtContent({ titulo, texto, precio, detalle }) {
  return `{${titulo}}\n{${texto}}\n{${precio}}\n{${detalle}}`;
}

// Réplica de leerDatosTxtDesdeCloud: soporta el formato viejo (5 líneas, con talle) y el nuevo (4 líneas).
function parseTxtContent(contenido) {
  const lineas = String(contenido || '').split('\n');
  const strip = (s) => (s || '').replace(/^\{|\}$/g, '');

  if (lineas.length >= 5) {
    return {
      titulo: strip(lineas[0]),
      texto: strip(lineas[1]),
      precio: strip(lineas[2]),
      detalle: strip(lineas[4])
    };
  }
  return {
    titulo: lineas.length > 0 ? strip(lineas[0]) : 'null',
    texto: lineas.length > 1 ? strip(lineas[1]) : 'null',
    precio: lineas.length > 2 ? strip(lineas[2]) : '0',
    detalle: lineas.length > 3 ? strip(lineas[3]) : 'null'
  };
}

// Normaliza un campo de texto libre al mismo criterio que el Java: vacío -> literal "null".
function normalizeTextField(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? 'null' : trimmed;
}

module.exports = {
  BUCKET_NAME,
  PUBLIC_URL_PREFIX,
  PRODUCTOS_JSON_PATH,
  isConfigured,
  publicUrlFor,
  pathFromPublicUrl,
  uploadBuffer,
  deleteFile,
  deleteFolder,
  readTextFile,
  getProductosJson,
  saveProductosJson,
  buildTxtContent,
  parseTxtContent,
  normalizeTextField
};
