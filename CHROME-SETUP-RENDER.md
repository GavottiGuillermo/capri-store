# Configuración de Chrome/Chromium en Render

## Problema
WhatsApp Web requiere Puppeteer/Chrome para funcionar, pero Render no incluye Chrome por defecto.

## Solución Implementada

### 1. Dependencias actualizadas
- Se agregó `puppeteer` (v23.11.1) a las dependencias en `package.json`
- Puppeteer descarga automáticamente Chromium durante `npm install`

### 2. Configuración de Puppeteer
- Se creó `.puppeteerrc.cjs` para configurar el cache de Chromium
- Se actualizo `whatsapp-service.js` para detectar y usar el ejecutable correcto

### 3. Variables de entorno en Render
Las siguientes variables ya están configuradas en `render.yaml`:
```yaml
- key: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD
  value: false
- key: PUPPETEER_EXECUTABLE_PATH
  value: /usr/bin/google-chrome-stable
```

## Pasos para Desplegar

### Opción A: Confiar en Puppeteer (Recomendado)
1. Hacer commit y push de los cambios:
   ```bash
   git add .
   git commit -m "fix: Agregar puppeteer para soporte de Chrome en Render"
   git push origin main
   ```

2. En Render Dashboard, hacer **Manual Deploy**

3. Render instalará automáticamente Chromium via Puppeteer

### Opción B: Instalar Chrome del Sistema (Alternativa)
Si la Opción A falla, instalar Chrome en Render:

1. En **Render Dashboard** → tu servicio → **Settings**

2. En **Build Command**, cambiar de:
   ```
   npm install
   ```
   a:
   ```bash
   apt-get update && apt-get install -y wget gnupg && \
   wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
   echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list && \
   apt-get update && \
   apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 --no-install-recommends && \
   npm install
   ```

3. Guardar y hacer **Manual Deploy**

## Verificación

Después del deploy, verificar en los logs que se vea:
```
✅ Chromium encontrado en: /opt/render/project/src/.cache/puppeteer/chrome/...
```

O en caso de usar Chrome del sistema:
```
⚠️ Puppeteer no disponible, usando path del sistema: /usr/bin/google-chrome-stable
```

## Troubleshooting

### Error: "Could not find expected browser (chrome)"
- Asegurarse que `puppeteer` está en `package.json` (no `puppeteer-core`)
- Verificar que el build command instale todas las dependencias
- Revisar los logs de build para errores durante `npm install`

### Error: "Protocol error (Target.setDiscoverTargets)"
- Chrome/Chromium está instalado pero faltan dependencias del sistema
- Usar el build command de la Opción B que instala librerías necesarias

### Error: "Navigation timeout"
- Aumentar `timeout` en configuración de puppeteer en `whatsapp-service.js`
- Verificar que el servidor tiene suficiente memoria (plan Free puede ser limitado)
