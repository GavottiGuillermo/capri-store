// catalogo.js
// Lectura compartida de productos.json entre el catálogo (main.js) y el detalle (detalle.js).
//
// productos.json convive en dos formatos:
//   VIEJO  -> una entrada por id_articulo, una sola imagen, sin nombre de color:
//             { categoria, carpeta: "74-Body trikini", imagen: "...jpg", txt: "...txt" }
//   NUEVO  -> una entrada por PRENDA, con varias imágenes por color:
//             { ...lo anterior..., producto, prenda, color, colores: [{ color, ids, imagenes: [] }] }
//
// El campo `carpeta` mantiene el prefijo "{id}-" en ambos formatos porque el id_articulo se deriva
// parseando la URL (marcado de "sin stock" y resolución del detalle).
//
// Este módulo deja todo en una forma canónica única para que el resto del código no tenga que
// preguntarse de qué formato viene cada entrada.

(function () {
  'use strict';

  /** Saca el id_articulo de una URL/carpeta del bucket ("/74-Body trikini/..." -> 74). */
  function extraerId(texto) {
    try {
      const m = decodeURIComponent(String(texto || '')).match(/\/?(\d+)-[^/]+/);
      return m && m[1] ? parseInt(m[1], 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Normaliza una entrada de productos.json (viejo o nuevo) a:
   *   { producto, categoria, carpeta, txt, imagen, colores: [{color, ids, imagenes}], ids, imagenes }
   * Las entradas viejas quedan como un único color sin nombre con su imagen suelta.
   */
  function normalizarEntrada(node) {
    if (!node || typeof node !== 'object') return null;

    const carpeta = String(node.carpeta || '');
    const idDesdeCarpeta = extraerId(carpeta) ?? extraerId(node.txt || node.imagen);
    const producto = node.producto || node.prenda ||
      (carpeta.match(/^\d+-(.*)$/) ? carpeta.match(/^\d+-(.*)$/)[1] : carpeta);

    let colores;
    if (Array.isArray(node.colores) && node.colores.length > 0) {
      colores = node.colores.map(c => ({
        color: c.color || '',
        ids: Array.isArray(c.ids) ? c.ids.filter(n => Number.isInteger(n)) : [],
        imagenes: Array.isArray(c.imagenes) ? c.imagenes.filter(Boolean) : (c.imagen ? [c.imagen] : [])
      }));
    } else {
      colores = [{
        color: node.color || '',
        ids: idDesdeCarpeta !== null ? [idDesdeCarpeta] : [],
        imagenes: node.imagen ? [node.imagen] : []
      }];
    }

    const imagenes = colores.reduce((acc, c) => acc.concat(c.imagenes), []);

    return {
      producto,
      categoria: node.categoria || '',
      carpeta,
      idPrincipal: idDesdeCarpeta,
      txt: node.txt || '',
      imagen: node.imagen || imagenes[0] || '',
      colores,
      imagenes,
      ids: colores.reduce((acc, c) => acc.concat(c.ids), [])
    };
  }

  /**
   * Agrupa entradas que corresponden al mismo producto en una sola tarjeta.
   * Necesario mientras haya entradas en formato viejo: dos unidades de la misma prenda
   * publicadas por separado son dos entradas distintas y generarían dos tarjetas iguales.
   * Conserva `categoria`/`txt`/`imagen`/`carpeta` para que el render existente siga funcionando.
   */
  function agruparPorProducto(entradas) {
    const porClave = new Map();

    (entradas || []).forEach(raw => {
      const entrada = normalizarEntrada(raw);
      if (!entrada) return;
      const clave = String(entrada.producto || entrada.carpeta).trim().toLowerCase();

      if (!porClave.has(clave)) {
        porClave.set(clave, { ...entrada, colores: entrada.colores.map(c => ({ ...c })) });
        return;
      }

      // Ya había una entrada de este producto: fusionar sus colores.
      const acumulado = porClave.get(clave);
      entrada.colores.forEach(nuevo => {
        const existente = acumulado.colores.find(c =>
          c.color.trim().toLowerCase() === nuevo.color.trim().toLowerCase()
        );
        if (existente) {
          nuevo.imagenes.forEach(img => {
            if (!existente.imagenes.includes(img)) existente.imagenes.push(img);
          });
          nuevo.ids.forEach(id => {
            if (!existente.ids.includes(id)) existente.ids.push(id);
          });
        } else {
          acumulado.colores.push({ ...nuevo });
        }
      });
    });

    // Recalcular los derivados después de fusionar.
    return Array.from(porClave.values()).map(entrada => {
      const imagenes = entrada.colores.reduce((acc, c) => acc.concat(c.imagenes), []);
      return {
        ...entrada,
        imagenes,
        imagen: entrada.imagen || imagenes[0] || '',
        ids: entrada.colores.reduce((acc, c) => acc.concat(c.ids), [])
      };
    });
  }

  /** Devuelve las fotos que corresponden a un color; si no hay mapeo, devuelve todas. */
  function imagenesDeColor(entrada, color) {
    if (!entrada) return [];
    const objetivo = String(color || '').trim().toLowerCase();
    const match = (entrada.colores || []).find(c =>
      String(c.color || '').trim().toLowerCase() === objetivo && c.imagenes.length > 0
    );
    if (match) return match.imagenes;
    // Formato viejo (colores sin nombre) o color sin fotos propias: mostrar todo lo que haya.
    return entrada.imagenes || [];
  }

  window.CapriCatalogo = { extraerId, normalizarEntrada, agruparPorProducto, imagenesDeColor };
})();
