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

// ===============================
// FORMATO DE ENTRADA DE productos.json
// ===============================
// Formato viejo (el que tienen hoy las 45 entradas publicadas): una entrada por id_articulo,
//   { categoria, carpeta: "74-Body trikini", imagen: "...jpg", txt: "...txt" }
// Formato nuevo (agrupado): una entrada por PRENDA, con varias imágenes por color,
//   { ...lo anterior..., producto, prenda, color, colores: [{ color, ids, imagenes: [...] }] }
//
// El campo `carpeta` MANTIENE el prefijo "{id}-" a propósito: main.js y detalle.js derivan el
// id_articulo parseando /(\d+)-[^/]+/ sobre la URL (marcado de agotados, resolución del detalle).
// Por eso el formato nuevo es un superconjunto del viejo y los lectores viejos siguen andando.

// Convierte un color a un fragmento de nombre de archivo seguro ("Beige Oscuro" -> "beige-oscuro").
function slugify(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-color';
}

// Devuelve una entrada de productos.json en forma canónica, venga del formato viejo o del nuevo.
// Las entradas viejas se exponen como un único color sin nombre con su imagen suelta, así el
// resto del código puede tratar a todas por igual (siempre hay `colores` con al menos un item).
function normalizeProductoEntry(node) {
  if (!node || typeof node !== 'object') return null;

  const carpeta = String(node.carpeta || '');
  const idMatch = carpeta.match(/^(\d+)-(.*)$/);
  const idPrincipal = idMatch ? parseInt(idMatch[1], 10) : null;
  // El nombre del producto: preferir el campo explícito; si no, derivarlo de la carpeta.
  const producto = node.producto || node.prenda || (idMatch ? idMatch[2] : carpeta);

  let colores;
  if (Array.isArray(node.colores) && node.colores.length > 0) {
    colores = node.colores.map(c => ({
      color: c.color || '',
      ids: Array.isArray(c.ids) ? c.ids.map(Number).filter(Number.isInteger) : [],
      imagenes: Array.isArray(c.imagenes) ? c.imagenes.filter(Boolean) : (c.imagen ? [c.imagen] : [])
    }));
  } else {
    colores = [{
      color: node.color || '',
      ids: idPrincipal !== null ? [idPrincipal] : [],
      imagenes: node.imagen ? [node.imagen] : []
    }];
  }

  const portada = node.imagen || (colores[0] && colores[0].imagenes[0]) || '';

  return {
    producto,
    categoria: node.categoria || '',
    carpeta,
    idPrincipal,
    txt: node.txt || '',
    imagen: portada,
    colores,
    // Todos los id_articulo que cubre esta tarjeta (uno por unidad física publicada).
    ids: colores.reduce((acc, c) => acc.concat(c.ids), [])
  };
}

// Arma el objeto que se guarda en productos.json. Mantiene los campos del formato viejo
// (categoria/carpeta/imagen/txt) para no romper lectores que no conozcan `colores`.
function buildProductoEntry({ producto, categoria, carpeta, txt, colores }) {
  const listaColores = (colores || []).map(c => ({
    color: c.color || '',
    ids: Array.isArray(c.ids) ? c.ids : [],
    imagenes: Array.isArray(c.imagenes) ? c.imagenes : []
  }));
  const primero = listaColores[0] || { color: '', imagenes: [] };
  return {
    categoria,
    carpeta,
    imagen: primero.imagenes[0] || '',
    txt,
    producto,
    // `prenda`/`color` describen la portada: los usa cargarImagenesPorColor() de detalle.js.
    prenda: producto,
    color: primero.color,
    colores: listaColores
  };
}

// Busca la entrada que cubre un id_articulo, sea porque es el id principal de la carpeta
// (formato viejo) o porque figura en alguno de sus colores (formato nuevo agrupado).
function findEntryIndexByArticuloId(productos, idArticulo) {
  const idStr = String(idArticulo);
  return productos.findIndex(p => {
    if (String(p.carpeta || '').startsWith(`${idStr}-`)) return true;
    const normalizado = normalizeProductoEntry(p);
    return normalizado ? normalizado.ids.includes(Number(idArticulo)) : false;
  });
}

// Busca la entrada de una prenda por nombre (para agrupar al publicar).
function findEntryIndexByProducto(productos, producto) {
  const objetivo = String(producto || '').trim().toLowerCase();
  return productos.findIndex(p => {
    const normalizado = normalizeProductoEntry(p);
    return normalizado && String(normalizado.producto || '').trim().toLowerCase() === objetivo;
  });
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
  normalizeTextField,
  slugify,
  normalizeProductoEntry,
  buildProductoEntry,
  findEntryIndexByArticuloId,
  findEntryIndexByProducto
};
