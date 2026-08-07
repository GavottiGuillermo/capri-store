const express = require('express');
const multer = require('multer');
const path = require('path');

const db = require('../../db');
const gcs = require('../../services/gcs');

const router = express.Router();

// req.body queda undefined si el request no trae un Content-Type que algún parser reconozca
// (ni JSON, ni urlencoded, ni multipart) - normalizamos para no reventar con "reading 'x' of undefined".
router.use((req, res, next) => {
  req.body = req.body || {};
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB, igual de holgado que la carga manual del desktop
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('El archivo debe ser una imagen'));
    }
    cb(null, true);
  }
});

function requireGcs(req, res, next) {
  if (!gcs.isConfigured()) {
    return res.status(503).json({ success: false, error: 'Google Cloud Storage no está configurado' });
  }
  next();
}

function requireDb(req, res, next) {
  if (!db.pool) {
    return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
  }
  next();
}

function parseIdsField(raw) {
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isInteger);
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isInteger) : [];
  } catch {
    return raw.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isInteger);
  }
}

function extensionFor(file) {
  const fromName = path.extname(file.originalname || '');
  if (fromName) return fromName;
  const byMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/webp': '.webp' };
  return byMime[file.mimetype] || '.jpg';
}

function resolveCategoria(categoriaRaw, novedad) {
  let categoria = gcs.normalizeTextField(categoriaRaw);
  if (novedad && !categoria.endsWith('-Novedad')) {
    categoria += '-Novedad';
  }
  return categoria;
}

function parsePrecio(precioRaw) {
  const precio = parseInt(precioRaw, 10);
  if (precioRaw !== undefined && precioRaw !== null && precioRaw !== '' && Number.isNaN(precio)) {
    return { error: 'El precio debe ser un número válido' };
  }
  return { value: Number.isNaN(precio) ? 0 : precio };
}

function isNovedadFlag(raw) {
  return raw === true || raw === 'true' || raw === '1' || raw === 'on';
}

// Agrupa filas de productos por color preservando el orden de aparición.
// Cada grupo junta las unidades físicas (ids) que comparten color, que son las que van a
// compartir las mismas fotos en la tarjeta web.
function agruparIdsPorColor(rows) {
  const grupos = new Map();
  rows.forEach(row => {
    const color = row.color || '';
    if (!grupos.has(color)) grupos.set(color, { color, ids: [] });
    grupos.get(color).ids.push(row.id_articulo);
  });
  return Array.from(grupos.values());
}

// Agrupa los archivos subidos por NOMBRE DE COLOR.
// El cliente manda `ordenColores` (JSON con los nombres) y nombra cada archivo `img_<indice>`;
// así el criterio de slug para el nombre del blob vive solo del lado servidor y no hay riesgo
// de que cliente y servidor calculen slugs distintos. Se aceptan además `img_<slug>` y el
// `imagen` suelto del formulario anterior por compatibilidad.
function agruparArchivosPorColor(files, ordenColoresRaw, coloresDisponibles) {
  let ordenColores = [];
  try {
    const parsed = typeof ordenColoresRaw === 'string' ? JSON.parse(ordenColoresRaw) : ordenColoresRaw;
    if (Array.isArray(parsed)) ordenColores = parsed.map(c => String(c));
  } catch { /* sin orden explícito: se resuelve por slug o por color único */ }

  const porColor = new Map();
  const agregar = (color, file) => {
    if (color === null || color === undefined) return;
    if (!porColor.has(color)) porColor.set(color, []);
    porColor.get(color).push(file);
  };

  (files || []).forEach(file => {
    const nombre = file.fieldname || '';
    if (nombre === 'imagen') {
      agregar(coloresDisponibles[0], file);
      return;
    }
    const sufijo = nombre.replace(/^img_/, '');
    if (/^\d+$/.test(sufijo)) {
      agregar(ordenColores[parseInt(sufijo, 10)], file);
      return;
    }
    const porSlug = coloresDisponibles.find(c => gcs.slugify(c) === sufijo);
    if (porSlug !== undefined) agregar(porSlug, file);
  });

  return porColor;
}

// Sube la lista de archivos de un color y devuelve sus URLs públicas, borrando las anteriores.
async function reemplazarImagenesDeColor(rutaCarpeta, color, archivos, imagenesPrevias) {
  for (const urlPrevia of imagenesPrevias || []) {
    const ruta = gcs.pathFromPublicUrl(urlPrevia);
    if (ruta) await gcs.deleteFile(ruta);
  }
  const slug = gcs.slugify(color);
  const urls = [];
  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    const destino = `${rutaCarpeta}${slug}-${i + 1}${extensionFor(archivo)}`;
    urls.push(await gcs.uploadBuffer(destino, archivo.buffer, archivo.mimetype));
  }
  return urls;
}

// === LISTADO DE PRODUCTOS DISPONIBLES (equivalente a obtenerProductosDesdeBD) ===
router.get('/productos', requireDb, async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT id_articulo, prenda, estado, categoria, color, talle,
             precio_venta_efectivo, precio_venta_transferencia, publicado_en_web
      FROM ${db.PRODUCTOS_TABLE}
      WHERE estado = 'Disponible'
      ORDER BY id_articulo ASC
    `);
    res.json({ success: true, productos: result.rows });
  } catch (error) {
    console.error('❌ Error listando productos para panel web:', error.message);
    res.status(500).json({ success: false, error: 'Error al consultar productos' });
  }
});

// === DATOS ACTUALES DE UN ARTÍCULO PUBLICADO (equivalente a leerDatosTxtDesdeCloud) ===
router.get('/:idArticulo', requireGcs, async (req, res) => {
  const idArticulo = parseInt(req.params.idArticulo, 10);
  if (!Number.isInteger(idArticulo)) {
    return res.status(400).json({ success: false, error: 'ID de artículo inválido' });
  }

  try {
    const productos = await gcs.getProductosJson();
    const indice = gcs.findEntryIndexByArticuloId(productos, idArticulo);
    if (indice === -1) {
      return res.status(404).json({ success: false, error: 'El artículo no está publicado en la web' });
    }
    const node = gcs.normalizeProductoEntry(productos[indice]);

    const rutaTxt = `Novedades/${node.carpeta}/${node.carpeta}.txt`;
    const contenidoTxt = await gcs.readTextFile(rutaTxt);
    if (!contenidoTxt) {
      return res.status(404).json({ success: false, error: 'No se encontró el .txt del artículo en GCS' });
    }
    const datos = gcs.parseTxtContent(contenidoTxt);

    res.json({
      success: true,
      carpeta: node.carpeta,
      titulo: datos.titulo,
      texto: datos.texto,
      precio: datos.precio,
      detalle: datos.detalle,
      categoria: node.categoria || '',
      imagen: node.imagen || '',
      prenda: node.producto || '',
      producto: node.producto || '',
      // Detalle por color: cada uno con sus fotos y las unidades físicas que cubre.
      colores: node.colores.map(c => ({ color: c.color, ids: c.ids, imagenes: c.imagenes })),
      color: node.colores[0]?.color || ''
    });
  } catch (error) {
    console.error('❌ Error leyendo datos del artículo web:', error.message);
    res.status(500).json({ success: false, error: 'Error al leer datos del artículo desde GCS' });
  }
});

// === GENERAR Y SUBIR ARTÍCULO (equivalente a generarYSubirArticulo) ===
// Una llamada = UNA PRENDA con todos sus colores (antes era una llamada = un color). La tarjeta
// del catálogo pasó a estar indexada por prenda, así que publicar varios colores juntos es lo que
// evita las tarjetas duplicadas que había con el esquema anterior (una entrada por id_articulo).
//
// Las imágenes llegan como archivos con fieldname `img_<colorSlug>`; varios archivos pueden
// compartir el mismo fieldname y ese es justamente el caso de "varias fotos del mismo color".
// Si se republica una prenda: los colores para los que se suben fotos nuevas se reemplazan
// (borrando las anteriores de GCS) y los colores que no traen archivos conservan las que tenían.
router.post('/generar', requireGcs, requireDb, upload.any(), async (req, res) => {
  try {
    const ids = parseIdsField(req.body.ids);
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe indicar al menos un id_articulo' });
    }

    const result = await db.pool.query(
      `SELECT id_articulo, prenda, color, estado FROM ${db.PRODUCTOS_TABLE} WHERE id_articulo = ANY($1::int[])`,
      [ids]
    );
    if (result.rows.length !== ids.length) {
      return res.status(400).json({ success: false, error: 'Alguno de los id_articulo no existe' });
    }
    if (result.rows.some(r => r.estado !== 'Disponible')) {
      return res.status(400).json({ success: false, error: 'Todos los artículos deben estar en estado Disponible' });
    }
    const prenda = result.rows[0].prenda;
    if (result.rows.some(r => r.prenda !== prenda)) {
      return res.status(400).json({ success: false, error: 'Todos los artículos seleccionados deben ser de la misma prenda' });
    }

    const precioResult = parsePrecio(req.body.precio);
    if (precioResult.error) {
      return res.status(400).json({ success: false, error: precioResult.error });
    }
    const precio = precioResult.value;

    const titulo = gcs.normalizeTextField(req.body.titulo);
    const texto = gcs.normalizeTextField(req.body.texto);
    const detalle = gcs.normalizeTextField(req.body.detalle);
    const categoria = resolveCategoria(req.body.categoria, isNovedadFlag(req.body.novedad));

    // Agrupar los ids seleccionados por color (cada color = un grupo de unidades físicas).
    const coloresSeleccionados = agruparIdsPorColor(result.rows);
    const archivosPorColor = agruparArchivosPorColor(
      req.files,
      req.body.ordenColores,
      coloresSeleccionados.map(g => g.color)
    );

    const productos = await gcs.getProductosJson();
    // Reusar la carpeta si esta prenda ya estaba publicada, para no invalidar URLs vigentes.
    const indiceExistente = gcs.findEntryIndexByProducto(productos, prenda);
    const entradaExistente = indiceExistente >= 0 ? gcs.normalizeProductoEntry(productos[indiceExistente]) : null;
    const idPrincipal = entradaExistente?.idPrincipal ?? Math.min(...ids);
    const nombreBase = entradaExistente?.carpeta || `${idPrincipal}-${prenda.trim()}`;
    const rutaCarpeta = `Novedades/${nombreBase}/`;

    // Cada color necesita al menos una imagen: nueva o preexistente de una publicación anterior.
    const coloresFinales = [];
    for (const grupo of coloresSeleccionados) {
      const slug = gcs.slugify(grupo.color);
      const archivos = archivosPorColor.get(grupo.color) || [];
      const previo = entradaExistente?.colores.find(c => gcs.slugify(c.color) === slug);

      if (archivos.length === 0 && (!previo || previo.imagenes.length === 0)) {
        return res.status(400).json({
          success: false,
          error: `Falta la imagen del color "${grupo.color || 'sin color'}"`
        });
      }

      const imagenes = archivos.length > 0
        ? await reemplazarImagenesDeColor(rutaCarpeta, grupo.color, archivos, previo?.imagenes)
        : previo.imagenes;

      coloresFinales.push({ color: grupo.color, ids: grupo.ids, imagenes });
    }

    // Conservar colores ya publicados que no vinieron en esta selección (publicación incremental).
    const slugsNuevos = new Set(coloresFinales.map(c => gcs.slugify(c.color)));
    for (const previo of entradaExistente?.colores || []) {
      if (!slugsNuevos.has(gcs.slugify(previo.color)) && previo.imagenes.length > 0) {
        coloresFinales.push(previo);
      }
    }

    if (precio > 0) {
      await db.pool.query(
        `UPDATE ${db.PRODUCTOS_TABLE} SET precio_venta_transferencia = $1 WHERE id_articulo = ANY($2::int[])`,
        [precio, ids]
      );
    }

    const contenidoTxt = gcs.buildTxtContent({ titulo, texto, precio, detalle });
    const urlTxt = await gcs.uploadBuffer(`${rutaCarpeta}${nombreBase}.txt`, Buffer.from(contenidoTxt, 'utf8'), 'text/plain; charset=utf-8');

    const nuevaEntrada = gcs.buildProductoEntry({
      producto: prenda,
      categoria,
      carpeta: nombreBase,
      txt: urlTxt,
      colores: coloresFinales
    });
    if (indiceExistente >= 0) {
      productos[indiceExistente] = nuevaEntrada;
    } else {
      productos.push(nuevaEntrada);
    }
    await gcs.saveProductosJson(productos);

    await db.pool.query(
      `UPDATE ${db.PRODUCTOS_TABLE} SET publicado_en_web = 'True' WHERE id_articulo = ANY($1::int[])`,
      [ids]
    );

    res.json({
      success: true,
      carpeta: nombreBase,
      txt: urlTxt,
      colores: coloresFinales.map(c => ({ color: c.color, imagenes: c.imagenes.length }))
    });
  } catch (error) {
    console.error('❌ Error generando/subiendo artículo web:', error.message);
    res.status(500).json({ success: false, error: 'Error al generar y subir el artículo' });
  }
});

// === MODIFICAR ARTÍCULO YA PUBLICADO (equivalente a modificarArticuloEnWeb) ===
// La tarjeta representa una prenda completa, así que el título/texto/precio/detalle que se editan
// acá aplican a toda la tarjeta y el precio se propaga a TODAS las unidades que cubre (antes solo
// tocaba el id puntual, algo que con la tarjeta agrupada dejaría precios distintos en una misma
// tarjeta). Las fotos se reemplazan por color, igual que en /generar.
router.put('/:idArticulo', requireGcs, requireDb, upload.any(), async (req, res) => {
  const idArticulo = parseInt(req.params.idArticulo, 10);
  if (!Number.isInteger(idArticulo)) {
    return res.status(400).json({ success: false, error: 'ID de artículo inválido' });
  }

  try {
    const productoResult = await db.pool.query(
      `SELECT id_articulo, estado FROM ${db.PRODUCTOS_TABLE} WHERE id_articulo = $1`,
      [idArticulo]
    );
    if (productoResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
    }
    if (productoResult.rows[0].estado !== 'Disponible') {
      return res.status(400).json({ success: false, error: 'El artículo debe estar en estado Disponible' });
    }

    const precioResult = parsePrecio(req.body.precio);
    if (precioResult.error || !req.body.precio) {
      return res.status(400).json({ success: false, error: precioResult.error || 'El precio no puede estar vacío' });
    }
    const precio = precioResult.value;

    const productos = await gcs.getProductosJson();
    const indiceExistente = gcs.findEntryIndexByArticuloId(productos, idArticulo);
    if (indiceExistente === -1) {
      return res.status(404).json({ success: false, error: 'El artículo no está publicado en la web' });
    }
    const node = gcs.normalizeProductoEntry(productos[indiceExistente]);
    const carpeta = node.carpeta;
    const rutaCarpeta = `Novedades/${carpeta}/`;

    const titulo = gcs.normalizeTextField(req.body.titulo);
    const texto = gcs.normalizeTextField(req.body.texto);
    const detalle = gcs.normalizeTextField(req.body.detalle);
    const categoria = resolveCategoria(req.body.categoria, isNovedadFlag(req.body.novedad));

    // 1. Actualizar el .txt
    const contenidoTxt = gcs.buildTxtContent({ titulo, texto, precio, detalle });
    const rutaTxt = `${rutaCarpeta}${carpeta}.txt`;
    await gcs.uploadBuffer(rutaTxt, Buffer.from(contenidoTxt, 'utf8'), 'text/plain; charset=utf-8');

    // 2. Reemplazar las fotos de los colores para los que se subieron archivos nuevos.
    const archivosPorColor = agruparArchivosPorColor(
      req.files,
      req.body.ordenColores,
      node.colores.map(c => c.color)
    );

    const coloresFinales = [];
    for (const previo of node.colores) {
      const archivos = archivosPorColor.get(previo.color) || [];
      if (archivos.length === 0) {
        coloresFinales.push(previo);
        continue;
      }
      const imagenes = await reemplazarImagenesDeColor(rutaCarpeta, previo.color, archivos, previo.imagenes);
      coloresFinales.push({ ...previo, imagenes });
    }

    // 3. Actualizar productos.json
    productos[indiceExistente] = gcs.buildProductoEntry({
      producto: node.producto,
      categoria,
      carpeta,
      txt: gcs.publicUrlFor(rutaTxt),
      colores: coloresFinales
    });
    await gcs.saveProductosJson(productos);

    // 4. Actualizar precio en BBDD para todas las unidades de la tarjeta
    const idsTarjeta = coloresFinales.reduce((acc, c) => acc.concat(c.ids), []);
    const idsAActualizar = idsTarjeta.length > 0 ? idsTarjeta : [idArticulo];
    await db.pool.query(
      `UPDATE ${db.PRODUCTOS_TABLE} SET precio_venta_transferencia = $1 WHERE id_articulo = ANY($2::int[])`,
      [precio, idsAActualizar]
    );

    res.json({
      success: true,
      carpeta,
      colores: coloresFinales.map(c => ({ color: c.color, imagenes: c.imagenes.length }))
    });
  } catch (error) {
    console.error('❌ Error modificando artículo web:', error.message);
    res.status(500).json({ success: false, error: 'Error al modificar el artículo' });
  }
});

// === QUITAR ARTÍCULO DE LA WEB (equivalente a quitarDeLaWeb) ===
// Como la carpeta y las fotos ahora son de toda la prenda, quitar la tarjeta desmarca
// publicado_en_web de TODAS las unidades que cubría. Esto corrige de paso la limitación que
// arrastraba del desktop: antes borraba la carpeta compartida pero desmarcaba un solo id,
// dejando las otras unidades marcadas como publicadas sin imagen que las respaldara.
router.delete('/:idArticulo', requireGcs, requireDb, async (req, res) => {
  const idArticulo = parseInt(req.params.idArticulo, 10);
  if (!Number.isInteger(idArticulo)) {
    return res.status(400).json({ success: false, error: 'ID de artículo inválido' });
  }

  try {
    const productos = await gcs.getProductosJson();
    const indiceExistente = gcs.findEntryIndexByArticuloId(productos, idArticulo);
    if (indiceExistente === -1) {
      return res.status(404).json({ success: false, error: 'El artículo no está publicado en la web' });
    }
    const node = gcs.normalizeProductoEntry(productos[indiceExistente]);
    const carpeta = node.carpeta;
    const idsAfectados = node.ids.length > 0 ? node.ids : [idArticulo];

    productos.splice(indiceExistente, 1);
    await gcs.saveProductosJson(productos);
    await gcs.deleteFolder(`Novedades/${carpeta}/`);

    await db.pool.query(
      `UPDATE ${db.PRODUCTOS_TABLE} SET publicado_en_web = 'False' WHERE id_articulo = ANY($1::int[])`,
      [idsAfectados]
    );

    res.json({ success: true, carpeta, ids: idsAfectados });
  } catch (error) {
    console.error('❌ Error quitando artículo de la web:', error.message);
    res.status(500).json({ success: false, error: 'Error al quitar el artículo de la web' });
  }
});

// === AJUSTE PORCENTUAL DE PRECIOS (equivalente a aplicarAjustePorcentualEnWeb) ===
router.post('/ajuste-porcentual', express.json(), requireGcs, requireDb, async (req, res) => {
  try {
    const ids = parseIdsField(req.body.ids);
    const porcentaje = Number(req.body.porcentaje);

    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe indicar al menos un id_articulo' });
    }
    if (!Number.isFinite(porcentaje) || porcentaje === 0) {
      return res.status(400).json({ success: false, error: 'El porcentaje debe ser un número distinto de 0' });
    }

    const result = await db.pool.query(
      `SELECT id_articulo, precio_venta_transferencia FROM ${db.PRODUCTOS_TABLE}
       WHERE id_articulo = ANY($1::int[]) AND publicado_en_web = 'True'`,
      [ids]
    );
    const encontrados = new Map(result.rows.map(r => [r.id_articulo, Number(r.precio_venta_transferencia)]));

    const productos = await gcs.getProductosJson();
    const actualizados = [];
    const omitidos = [];

    for (const id of ids) {
      const precioActual = encontrados.get(id);
      if (precioActual === undefined) {
        omitidos.push({ id, motivo: 'No encontrado o no publicado en la web' });
        continue;
      }

      const indiceNode = gcs.findEntryIndexByArticuloId(productos, id);
      if (indiceNode === -1) {
        omitidos.push({ id, motivo: 'Sin entrada en productos.json' });
        continue;
      }
      const node = gcs.normalizeProductoEntry(productos[indiceNode]);

      const rutaTxt = `Novedades/${node.carpeta}/${node.carpeta}.txt`;
      const contenidoActual = await gcs.readTextFile(rutaTxt);
      if (!contenidoActual) {
        omitidos.push({ id, motivo: 'No se encontró el .txt en GCS' });
        continue;
      }

      const datos = gcs.parseTxtContent(contenidoActual);
      let nuevoPrecio = Math.round(precioActual * (1 + porcentaje / 100));
      if (nuevoPrecio <= 0) nuevoPrecio = 1;

      const nuevoContenido = gcs.buildTxtContent({
        titulo: datos.titulo,
        texto: datos.texto,
        precio: nuevoPrecio,
        detalle: datos.detalle
      });
      await gcs.uploadBuffer(rutaTxt, Buffer.from(nuevoContenido, 'utf8'), 'text/plain; charset=utf-8');
      await db.pool.query(
        `UPDATE ${db.PRODUCTOS_TABLE} SET precio_venta_transferencia = $1 WHERE id_articulo = $2`,
        [nuevoPrecio, id]
      );

      actualizados.push({ id, precio_anterior: precioActual, precio_nuevo: nuevoPrecio });
    }

    res.json({ success: true, actualizados, omitidos });
  } catch (error) {
    console.error('❌ Error aplicando ajuste porcentual:', error.message);
    res.status(500).json({ success: false, error: 'Error al aplicar el ajuste porcentual' });
  }
});

// Errores de multer (tamaño/tipo de archivo) no deben devolver la página HTML de error por defecto.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || /imagen/i.test(err?.message || '')) {
    return res.status(400).json({ success: false, error: err.message || 'Error al procesar el archivo' });
  }
  console.error('❌ Error inesperado en articulos-web:', err.message);
  res.status(500).json({ success: false, error: 'Error interno del servidor' });
});

module.exports = router;
