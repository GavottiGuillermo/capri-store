// Migra productos.json del formato viejo (una entrada por id_articulo, una sola foto, sin color)
// al formato nuevo agrupado por prenda (una entrada por producto, con fotos por color).
//
// El nombre del color no está en productos.json: se resuelve consultando la BD por el id_articulo
// que viene en el nombre de la carpeta ("74-Body trikini" -> id 74 -> color 'Negro').
//
// Uso:
//   node scripts/migrar-productos-json.js            (dry-run: muestra qué haría, no escribe nada)
//   node scripts/migrar-productos-json.js --apply    (escribe productos.json, con backup previo)
//
// El backup queda en el bucket como productos.json.bak-<timestamp>.

require('dotenv').config();

const db = require('../js/db');
const gcs = require('../js/services/gcs');

const APLICAR = process.argv.includes('--apply');

async function main() {
  if (!gcs.isConfigured()) {
    throw new Error('GCS no configurado (falta GOOGLE_APPLICATION_CREDENTIALS_JSON o GOOGLE_APPLICATION_CREDENTIALS)');
  }
  await db.initializeDatabase();

  const original = await gcs.getProductosJson();
  console.log(`📦 productos.json actual: ${original.length} entradas`);

  // 1. Traer prenda/color de todos los ids referenciados por las carpetas.
  const entradas = original.map(node => ({ raw: node, norm: gcs.normalizeProductoEntry(node) }));
  const ids = entradas.map(e => e.norm?.idPrincipal).filter(id => Number.isInteger(id));

  const infoPorId = new Map();
  if (ids.length > 0) {
    const result = await db.pool.query(
      `SELECT id_articulo, prenda, color FROM ${db.PRODUCTOS_TABLE} WHERE id_articulo = ANY($1::int[])`,
      [ids]
    );
    result.rows.forEach(r => infoPorId.set(r.id_articulo, r));
  }

  // 2. Agrupar por prenda (la de la BD si se pudo resolver; si no, el nombre derivado de la carpeta).
  const porProducto = new Map();
  const huerfanas = [];

  entradas.forEach(({ raw, norm }) => {
    if (!norm) return;
    if (Array.isArray(raw.colores) && raw.colores.length > 0) {
      console.log(`  ⏭️  "${norm.producto}" ya está en formato nuevo, se deja igual`);
    }

    const info = infoPorId.get(norm.idPrincipal);
    if (!info) huerfanas.push(norm.carpeta);

    const producto = (info?.prenda || norm.producto || '').trim();
    const color = info?.color || norm.colores[0]?.color || '';
    const clave = producto.toLowerCase();

    if (!porProducto.has(clave)) {
      porProducto.set(clave, {
        producto,
        categoria: norm.categoria,
        carpeta: norm.carpeta,
        txt: norm.txt,
        colores: []
      });
    }
    const acc = porProducto.get(clave);
    // La carpeta/txt de la entrada con el id más bajo manda (para que las URLs sean estables).
    if ((norm.idPrincipal ?? Infinity) < (gcs.normalizeProductoEntry(acc).idPrincipal ?? Infinity)) {
      acc.carpeta = norm.carpeta;
      acc.txt = norm.txt;
      acc.categoria = norm.categoria;
    }

    norm.colores.forEach(c => {
      const nombreColor = c.color || color;
      const existente = acc.colores.find(x => x.color.trim().toLowerCase() === nombreColor.trim().toLowerCase());
      if (existente) {
        c.imagenes.forEach(img => { if (!existente.imagenes.includes(img)) existente.imagenes.push(img); });
        c.ids.forEach(id => { if (!existente.ids.includes(id)) existente.ids.push(id); });
      } else {
        acc.colores.push({ color: nombreColor, ids: [...c.ids], imagenes: [...c.imagenes] });
      }
    });
  });

  const migradas = Array.from(porProducto.values()).map(e => gcs.buildProductoEntry(e));

  // 3. Informe
  console.log(`\n🧩 Resultado: ${original.length} entradas -> ${migradas.length} productos`);
  const fusionadas = migradas.filter(e => e.colores.length > 1);
  if (fusionadas.length > 0) {
    console.log(`\n🎨 Productos con más de un color (antes eran tarjetas separadas):`);
    fusionadas.forEach(e => {
      console.log(`   "${e.producto}" [${e.carpeta}]`);
      e.colores.forEach(c => console.log(`      - ${c.color || '(sin color)'}: ids ${c.ids.join(',') || '-'}, ${c.imagenes.length} foto(s)`));
    });
  }
  if (huerfanas.length > 0) {
    console.log(`\n⚠️ ${huerfanas.length} carpeta(s) sin fila en la BD (se conservan con el color derivado):`);
    huerfanas.forEach(c => console.log(`   - ${c}`));
  }
  const sinColor = migradas.filter(e => e.colores.some(c => !c.color));
  if (sinColor.length > 0) {
    console.log(`\n⚠️ ${sinColor.length} producto(s) quedan con algún color vacío (la galería mostrará todas sus fotos):`);
    sinColor.forEach(e => console.log(`   - ${e.producto}`));
  }

  if (!APLICAR) {
    console.log('\n🔍 DRY-RUN: no se escribió nada. Volvé a correrlo con --apply para aplicar.');
    return;
  }

  // 4. Backup + escritura
  const nombreBackup = `${gcs.PRODUCTOS_JSON_PATH}.bak-${Date.now()}`;
  await gcs.uploadBuffer(nombreBackup, Buffer.from(JSON.stringify(original, null, 2), 'utf8'), 'application/json; charset=utf-8');
  console.log(`\n💾 Backup guardado en el bucket: ${nombreBackup}`);

  await gcs.saveProductosJson(migradas);
  console.log('✅ productos.json actualizado al formato agrupado.');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error en la migración:', error.message);
    process.exit(1);
  });
