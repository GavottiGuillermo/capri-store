/**
 * Andreani API Integration
 * Configuración y funciones para integrar con la API de Andreani
 */

// Configuración de la API de Andreani
const ANDREANI_CONFIG = {
  // URLs de la API
  PRODUCTION_URL: 'https://apis.andreani.com/v2',
  TESTING_URL: 'https://apis.andreani.com/v2', // URL de testing si tienes acceso
  
  // Credenciales (IMPORTANTE: Reemplazar con tus datos reales)
  API_KEY: 'TU_API_KEY_AQUI', // Tu API Key de Andreani
  USERNAME: 'TU_USUARIO_AQUI', // Tu usuario de Andreani
  PASSWORD: 'TU_PASSWORD_AQUI', // Tu password de Andreani
  
  // Configuración de tu sucursal
  SUCURSAL: {
    codigoPostal: '2800', // CP de Zárate
    direccion: 'Justa Lima 123',
    ciudad: 'Zárate',
    provincia: 'Buenos Aires',
    numeroSucursal: 'TU_NUMERO_SUCURSAL' // Número de sucursal asignado por Andreani
  },
  
  // Configuración por defecto de productos
  PRODUCTO_DEFAULT: {
    peso: 0.5, // kg
    dimensiones: {
      alto: 10, // cm
      ancho: 15, // cm
      largo: 20 // cm
    },
    categoria: 'Ropa' // Categoría de productos
  },
  
  // Configuración del entorno
  ENVIRONMENT: 'testing' // 'production' o 'testing'
};

/**
 * Clase para manejar la API de Andreani
 */
class AndreaniAPI {
  constructor() {
    this.baseURL = ANDREANI_CONFIG.ENVIRONMENT === 'production' 
      ? ANDREANI_CONFIG.PRODUCTION_URL 
      : ANDREANI_CONFIG.TESTING_URL;
    this.apiKey = ANDREANI_CONFIG.API_KEY;
  }

  /**
   * Obtener token de autenticación
   */
  async obtenerToken() {
    try {
      const response = await fetch(`${this.baseURL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          username: ANDREANI_CONFIG.USERNAME,
          password: ANDREANI_CONFIG.PASSWORD
        })
      });

      if (!response.ok) {
        throw new Error(`Error de autenticación: ${response.status}`);
      }

      const data = await response.json();
      return data.token;
    } catch (error) {
      console.error('Error al obtener token de Andreani:', error);
      throw error;
    }
  }

  /**
   * Cotizar envío
   */
  async cotizarEnvio(cpDestino, peso, volumen, valorDeclarado) {
    try {
      const token = await this.obtenerToken();
      
      const requestBody = {
        cpOrigen: ANDREANI_CONFIG.SUCURSAL.codigoPostal,
        cpDestino: cpDestino,
        peso: peso,
        volumen: volumen,
        valorDeclarado: valorDeclarado,
        cliente: ANDREANI_CONFIG.SUCURSAL.numeroSucursal
      };

      const response = await fetch(`${this.baseURL}/envios/cotizar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-authorization-token': token,
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Error en cotización: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      return this.procesarCotizaciones(data);
    } catch (error) {
      console.error('Error al cotizar envío:', error);
      throw error;
    }
  }

  /**
   * Procesar respuesta de cotizaciones
   */
  procesarCotizaciones(data) {
    if (!data || !data.servicios || data.servicios.length === 0) {
      return [];
    }

    return data.servicios.map(servicio => ({
      codigo: servicio.codigoServicio,
      nombre: servicio.tipoServicio || servicio.nombre,
      descripcion: servicio.descripcion,
      tarifa: Math.round(servicio.tarifaConIva || servicio.tarifa || 0),
      plazoEntrega: servicio.plazoEntrega || 'No especificado',
      modalidad: servicio.modalidad
    }));
  }

  /**
   * Obtener sucursales cercanas a un CP
   */
  async obtenerSucursales(codigoPostal) {
    try {
      const token = await this.obtenerToken();
      
      const response = await fetch(`${this.baseURL}/sucursales?cp=${codigoPostal}`, {
        method: 'GET',
        headers: {
          'x-authorization-token': token,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Error al obtener sucursales: ${response.status}`);
      }

      const data = await response.json();
      return data.sucursales || [];
    } catch (error) {
      console.error('Error al obtener sucursales:', error);
      throw error;
    }
  }

  /**
   * Validar código postal
   */
  async validarCodigoPostal(codigoPostal) {
    try {
      const token = await this.obtenerToken();
      
      const response = await fetch(`${this.baseURL}/codigospostales/${codigoPostal}`, {
        method: 'GET',
        headers: {
          'x-authorization-token': token,
          'Accept': 'application/json'
        }
      });

      return response.ok;
    } catch (error) {
      console.error('Error al validar código postal:', error);
      return false;
    }
  }
}

/**
 * Utilidades para calcular peso y volumen del carrito
 */
class CalculadoraEnvio {
  /**
   * Calcular peso total del carrito
   */
  static calcularPesoTotal(cartItems) {
    if (!cartItems || cartItems.length === 0) {
      return ANDREANI_CONFIG.PRODUCTO_DEFAULT.peso;
    }
    
    return cartItems.reduce((total, item) => {
      const peso = item.peso || ANDREANI_CONFIG.PRODUCTO_DEFAULT.peso;
      return total + (peso * item.cantidad);
    }, 0);
  }

  /**
   * Calcular volumen total del carrito
   */
  static calcularVolumenTotal(cartItems) {
    if (!cartItems || cartItems.length === 0) {
      return ANDREANI_CONFIG.PRODUCTO_DEFAULT.dimensiones;
    }
    
    const cantidadTotal = cartItems.reduce((total, item) => total + item.cantidad, 0);
    const base = ANDREANI_CONFIG.PRODUCTO_DEFAULT.dimensiones;
    
    // Estimación: volumen crece proporcionalmente con la cantidad
    return {
      alto: Math.max(base.alto, Math.ceil(cantidadTotal / 3) * base.alto),
      ancho: base.ancho,
      largo: Math.max(base.largo, Math.ceil(cantidadTotal / 2) * 5)
    };
  }

  /**
   * Calcular valor declarado del carrito
   */
  static calcularValorDeclarado(cartItems) {
    if (!cartItems || cartItems.length === 0) return 0;
    
    return cartItems.reduce((total, item) => {
      return total + (Number(item.precio) * Number(item.cantidad));
    }, 0);
  }

  /**
   * Generar opciones de envío por defecto (fallback)
   */
  static generarOpcionesFallback(codigoPostal) {
    // Calcular distancia aproximada desde Zárate
    const distancia = this.calcularDistanciaAproximada(codigoPostal);
    const costoBase = distancia < 100 ? 800 : distancia < 300 ? 1200 : 1500;
    
    return [
      {
        codigo: 'standard',
        nombre: 'Envío Standard',
        descripcion: 'Entrega en 3-5 días hábiles',
        tarifa: costoBase,
        plazoEntrega: '3-5 días hábiles'
      },
      {
        codigo: 'express',
        nombre: 'Envío Express',
        descripcion: 'Entrega en 1-2 días hábiles',
        tarifa: Math.round(costoBase * 1.5),
        plazoEntrega: '1-2 días hábiles'
      }
    ];
  }

  /**
   * Calcular distancia aproximada basada en CP
   */
  static calcularDistanciaAproximada(codigoPostal) {
    const cp = parseInt(codigoPostal);
    
    // Aproximación muy básica basada en rangos de CP de Argentina
    if (cp >= 2800 && cp <= 2900) return 50;  // Zárate y alrededores
    if (cp >= 1000 && cp <= 1999) return 100; // CABA y GBA
    if (cp >= 2000 && cp <= 2999) return 200; // Provincia de Buenos Aires
    if (cp >= 3000 && cp <= 3999) return 400; // Córdoba, Santa Fe
    if (cp >= 4000 && cp <= 4999) return 600; // NOA
    if (cp >= 5000 && cp <= 5999) return 500; // Cuyo
    if (cp >= 8000 && cp <= 9999) return 800; // Patagonia
    
    return 300; // Por defecto
  }
}

// Exportar clases para uso global
window.AndreaniAPI = AndreaniAPI;
window.CalculadoraEnvio = CalculadoraEnvio;
window.ANDREANI_CONFIG = ANDREANI_CONFIG;
