const express = require('express');

const db = require('../../db');

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

const METODOS_PAGO_VALIDOS = ['Efectivo', 'Transferencia'];

function parseIds(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map(Number).filter(Number.isInteger);
  return Array.from(new Set(ids));
}

// === CONFIRMAR VENTA (equivalente a confirmarCompra, vía sp_procesar_venta) ===
// El listado para armar el carrito se obtiene de GET /admin/stock (mismo SP que la pestaña Ventas
// del desktop). Acá solo se valida y confirma: cada id debe existir y estar "Disponible" (misma
// condición que en el desktop habilita el botón "Agregar al carrito" en vez de "Devolución"), y el
// total se recalcula en el servidor a partir de precio_venta_efectivo / precio_venta_transferencia
// en vez de confiar en el total que mande el cliente.
router.post('/confirmar', express.json(), requireDb, async (req, res) => {
  try {
    const ids = parseIds(req.body.ids);
    const metodoPago = req.body.metodoPago;
    const nombreCliente = String(req.body.nombreCliente || '').trim() || 'No proporcionado';

    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe indicar al menos un artículo' });
    }
    if (!METODOS_PAGO_VALIDOS.includes(metodoPago)) {
      return res.status(400).json({ success: false, error: "El método de pago debe ser 'Efectivo' o 'Transferencia'" });
    }

    const result = await db.pool.query(
      `SELECT id_articulo, estado, precio_venta_efectivo, precio_venta_transferencia
       FROM ${db.PRODUCTOS_TABLE} WHERE id_articulo = ANY($1::int[])`,
      [ids]
    );
    const encontrados = new Map(result.rows.map(r => [r.id_articulo, r]));

    const faltantes = ids.filter(id => !encontrados.has(id));
    if (faltantes.length > 0) {
      return res.status(400).json({ success: false, error: `Artículo(s) inexistente(s): ${faltantes.join(', ')}` });
    }
    const noDisponibles = ids.filter(id => encontrados.get(id).estado !== 'Disponible');
    if (noDisponibles.length > 0) {
      return res.status(400).json({ success: false, error: `Artículo(s) ya no disponible(s): ${noDisponibles.join(', ')}` });
    }

    const total = ids.reduce((suma, id) => {
      const producto = encontrados.get(id);
      const precio = metodoPago === 'Efectivo' ? producto.precio_venta_efectivo : producto.precio_venta_transferencia;
      return suma + Number(precio);
    }, 0);

    await db.pool.query('CALL sp_procesar_venta($1, $2, $3, $4)', [total, nombreCliente, metodoPago, ids]);

    res.json({ success: true, total, cantidad: ids.length, metodoPago, nombreCliente });
  } catch (error) {
    console.error('❌ Error confirmando venta:', error.message);
    res.status(500).json({ success: false, error: 'Error al confirmar la venta' });
  }
});

// === DEVOLUCIÓN DE ARTÍCULO (equivalente a devolverArticulo, vía sp_devolver_articulo) ===
// sp_devolver_articulo borra por completo la fila de 'pagos' asociada (comportamiento del desktop,
// preservado desde Fase 4), así que después de la devolución no queda ningún rastro de qué se
// devolvió ni por qué monto. Para poder mostrar ese detalle en Cash Flow sin tocar la SP compartida
// con el desktop, acá se lee el artículo + su pago ANTES de llamar a la SP (una vez que la SP corre,
// el pago ya no existe) y, solo si la SP tiene éxito, se guarda una copia en la tabla propia de la
// web `devoluciones_web`. El monto se recalcula con el mismo criterio que /confirmar (precio efectivo
// o transferencia según el método de pago original) en vez de usar pagos.monto, porque ese monto es el
// total de todo el carrito de la venta original y puede incluir otros artículos.
router.post('/devolver/:idArticulo', requireDb, async (req, res) => {
  const idArticulo = parseInt(req.params.idArticulo, 10);
  if (!Number.isInteger(idArticulo)) {
    return res.status(400).json({ success: false, error: 'ID de artículo inválido' });
  }

  try {
    const detalleResult = await db.pool.query(
      `SELECT p.prenda, p.color, p.talle, p.precio_venta_efectivo, p.precio_venta_transferencia,
              pg.metodo_pago, pg.nombre_cliente
       FROM ${db.PRODUCTOS_TABLE} p
       LEFT JOIN pagos pg ON pg.id_pago = p.id_pago
       WHERE p.id_articulo = $1`,
      [idArticulo]
    );
    const detalle = detalleResult.rows[0];

    await db.pool.query('CALL sp_devolver_articulo($1)', [idArticulo]);

    if (detalle && detalle.metodo_pago) {
      const monto = detalle.metodo_pago === 'Efectivo' ? detalle.precio_venta_efectivo : detalle.precio_venta_transferencia;
      await db.pool.query(
        `INSERT INTO ${db.DEVOLUCIONES_TABLE} (id_articulo, prenda, color, talle, monto, metodo_pago, nombre_cliente)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [idArticulo, detalle.prenda, detalle.color, detalle.talle, monto, detalle.metodo_pago, detalle.nombre_cliente]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error devolviendo artículo:', error.message);
    const mensaje = /no encontrado/i.test(error.message) ? error.message : 'Error al devolver el artículo';
    res.status(error.message.includes('no encontrado') ? 404 : 500).json({ success: false, error: mensaje });
  }
});

module.exports = router;
