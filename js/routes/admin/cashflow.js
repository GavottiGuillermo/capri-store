const express = require('express');

const db = require('../../db');

const router = express.Router();

function requireDb(req, res, next) {
  if (!db.pool) {
    return res.status(503).json({ success: false, error: 'Base de datos no disponible' });
  }
  next();
}

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function esFechaValida(raw) {
  return typeof raw === 'string' && FECHA_REGEX.test(raw) && !Number.isNaN(new Date(raw).getTime());
}

function aFechaISO(date) {
  return date === null || date === undefined ? null : date.toISOString().slice(0, 10);
}

function formatoArticulo(row) {
  return [row.prenda, row.color, row.talle].filter(Boolean).join(' ');
}

// Agrupa filas de productos por una clave (id_pago / id_lote) y arma "prenda color talle, ...".
function agruparArticulosPorClave(rows, claveCampo) {
  const mapa = new Map();
  rows.forEach(row => {
    const clave = row[claveCampo];
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(formatoArticulo(row));
  });
  const resultado = new Map();
  mapa.forEach((articulos, clave) => resultado.set(clave, articulos.join(', ')));
  return resultado;
}

// Empareja filas de la SP (que no traen id_pago/id_lote) con su detalle de artículos usando una
// clave compuesta (fecha + monto + el texto libre que ya trae la observación). No es un join real
// por id, así que dos transacciones idénticas el mismo día podrían, en el peor caso, mezclar su
// detalle entre sí — es solo un enriquecimiento visual de Cash Flow, no afecta debe/haber/saldo.
function construirBuscador(filas, campoMonto, claveExtractor) {
  const mapa = new Map();
  filas.forEach(fila => {
    const clave = `${aFechaISO(fila.fecha)}|${fila[campoMonto]}|${claveExtractor(fila)}`;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(fila.detalle);
  });
  return (fecha, monto, textoLibre) => {
    const clave = `${fecha}|${monto}|${textoLibre}`;
    const lista = mapa.get(clave);
    return lista && lista.length > 0 ? lista.shift() : null;
  };
}

// === CONSULTA DE CASH FLOW (equivalente a ejecutarConsulta, vía sp_analizar_cashflow con opción 1) ===
// El SP devuelve, para el rango de fechas, las transacciones (pagos/gastos_extra/lotes) con saldo
// acumulado más una fila final de "análisis" (fecha_transaccion NULL) con métricas agregadas en un
// array; esa fila se separa acá y no se expone como transacción.
//
// Además, esta ruta enriquece dos cosas que el SP no muestra (pedido explícito, no vienen del
// desktop): qué artículos componen cada ingreso ("Pago -") y cada compra de mercadería ("Lote -"),
// y un detalle de qué se devolvió y por qué monto (ver comentario en devoluciones_web más abajo).
// Nada de esto toca debe/haber/saldo, que siguen siendo los que calcula el SP.
router.get('/', requireDb, async (req, res) => {
  const { fechaInicio, fechaFin } = req.query;

  if (!esFechaValida(fechaInicio) || !esFechaValida(fechaFin)) {
    return res.status(400).json({ success: false, error: "Debe indicar 'fechaInicio' y 'fechaFin' en formato YYYY-MM-DD" });
  }
  if (fechaInicio > fechaFin) {
    return res.status(400).json({ success: false, error: 'Intervalo de fechas incorrecto' });
  }

  try {
    const [cashflowResult, pagosResult, lotesResult, devolucionesResult] = await Promise.all([
      db.pool.query('SELECT * FROM sp_analizar_cashflow($1, $2, 1)', [fechaInicio, fechaFin]),
      db.pool.query('SELECT id_pago, fecha_pago, monto, nombre_cliente FROM pagos WHERE fecha_pago BETWEEN $1 AND $2', [fechaInicio, fechaFin]),
      db.pool.query('SELECT id_lote, fecha_ingreso, costo, local FROM lotes WHERE fecha_ingreso BETWEEN $1 AND $2', [fechaInicio, fechaFin]),
      db.pool.query(
        `SELECT prenda, color, talle, monto, fecha_devolucion FROM ${db.DEVOLUCIONES_TABLE}
         WHERE fecha_devolucion BETWEEN $1 AND $2 ORDER BY fecha_devolucion, id`,
        [fechaInicio, fechaFin]
      ),
    ]);

    const pagoIds = pagosResult.rows.map(r => r.id_pago);
    const loteIds = lotesResult.rows.map(r => r.id_lote);
    const [articulosPagoResult, articulosLoteResult] = await Promise.all([
      pagoIds.length > 0
        ? db.pool.query(`SELECT id_pago, prenda, color, talle FROM ${db.PRODUCTOS_TABLE} WHERE id_pago = ANY($1::int[])`, [pagoIds])
        : { rows: [] },
      loteIds.length > 0
        ? db.pool.query(`SELECT id_lote, prenda, color, talle FROM ${db.PRODUCTOS_TABLE} WHERE id_lote = ANY($1::int[])`, [loteIds])
        : { rows: [] },
    ]);
    const articulosPorPago = agruparArticulosPorClave(articulosPagoResult.rows, 'id_pago');
    const articulosPorLote = agruparArticulosPorClave(articulosLoteResult.rows, 'id_lote');

    const buscarPago = construirBuscador(
      pagosResult.rows.map(r => ({ fecha: r.fecha_pago, monto: Number(r.monto), texto: r.nombre_cliente, detalle: articulosPorPago.get(r.id_pago) })),
      'monto',
      r => r.texto
    );
    const buscarLote = construirBuscador(
      lotesResult.rows.map(r => ({ fecha: r.fecha_ingreso, monto: Number(r.costo), texto: r.local, detalle: articulosPorLote.get(r.id_lote) })),
      'monto',
      r => r.texto
    );

    const filaAnalisis = cashflowResult.rows.find(row => row.fecha_transaccion === null);
    const transacciones = cashflowResult.rows
      .filter(row => row.fecha_transaccion !== null)
      .map(row => {
        const fecha = aFechaISO(row.fecha_transaccion);
        const debe = row.debe === null ? null : Number(row.debe);
        const haber = row.haber === null ? null : Number(row.haber);
        let observacion = row.observacion;

        if (observacion.startsWith('Pago - ')) {
          const nombreCliente = observacion.slice('Pago - '.length);
          const articulos = buscarPago(fecha, haber, nombreCliente);
          if (articulos) observacion = `${observacion} (${articulos})`;
        } else if (observacion.startsWith('Lote - ')) {
          const local = observacion.slice('Lote - '.length);
          const articulos = buscarLote(fecha, debe, local);
          if (articulos) observacion = `${observacion} (${articulos})`;
        }

        return { fecha, debe, haber, saldo: Number(row.saldo), observacion };
      });

    // Filas informativas de devolución: no tienen debe/haber/saldo propios porque el impacto en el
    // saldo ya está reflejado por la desaparición del pago original (ver comentario en ventas.js).
    devolucionesResult.rows.forEach(row => {
      const detalle = [row.prenda, row.color, row.talle].filter(Boolean).join(' ');
      const monto = row.monto != null ? Number(row.monto) : null;
      transacciones.push({
        fecha: aFechaISO(row.fecha_devolucion),
        debe: null,
        haber: null,
        saldo: null,
        observacion: `Devolución - ${detalle}${monto != null ? ` ($${monto})` : ''}`,
      });
    });
    transacciones.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

    const a = filaAnalisis ? filaAnalisis.analisis || [] : [];
    const metricas = {
      cantidadVentas: a[0] != null ? Number(a[0]) : 0,
      totalIngresos: a[1] != null ? Number(a[1]) : 0,
      totalGastos: a[2] != null ? Number(a[2]) : 0,
      saldoTotal: a[3] != null ? Number(a[3]) : 0,
      cantidadGastos: a[4] != null ? Number(a[4]) : 0,
      mayorIngreso: a[7] != null ? Number(a[7]) : 0,
      diaMayorIngreso: a[8] != null ? aFechaISO(new Date(Number(a[8]) * 1000)) : null,
      diaMayorGasto: a[9] != null ? aFechaISO(new Date(Number(a[9]) * 1000)) : null,
    };

    res.json({ success: true, transacciones, metricas });
  } catch (error) {
    console.error('❌ Error consultando cash flow:', error.message);
    res.status(500).json({ success: false, error: 'Error al consultar el cash flow' });
  }
});

module.exports = router;
