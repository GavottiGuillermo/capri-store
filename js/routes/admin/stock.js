const express = require('express');

const db = require('../../db');
const variantes = require('../../services/variantes');

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
          categoria,
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

module.exports = router;
