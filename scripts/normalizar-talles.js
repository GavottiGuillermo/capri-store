// Normaliza talle y color de las filas ya cargadas en `productos`.
//
// OJO: `productos` es la tabla COMPARTIDA con la app de escritorio Java. Este script cambia datos
// que el desktop también lee, así que está en dry-run por defecto y conviene correrlo con el
// desktop cerrado. No hace falta para que la tienda funcione: /variantes-producto ya normaliza al
// agrupar, así que 'm' y 'M' se muestran unificados sin tocar la BD. Esto es solo limpieza.
//
// Uso:
//   node scripts/normalizar-talles.js            (dry-run: lista los cambios, no escribe)
//   node scripts/normalizar-talles.js --apply    (aplica los UPDATE)

require('dotenv').config();

const db = require('../js/db');
const variantes = require('../js/services/variantes');

const APLICAR = process.argv.includes('--apply');

async function main() {
  await db.initializeDatabase();

  const result = await db.pool.query(
    `SELECT id_articulo, prenda, talle, color FROM ${db.PRODUCTOS_TABLE} ORDER BY id_articulo`
  );

  const cambios = [];
  result.rows.forEach(row => {
    const talleNuevo = variantes.normalizarTalle(row.talle);
    const colorNuevo = variantes.normalizarColor(row.color);
    if (talleNuevo !== row.talle || colorNuevo !== row.color) {
      cambios.push({ ...row, talleNuevo, colorNuevo });
    }
  });

  console.log(`\n📊 ${result.rows.length} filas revisadas, ${cambios.length} con cambios`);

  if (cambios.length === 0) {
    console.log('✅ Nada para normalizar.');
    return;
  }

  // Agrupar el informe por transformación para que se vea el patrón, no 200 líneas sueltas.
  const porTransformacion = new Map();
  cambios.forEach(c => {
    const clave = `talle ${JSON.stringify(c.talle)} -> ${JSON.stringify(c.talleNuevo)} | color ${JSON.stringify(c.color)} -> ${JSON.stringify(c.colorNuevo)}`;
    if (!porTransformacion.has(clave)) porTransformacion.set(clave, []);
    porTransformacion.get(clave).push(c.id_articulo);
  });

  console.log('\n🔧 Cambios agrupados:');
  Array.from(porTransformacion.entries()).forEach(([clave, ids]) => {
    console.log(`   ${clave}`);
    console.log(`      ${ids.length} fila(s): ids ${ids.slice(0, 15).join(', ')}${ids.length > 15 ? ` … (+${ids.length - 15})` : ''}`);
  });

  if (!APLICAR) {
    console.log('\n🔍 DRY-RUN: no se escribió nada. Volvé a correrlo con --apply para aplicar.');
    return;
  }

  console.log('\n✍️  Aplicando…');
  let aplicados = 0;
  for (const c of cambios) {
    await db.pool.query(
      `UPDATE ${db.PRODUCTOS_TABLE} SET talle = $1, color = $2 WHERE id_articulo = $3`,
      [c.talleNuevo, c.colorNuevo, c.id_articulo]
    );
    aplicados++;
  }
  console.log(`✅ ${aplicados} fila(s) normalizada(s).`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error normalizando:', error.message);
    process.exit(1);
  });
