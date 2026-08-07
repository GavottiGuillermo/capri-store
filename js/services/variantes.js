// Normalización de talle y color.
//
// Por qué existe: `productos` acumuló valores sucios cargados a mano desde el desktop
// ('unico' ×181 pero también 'u', 'M' junto a 'm', 'Blanco ' con espacio al final, 'Bordo  ').
// El agrupado de variantes de la tienda compara strings exactos, así que sin normalizar
// aparecen como talles/colores distintos cosas que son la misma.
//
// Se usa en dos lugares con intenciones distintas:
//  - Al INSERTAR stock nuevo (admin/stock.js): deja la BD limpia de acá en adelante.
//  - Al AGRUPAR para la tienda (store.js /variantes-producto): unifica los datos sucios que
//    ya están cargados, sin necesidad de escribir en la BD compartida con el desktop.

// Sinónimos de "talle único" que aparecen en los datos reales o que es razonable esperar.
const TALLES_UNICOS = new Set([
  'unico', 'único', 'u', 'un', 'unitalla', 'única', 'unica',
  'sin talle', 'sin-talle', 'sintalle', 'ajustable', 'na', 'n/a', '-', 'universal'
]);

// Talle canónico para "único": es el valor que ya domina en la BD (evita migrar 181 filas).
const TALLE_UNICO = 'unico';

// Talles de letra: se llevan a mayúscula ('m' -> 'M', 's/m' -> 'S/M').
const TALLE_LETRA = /^(xxs|xs|s|m|l|xl|xxl|xxxl)(\s*\/\s*(xxs|xs|s|m|l|xl|xxl|xxxl))?$/;

function quitarAcentos(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normaliza un talle preservando lo que no reconoce.
 * Conservador a propósito: solo unifica lo que es inequívocamente lo mismo
 * ('u'/'único' -> 'unico', 'm' -> 'M') y deja intacto el resto ('L (CHICA)', '38').
 */
function normalizarTalle(raw) {
  const limpio = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!limpio) return TALLE_UNICO;

  const clave = quitarAcentos(limpio).toLowerCase();
  if (TALLES_UNICOS.has(clave)) return TALLE_UNICO;

  if (TALLE_LETRA.test(clave)) {
    return clave.toUpperCase().replace(/\s*\/\s*/, '/');
  }

  // Valores que no encajan en ningún patrón conocido se dejan como vinieron (solo destrimmeados).
  return limpio;
}

/** Normaliza un color: recorta y colapsa espacios, sin tocar acentos ni mayúsculas. */
function normalizarColor(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/** Clave para comparar dos colores como iguales ('Blanco ' y 'blanco' son el mismo). */
function claveColor(raw) {
  return quitarAcentos(normalizarColor(raw)).toLowerCase();
}

module.exports = {
  TALLE_UNICO,
  normalizarTalle,
  normalizarColor,
  claveColor
};
