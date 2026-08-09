// Catálogos de valores controlados (categoría y talle).
//
// Por qué existe: la carga manual con campos de texto libre dejó la BD con 15 categorías distintas
// que en realidad son ~8 conceptos ('Parte de arriba' / 'Arriba' / 'Arriba ' / 'Top' / 'Tops') y
// talles escritos de varias formas ('m', 'u'). Con un catálogo cerrado eso no vuelve a pasar.
//
// **Fuente de verdad única.** El panel pide estas listas a `GET /admin/catalogos` en vez de tener
// su propia copia, y el servidor valida contra ellas. La única otra lista que tiene que coincidir
// es `ORDEN_CATEGORIAS` en `js/main.js` (define el orden de las secciones de la tienda, y vive del
// lado del cliente público, que no puede requerir este módulo): hay un test que verifica que las
// dos listas sigan alineadas.

// El `valor` es lo que se guarda en productos.categoria y en productos.json.
// Se eligió el vocabulario de la tienda (el que ya usaban las 42 tarjetas publicadas) para que
// stock y web hablen el mismo idioma. Las filas viejas conservan su valor anterior: no se migraron.
const CATEGORIAS = [
  { valor: 'Bodys', etiqueta: 'Bodys' },
  { valor: 'Conjuntos', etiqueta: 'Conjuntos' },
  { valor: 'Minis', etiqueta: 'Minis' },
  { valor: 'Pantalones', etiqueta: 'Pantalones' },
  { valor: 'Polleras', etiqueta: 'Polleras' },
  { valor: 'Remeras', etiqueta: 'Remeras' },
  { valor: 'Shorts', etiqueta: 'Shorts' },
  { valor: 'Tops', etiqueta: 'Tops' },
  { valor: 'Vestidos', etiqueta: 'Vestidos' },
  { valor: 'Accesorios', etiqueta: 'Accesorios' },
  { valor: 'Carteras', etiqueta: 'Carteras' },
  { valor: 'OnaFitness', etiqueta: 'Onna Fitness' },
];

// 'unico' primero porque es el 80% de la mercadería. El valor guardado es el que ya domina en la
// BD (182 filas), así no hay que migrar nada; la etiqueta es la que se muestra en pantalla.
const TALLES = [
  { valor: 'unico', etiqueta: 'Único' },
  { valor: 'XS', etiqueta: 'XS' },
  { valor: 'S', etiqueta: 'S' },
  { valor: 'M', etiqueta: 'M' },
  { valor: 'L', etiqueta: 'L' },
  { valor: 'XL', etiqueta: 'XL' },
  { valor: 'XXL', etiqueta: 'XXL' },
  { valor: 'S/M', etiqueta: 'S/M' },
  { valor: 'M/L', etiqueta: 'M/L' },
];

const SUFIJO_NOVEDAD = '-Novedad';

// Quita el sufijo "-Novedad" que agrega el flag de novedad al publicar, para poder validar la
// categoría base contra el catálogo.
function categoriaBase(valor) {
  const texto = String(valor ?? '').trim();
  return texto.endsWith(SUFIJO_NOVEDAD) ? texto.slice(0, -SUFIJO_NOVEDAD.length) : texto;
}

// Compara sin distinguir mayúsculas ni acentos, para que 'tops' o 'Onna Fitness' entren igual.
function claveCategoria(valor) {
  return String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

// Devuelve el valor canónico del catálogo, o null si la categoría no pertenece a él.
function normalizarCategoria(valor) {
  const base = categoriaBase(valor);
  if (!base) return null;
  const clave = claveCategoria(base);
  const match = CATEGORIAS.find(c => claveCategoria(c.valor) === clave || claveCategoria(c.etiqueta) === clave);
  return match ? match.valor : null;
}

function esCategoriaValida(valor) {
  return normalizarCategoria(valor) !== null;
}

function etiquetasCategorias() {
  return CATEGORIAS.map(c => c.valor).join(', ');
}

module.exports = {
  CATEGORIAS,
  TALLES,
  SUFIJO_NOVEDAD,
  categoriaBase,
  normalizarCategoria,
  esCategoriaValida,
  etiquetasCategorias,
};
