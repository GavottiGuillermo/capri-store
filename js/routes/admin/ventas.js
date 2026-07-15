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
router.post('/devolver/:idArticulo', requireDb, async (req, res) => {
  const idArticulo = parseInt(req.params.idArticulo, 10);
  if (!Number.isInteger(idArticulo)) {
    return res.status(400).json({ success: false, error: 'ID de artículo inválido' });
  }

  try {
    await db.pool.query('CALL sp_devolver_articulo($1)', [idArticulo]);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error devolviendo artículo:', error.message);
    const mensaje = /no encontrado/i.test(error.message) ? error.message : 'Error al devolver el artículo';
    res.status(error.message.includes('no encontrado') ? 404 : 500).json({ success: false, error: mensaje });
  }
});

module.exports = router;
