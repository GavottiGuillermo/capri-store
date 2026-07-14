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
    const idStr = String(idArticulo);
    const node = productos.find(p => String(p.carpeta || '').startsWith(`${idStr}-`));
    if (!node) {
      return res.status(404).json({ success: false, error: 'El artículo no está publicado en la web' });
    }

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
      prenda: node.prenda || '',
      color: node.color || ''
    });
  } catch (error) {
    console.error('❌ Error leyendo datos del artículo web:', error.message);
    res.status(500).json({ success: false, error: 'Error al leer datos del artículo desde GCS' });
  }
});

// === GENERAR Y SUBIR ARTÍCULO (equivalente a generarYSubirArticulo) ===
// Una llamada = un color (una carpeta). Para varios colores de la misma prenda, el operador
// repite la carga una vez por color, tal como el desktop pide una imagen por color seleccionado.
router.post('/generar', requireGcs, requireDb, upload.single('imagen'), async (req, res) => {
  try {
    const ids = parseIdsField(req.body.ids);
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe indicar al menos un id_articulo' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Debe adjuntar una imagen' });
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
    const color = result.rows[0].color || 'SinColor';
    if (result.rows.some(r => r.prenda !== prenda)) {
      return res.status(400).json({ success: false, error: 'Todos los artículos seleccionados deben ser de la misma prenda' });
    }
    if (result.rows.some(r => (r.color || 'SinColor') !== color)) {
      return res.status(400).json({ success: false, error: 'Todos los artículos seleccionados deben ser del mismo color' });
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

    if (precio > 0) {
      await db.pool.query(
        `UPDATE ${db.PRODUCTOS_TABLE} SET precio_venta_transferencia = $1 WHERE id_articulo = ANY($2::int[])`,
        [precio, ids]
      );
    }

    const idColor = ids[0];
    const nombreBase = `${idColor}-${prenda.replace(/ /g, '-')}-${color.replace(/ /g, '-')}`;
    const rutaCarpeta = `Novedades/${nombreBase}/`;

    const contenidoTxt = gcs.buildTxtContent({ titulo, texto, precio, detalle });
    const urlTxt = await gcs.uploadBuffer(`${rutaCarpeta}${nombreBase}.txt`, Buffer.from(contenidoTxt, 'utf8'), 'text/plain; charset=utf-8');

    const extension = extensionFor(req.file);
    const urlImagen = await gcs.uploadBuffer(`${rutaCarpeta}${nombreBase}${extension}`, req.file.buffer, req.file.mimetype);

    const productos = await gcs.getProductosJson();
    const indiceExistente = productos.findIndex(p => p.carpeta === nombreBase);
    const nuevoProducto = { categoria, carpeta: nombreBase, imagen: urlImagen, txt: urlTxt, prenda, color };
    if (indiceExistente >= 0) {
      productos[indiceExistente] = nuevoProducto;
    } else {
      productos.push(nuevoProducto);
    }
    await gcs.saveProductosJson(productos);

    await db.pool.query(
      `UPDATE ${db.PRODUCTOS_TABLE} SET publicado_en_web = 'True' WHERE id_articulo = ANY($1::int[])`,
      [ids]
    );

    res.json({ success: true, carpeta: nombreBase, imagen: urlImagen, txt: urlTxt });
  } catch (error) {
    console.error('❌ Error generando/subiendo artículo web:', error.message);
    res.status(500).json({ success: false, error: 'Error al generar y subir el artículo' });
  }
});

// === MODIFICAR ARTÍCULO YA PUBLICADO (equivalente a modificarArticuloEnWeb) ===
router.put('/:idArticulo', requireGcs, requireDb, upload.single('imagen'), async (req, res) => {
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
    const idStr = String(idArticulo);
    const indiceExistente = productos.findIndex(p => String(p.carpeta || '').startsWith(`${idStr}-`));
    if (indiceExistente === -1) {
      return res.status(404).json({ success: false, error: 'El artículo no está publicado en la web' });
    }
    const node = productos[indiceExistente];
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

    // 2. Si hay nueva imagen, reemplazar la anterior
    let urlImagenFinal = node.imagen || '';
    if (req.file) {
      const rutaImgAntigua = gcs.pathFromPublicUrl(urlImagenFinal);
      if (rutaImgAntigua) {
        await gcs.deleteFile(rutaImgAntigua);
      }
      const extension = extensionFor(req.file);
      urlImagenFinal = await gcs.uploadBuffer(`${rutaCarpeta}${carpeta}${extension}`, req.file.buffer, req.file.mimetype);
    }

    // 3. Actualizar productos.json
    productos[indiceExistente] = {
      ...node,
      categoria,
      imagen: urlImagenFinal,
      txt: gcs.publicUrlFor(rutaTxt)
    };
    await gcs.saveProductosJson(productos);

    // 4. Actualizar precio en BBDD
    await db.pool.query(
      `UPDATE ${db.PRODUCTOS_TABLE} SET precio_venta_transferencia = $1 WHERE id_articulo = $2`,
      [precio, idArticulo]
    );

    res.json({ success: true, carpeta, imagen: urlImagenFinal });
  } catch (error) {
    console.error('❌ Error modificando artículo web:', error.message);
    res.status(500).json({ success: false, error: 'Error al modificar el artículo' });
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

      const idStr = String(id);
      const node = productos.find(p => String(p.carpeta || '').startsWith(`${idStr}-`));
      if (!node) {
        omitidos.push({ id, motivo: 'Sin entrada en productos.json' });
        continue;
      }

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
