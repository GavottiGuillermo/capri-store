const express = require('express');

const db = require('../../db');

const router = express.Router();

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

// Estados que crea sp_crear_pedido_web según el tipo de entrega elegido en el checkout.
const ESTADOS_PENDIENTES = ['Pendiente Retiro', 'Pendiente Envio'];

// === LISTADO DE PEDIDOS WEB ===
// Usa el mismo SP que la pestaña de pedidos del desktop (`sp_consultar_pedidos`), que devuelve
// UNA FILA POR ARTÍCULO con los datos del pedido repetidos; acá se agrupan por `id_pedido` para
// mostrar un pedido con sus artículos, que es como se lo piensa.
// Por defecto solo trae los pendientes (`?soloPendientes=false` para ver todos).
router.get('/', requireDb, async (req, res) => {
  try {
    const soloPendientes = req.query.soloPendientes !== 'false';
    const result = await db.pool.query('SELECT * FROM sp_consultar_pedidos($1, $2, $3, $4)',
      [null, null, null, null]);

    const pedidos = new Map();
    result.rows.forEach(row => {
      if (!pedidos.has(row.id_pedido)) {
        pedidos.set(row.id_pedido, {
          id_pedido: row.id_pedido,
          estado: row.estado,
          cliente: row.pedido_nombre_cliente,
          correo: row.pedido_correo_cliente,
          telefono: row.pedido_telefono_cliente,
          tipo_entrega: row.pedido_tipo_entrega,
          // El SP repite el monto total del pedido en cada fila: no se suma, se toma una vez.
          monto_total: row.pedido_monto_total === null ? null : Number(row.pedido_monto_total),
          fecha: row.pedido_fecha,
          articulos: [],
        });
      }
      pedidos.get(row.id_pedido).articulos.push({
        id_articulo: row.id_articulo,
        prenda: row.prenda,
        estado: row.estado,
        precio: row.precio_venta_transferencia === null ? null : Number(row.precio_venta_transferencia),
      });
    });

    let lista = Array.from(pedidos.values());
    lista.forEach(p => { p.cantidad = p.articulos.length; });
    if (soloPendientes) {
      lista = lista.filter(p => ESTADOS_PENDIENTES.includes(p.estado));
    }

    res.json({ success: true, pedidos: lista, pendientes: lista.filter(p => ESTADOS_PENDIENTES.includes(p.estado)).length });
  } catch (error) {
    console.error('❌ Error listando pedidos:', error.message);
    res.status(500).json({ success: false, error: 'Error al consultar los pedidos' });
  }
});

// === MARCAR UN PEDIDO COMO ENTREGADO ===
// NO se usa `sp_actualizar_pedido_entregado`: esa SP empieza con `UPDATE pedidos ...` y la tabla
// `pedidos` no existe en esta base, así que falla con 'relation "pedidos" does not exist' (42P01)
// antes de llegar a tocar los productos. Se hace directo lo que la SP pretendía sobre `productos`.
router.post('/:idPedido/entregado', requireDb, async (req, res) => {
  const idPedido = String(req.params.idPedido || '').trim();
  if (!idPedido) {
    return res.status(400).json({ success: false, error: 'ID de pedido inválido' });
  }

  try {
    const existentes = await db.pool.query(
      `SELECT id_articulo, estado FROM ${db.PRODUCTOS_TABLE} WHERE id_pedido = $1`,
      [idPedido]
    );
    if (existentes.rows.length === 0) {
      return res.status(404).json({ success: false, error: `No se encontró el pedido ${idPedido}` });
    }
    if (!existentes.rows.some(r => ESTADOS_PENDIENTES.includes(r.estado))) {
      return res.status(400).json({ success: false, error: `El pedido ${idPedido} ya no está pendiente` });
    }

    const result = await db.pool.query(
      `UPDATE ${db.PRODUCTOS_TABLE} SET estado = 'Sin Stock'
       WHERE id_pedido = $1 AND estado = ANY($2::text[])`,
      [idPedido, ESTADOS_PENDIENTES]
    );

    res.json({ success: true, idPedido, articulosActualizados: result.rowCount });
  } catch (error) {
    console.error('❌ Error marcando pedido como entregado:', error.message);
    res.status(500).json({ success: false, error: 'Error al marcar el pedido como entregado' });
  }
});

module.exports = router;
