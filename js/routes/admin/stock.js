const express = require('express');

const db = require('../../db');
const gcs = require('../../services/gcs');
const variantes = require('../../services/variantes');
const catalogos = require('../../services/catalogos');

const router = express.Router();

// req.body queda undefined si el request no trae un Content-Type que algún parser reconozca.
router.use((req, res, next) => {
  req.body = req.body || {};
  next();
});

function requireDb(req, res, next) {
  if (!db.pool) {
    return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
  }
  next();
}

function toNumber(raw, fieldLabel) {
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n)) {
    return { error: `El campo '${fieldLabel}' debe ser un número válido` };
  }
  return { value: n };
}

// === LISTADO DE STOCK (equivalente a cargarDatosDesdeBBDD, usa el mismo SP que la pestaña Ventas) ===
router.get('/', requireDb, async (req, res) => {
  try {
    const result = await db.pool.query('SELECT * FROM sp_consultar_listado_ventas()');
    res.json({ success: true, productos: result.rows });
  } catch (error) {
    console.error('❌ Error listando stock:', error.message);
    res.status(500).json({ success: false, error: 'Error al consultar el stock' });
  }
});

// === CARGA MANUAL DE LOTE + PRODUCTOS (equivalente a insertarLoteYProductos) ===
// Un lote agrupa uno o más productos (unidades físicas, cada una con su propio talle/color,
// igual que hoy en `productos`). El desktop arma un producto a la vez en una tabla en memoria
// y recién inserta todo junto al finalizar; acá el cliente manda la lista completa de una.
router.post('/lotes', express.json(), requireDb, async (req, res) => {
  try {
    const { observacion, inversor, productos } = req.body;

    if (!observacion || !String(observacion).trim()) {
      return res.status(400).json({ success: false, error: "El campo 'Observación' es obligatorio" });
    }
    if (!inversor || !String(inversor).trim()) {
      return res.status(400).json({ success: false, error: "El campo 'Inversor' es obligatorio" });
    }
    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe incluir al menos un producto' });
    }

    const productosLimpios = [];
    let costoLote = 0;

    for (let i = 0; i < productos.length; i++) {
      const p = productos[i] || {};
      const prenda = String(p.prenda || '').trim();
      const categoria = String(p.categoria || '').trim();
      const color = String(p.color || '').trim();
      const talle = String(p.talle || '').trim();

      if (!prenda || !categoria || !color || !talle) {
        return res.status(400).json({ success: false, error: `Producto #${i + 1}: prenda, categoría, color y talle son obligatorios` });
      }

      // La categoría es un catálogo cerrado: es lo que evita que vuelvan a aparecer variantes del
      // mismo concepto ('Parte de arriba' / 'Arriba' / 'Top'). Se guarda el valor canónico.
      const categoriaCanonica = catalogos.normalizarCategoria(categoria);
      if (!categoriaCanonica) {
        return res.status(400).json({
          success: false,
          error: `Producto #${i + 1}: la categoría "${categoria}" no es válida. Opciones: ${catalogos.etiquetasCategorias()}`
        });
      }

      // Normalizar antes de insertar para no seguir ensuciando la tabla: la carga manual del
      // desktop dejó 'm' junto a 'M', 'u' junto a 'unico' y colores con espacios al final, y el
      // agrupado de variantes de la tienda compara strings exactos.
      const colorNormalizado = variantes.normalizarColor(color);
      const talleNormalizado = variantes.normalizarTalle(talle);

      const precioCompra = toNumber(p.precio_compra, 'Precio de compra');
      if (precioCompra.error) {
        return res.status(400).json({ success: false, error: `Producto #${i + 1}: ${precioCompra.error}` });
      }
      const precioVentaTransferencia = toNumber(p.precio_venta_transferencia, 'Precio de venta');
      if (precioVentaTransferencia.error) {
        return res.status(400).json({ success: false, error: `Producto #${i + 1}: ${precioVentaTransferencia.error}` });
      }
      if (precioVentaTransferencia.value < precioCompra.value) {
        return res.status(400).json({ success: false, error: `Producto #${i + 1}: el precio de venta no puede ser menor al precio de compra` });
      }

      // 10% de descuento por pago en efectivo, mismo cálculo que agregarProducto() en el desktop.
      const precioVentaEfectivo = Math.round(precioVentaTransferencia.value * 0.9 * 100) / 100;

      // `cantidad` permite mandar N unidades idénticas en un solo item (la matriz de variantes
      // del panel manda una celda color × talle × cantidad). Cada unidad sigue siendo su propia
      // fila en `productos`, igual que en el desktop: acá solo se expande.
      const cantidadRaw = p.cantidad === undefined ? 1 : p.cantidad;
      const cantidad = Number(cantidadRaw);
      if (!Number.isInteger(cantidad) || cantidad < 1) {
        return res.status(400).json({ success: false, error: `Producto #${i + 1}: la cantidad debe ser un entero mayor o igual a 1` });
      }

      for (let u = 0; u < cantidad; u++) {
        costoLote += precioCompra.value;
        productosLimpios.push({
          estado: 'Disponible',
          prenda,
          categoria: categoriaCanonica,
          color: colorNormalizado,
          talle: talleNormalizado,
          precio_compra: precioCompra.value,
          precio_venta_efectivo: precioVentaEfectivo,
          precio_venta_transferencia: precioVentaTransferencia.value
        });
      }
    }

    // El SP recibe el costo total del lote (suma de precio_compra) + observación + inversor + productos en JSON.
    // Nota: el parámetro de la SP se llama "in_local" pero el desktop lo etiqueta "Observación" en el form
    // (inconsistencia preexistente en Controlador_Pestanias.java, se preserva tal cual para no romper el dato ya cargado).
    await db.pool.query(
      'CALL sp_inserta_lote_y_productos($1, $2, $3, $4)',
      [costoLote, observacion.trim(), inversor.trim(), JSON.stringify(productosLimpios)]
    );

    res.json({ success: true, cantidad: productosLimpios.length, costo_lote: costoLote });
  } catch (error) {
    console.error('❌ Error insertando lote y productos:', error.message);
    res.status(500).json({ success: false, error: 'Error al cargar el lote' });
  }
});

// === ELIMINAR ARTÍCULOS DE LA BASE ===
// Borrado definitivo de unidades físicas (mercadería que no se va a vender más, cargas
// equivocadas, etc.). El desktop hace esto con `sp_eliminar_registro`, un DELETE genérico por
// interpolación de strings y sin ninguna validación; acá se usa SQL parametrizado y se agregan
// las guardas que faltaban, porque la tabla `productos` NO tiene claves foráneas: la base no
// impide borrar algo que está referenciado y el dato se pierde en silencio.
//
// Se omite (no se borra) y se informa el motivo cuando:
//  - el artículo está vendido (`id_pago`): borrarlo dejaría el pago sin detalle de qué se vendió
//    y rompería el desglose del Cash Flow. El camino correcto es Devolución y después eliminar.
//  - el artículo está tomado por un pedido web (`id_pedido`): hay un checkout en curso.
// Igual que el ajuste porcentual, procesa lo que puede y reporta lo omitido en vez de fallar todo.
router.post('/eliminar', express.json(), requireDb, async (req, res) => {
  try {
    const idsRaw = Array.isArray(req.body.ids) ? req.body.ids : [];
    const ids = Array.from(new Set(idsRaw.map(Number).filter(Number.isInteger)));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe indicar al menos un artículo a eliminar' });
    }

    const result = await db.pool.query(
      `SELECT id_articulo, prenda, color, talle, estado, id_pago, id_pedido
       FROM ${db.PRODUCTOS_TABLE} WHERE id_articulo = ANY($1::int[])`,
      [ids]
    );
    const encontrados = new Map(result.rows.map(r => [r.id_articulo, r]));

    const aEliminar = [];
    const omitidos = [];
    for (const id of ids) {
      const fila = encontrados.get(id);
      if (!fila) {
        omitidos.push({ id, motivo: 'No existe' });
      } else if (fila.id_pago !== null && fila.id_pago !== undefined) {
        omitidos.push({ id, motivo: 'Está vendido. Hacé la Devolución primero y después eliminalo.' });
      } else if (fila.id_pedido !== null && fila.id_pedido !== undefined) {
        omitidos.push({ id, motivo: 'Está tomado por un pedido web en curso' });
      } else {
        aEliminar.push(fila);
      }
    }

    if (aEliminar.length === 0) {
      return res.json({ success: true, eliminados: [], omitidos });
    }

    const idsBorrados = aEliminar.map(f => f.id_articulo);
    await db.pool.query(
      `DELETE FROM ${db.PRODUCTOS_TABLE} WHERE id_articulo = ANY($1::int[])`,
      [idsBorrados]
    );

    // Sacar las unidades borradas de la tienda: si la tarjeta se queda sin ninguna unidad, se
    // elimina junto con su carpeta de GCS; si le quedan otras, se actualiza conservando el resto.
    let tarjetasQuitadas = 0;
    if (gcs.isConfigured()) {
      try {
        const productosJson = await gcs.getProductosJson();
        let cambio = false;
        for (const id of idsBorrados) {
          const indice = gcs.findEntryIndexByArticuloId(productosJson, id);
          if (indice === -1) continue;
          const entrada = gcs.normalizeProductoEntry(productosJson[indice]);
          const colores = entrada.colores
            .map(c => ({ ...c, ids: c.ids.filter(x => x !== id) }))
            .filter(c => c.ids.length > 0);

          if (colores.length === 0) {
            productosJson.splice(indice, 1);
            await gcs.deleteFolder(`Novedades/${entrada.carpeta}/`);
            tarjetasQuitadas++;
          } else {
            productosJson[indice] = gcs.buildProductoEntry({
              producto: entrada.producto,
              categoria: entrada.categoria,
              carpeta: entrada.carpeta,
              txt: entrada.txt,
              colores
            });
          }
          cambio = true;
        }
        if (cambio) await gcs.saveProductosJson(productosJson);
      } catch (error) {
        // El borrado en la BD ya ocurrió: se informa pero no se finge un fallo total.
        console.error('⚠️ Artículos eliminados, pero falló la limpieza en GCS:', error.message);
      }
    }

    res.json({
      success: true,
      eliminados: aEliminar.map(f => ({
        id: f.id_articulo,
        detalle: [f.prenda, f.color, f.talle].filter(Boolean).join(' ')
      })),
      omitidos,
      tarjetasQuitadas
    });
  } catch (error) {
    console.error('❌ Error eliminando artículos:', error.message);
    res.status(500).json({ success: false, error: 'Error al eliminar los artículos' });
  }
});

module.exports = router;
