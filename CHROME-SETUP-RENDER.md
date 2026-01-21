# Configuración de Chrome/Chromium en Render

## Problema
WhatsApp Web requiere Puppeteer/Chrome para funcionar, pero Render Free tiene limitaciones con los ejecutables del sistema.

## Solución Implementada

### 1. Dependencias actualizadas
- Se agregó `puppeteer` (v23.11.1) a las dependencias en `package.json`
- Puppeteer descarga automáticamente Chromium durante el build

### 2. Build Command Actualizado
En `render.yaml`, el buildCommand instala Chrome:
```yaml
buildCommand: |
  npm install
  npx puppeteer browsers install chrome
```

### 3. Detección Automática de Chrome
El código en `whatsapp-service.js` busca Chrome en múltiples ubicaciones:
1. Ejecutable de Puppeteer (`.cache/puppeteer/chrome/...`)
2. Chrome del sistema (`/usr/bin/google-chrome-stable`)
3. Variables de entorno (`PUPPETEER_EXECUTABLE_PATH`)

## Pasos para Desplegar

### Método Recomendado (Ya Configurado)

1. **Commit y Push:**
   ```bash
   git add .
   git commit -m "fix: Configurar Chrome para Render con puppeteer browsers"
   git push origin main
   ```

2. **En Render Dashboard → Manual Deploy**
   - El build command instalará Chrome automáticamente
   - Revisa los logs del build, debes ver:
     ```
     🔧 Instalando dependencias de Node.js...
     🌐 Instalando Chrome via Puppeteer...
     ```

3. **Verificar en logs de inicio:**
   ```
   ✅ Chromium de Puppeteer encontrado: /opt/render/project/src/.cache/puppeteer/chrome/...
   ```

### Si el Método Anterior Falla: Instalación Manual de Chrome

Si ves el error `ENOENT` o `Chrome not found`, usa este Build Command alternativo:

**En Render Dashboard → Settings → Build Command:**

```bash
apt-get update && \
apt-get install -y wget gnupg ca-certificates && \
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
apt-get update && \
apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 --no-install-recommends && \
npm install
```

**IMPORTANTE:** Este método requiere más tiempo de build (3-5 minutos).

## Troubleshooting

### Error: "spawn chrome ENOENT"
**Causa:** Chrome descargado pero faltan dependencias del sistema.

**Solución:**
1. Usar el Build Command alternativo (con apt-get)
2. O agregar variable de entorno en Render:
   ```
   PUPPETEER_SKIP_DOWNLOAD=false
   ```

### Error: "Failed to launch browser process"
**Causa:** Permisos o arquitectura incorrecta.

**Solución:**
1. Verificar que estás usando la arquitectura correcta (linux64)
2. En `render.yaml`, asegurar:
   ```yaml
   env: node
   plan: free
   ```

### Chrome descargado pero no arranca
**Causa:** Faltan librerías del sistema (libnss3, libatk, etc.)

**Solución:** Usar el Build Command completo con todas las dependencias.

### Logs útiles para debugging

Durante el build:
```bash
npx puppeteer browsers install chrome
# Debe mostrar progreso de descarga
```

Durante el inicio:
```
🔍 Buscando Chrome en cache: /opt/render/project/src/.cache/puppeteer/chrome
✅ Chrome encontrado en cache: /opt/render/project/src/.cache/puppeteer/chrome/linux-131.../chrome
```

## Variables de Entorno Configuradas

En `render.yaml`:
```yaml
- key: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD
  value: false
- key: PUPPETEER_EXECUTABLE_PATH  
  value: /usr/bin/google-chrome-stable
```

## Limitaciones del Plan Free de Render

- ⏰ Build timeout: 15 minutos
- 💾 Espacio limitado: ~512MB para dependencias
- 🚀 Instancia se reinicia cada ~15 min de inactividad
- 📦 Cache de build puede no persistir entre deploys

**Recomendación:** Si WhatsApp necesita reconectarse frecuentemente, considera upgrade a plan Starter ($7/mes) con más recursos y persistencia.

