# Configuración de la API de Andreani

Este proyecto incluye integración con la API de Andreani para cotización de envíos en tiempo real.

## 📋 Requisitos previos

1. **Cuenta en Andreani**: Debes tener una cuenta empresarial con Andreani
2. **API Key**: Solicitar credenciales de API a tu representante comercial
3. **Número de sucursal**: Tener tu sucursal registrada en el sistema

## 🔧 Configuración inicial

### 1. Obtener credenciales de API

Contacta a Andreani para obtener:
- **API Key**: Token de autenticación
- **Usuario y contraseña**: Para autenticación
- **Número de sucursal**: Tu identificador en el sistema
- **URLs de API**: Tanto para testing como producción

### 2. Configurar el archivo `js/andreani-api.js`

Edita las siguientes líneas en el archivo:

```javascript
const ANDREANI_CONFIG = {
  // Reemplaza con tu API Key real
  API_KEY: 'TU_API_KEY_AQUI',
  
  // Reemplaza con tus credenciales
  USERNAME: 'TU_USUARIO_AQUI',
  PASSWORD: 'TU_PASSWORD_AQUI',
  
  // Configuración de tu sucursal
  SUCURSAL: {
    codigoPostal: '2800', // Tu código postal
    direccion: 'Justa Lima 123', // Tu dirección
    ciudad: 'Zárate', // Tu ciudad
    provincia: 'Buenos Aires', // Tu provincia
    numeroSucursal: 'TU_NUMERO_SUCURSAL' // Tu número de sucursal
  },
  
  // Cambiar a 'production' cuando esté listo
  ENVIRONMENT: 'testing'
};
```

### 3. Configurar productos

Si tus productos tienen peso y dimensiones específicas, puedes agregarlos en la estructura del carrito:

```javascript
// Ejemplo de producto con peso y dimensiones
const producto = {
  nombre: "Remera",
  precio: 2500,
  peso: 0.3, // kg
  dimensiones: {
    alto: 2,   // cm
    ancho: 25, // cm
    largo: 30  // cm
  }
};
```

## 🌐 Endpoints de la API de Andreani

### Autenticación
```
POST /login
Content-Type: application/json

{
  "username": "tu_usuario",
  "password": "tu_password"
}
```

### Cotización de envíos
```
POST /envios/cotizar
x-authorization-token: {token}
Content-Type: application/json

{
  "cpOrigen": "2800",
  "cpDestino": "1234",
  "peso": 1.5,
  "volumen": {
    "alto": 10,
    "ancho": 15,
    "largo": 20
  },
  "valorDeclarado": 5000,
  "cliente": "numero_sucursal"
}
```

### Consultar sucursales
```
GET /sucursales?cp=1234
x-authorization-token: {token}
```

## 🔄 Flujo de funcionamiento

1. **Usuario ingresa código postal** en el checkout
2. **Sistema valida** el formato (4 dígitos)
3. **Se calcula peso y volumen** total del carrito
4. **Se intenta conectar** a la API de Andreani
5. **Si la API responde**: Se muestran cotizaciones reales
6. **Si hay error**: Se muestran tarifas estimadas como fallback

## 📊 Cálculo de tarifas estimadas

Si la API no está disponible, el sistema usa un algoritmo de estimación basado en distancia:

- **CP 2800-2900** (Zárate y alrededores): $600-900
- **CP 1000-1999** (CABA y GBA): $800-1200
- **CP 2000-2999** (Provincia de Buenos Aires): $900-1350
- **CP 3000-3999** (Córdoba, Santa Fe): $1200-1800
- **CP 4000-4999** (NOA): $1500-2250
- **CP 5000-5999** (Cuyo): $1400-2100
- **CP 8000-9999** (Patagonia): $1800-2700

## 🛠️ Testing

### Ambiente de testing
1. Configurar `ENVIRONMENT: 'testing'` en el archivo de configuración
2. Usar credenciales de testing proporcionadas por Andreani
3. Probar con códigos postales conocidos

### Códigos postales de prueba
- **1234**: CABA
- **1636**: GBA
- **5000**: Córdoba
- **4000**: Tucumán
- **8300**: Neuquén

## 🚀 Puesta en producción

1. **Verificar credenciales** de producción con Andreani
2. **Cambiar environment** a `'production'`
3. **Actualizar URLs** si es necesario
4. **Probar con pedidos reales** en pequeña escala
5. **Monitorear logs** para detectar errores

## 🔍 Debugging

### Logs útiles
Los errores se registran en la consola del navegador:
- Errores de autenticación
- Errores de API
- Respuestas inesperadas
- Fallbacks a tarifas estimadas

### Problemas comunes

1. **Error 401 (No autorizado)**
   - Verificar API Key
   - Verificar usuario/contraseña
   - Contactar a Andreani para validar credenciales

2. **Error 400 (Bad Request)**
   - Verificar formato de datos
   - Validar código postal origen y destino
   - Revisar peso y dimensiones

3. **Error 500 (Server Error)**
   - Problema en los servidores de Andreani
   - Usar fallback a tarifas estimadas
   - Reintentar más tarde

## 📞 Soporte

- **Documentación oficial**: [https://developers.andreani.com](https://developers.andreani.com)
- **Soporte técnico Andreani**: soporte@andreani.com
- **Representante comercial**: Contacta a tu representante asignado

## 📝 Notas importantes

- La API de Andreani puede tener límites de rate limiting
- Las tarifas pueden cambiar sin previo aviso
- Siempre mantener el sistema de fallback activo
- Monitorear regularmente el funcionamiento de la integración
- Guardar logs de transacciones para auditoría
