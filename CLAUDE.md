# Capri — Migración a panel admin web

Este repo es el backend/frontend de la tienda online de Capri (Node/Express + HTML/Bootstrap plano, sin framework de frontend). Está en producción: procesa pagos reales de MercadoPago. **Cualquier cambio debe evitar romper el checkout existente.**

Objetivo del proyecto: convertir esto en el producto integrado de gestión del negocio (hoy vive en una app de escritorio Java separada) + venta online, todo en un mismo backend web. Ver plan de fases más abajo — se implementa de a una fase por vez, en orden, sin saltar pasos.

## Arquitectura actual

- **`js/server.js`**: bootstrap de Express (env, CORS, middlewares, arranque). Rutas y lógica de negocio viven en módulos separados (ver debajo). Punto de entrada real: `start-optimized.js` en la raíz (ver `package.json` → `scripts.start`).
- **`js/db.js`**: pool de Postgres (`pg.Pool`), `initializeDatabase`, retry de queries, utilidades de esquema/tabla y de payment id.
- **`js/services/mercadopago.js`**: cliente de MercadoPago (`MercadoPagoConfig`, `Preference`, `Payment`).
- **`js/services/whatsapp.js`**: lógica de notificaciones de compra (envío, reintentos, normalización de teléfono/plantillas). Usa `js/whatsapp-api-service.js` (API oficial de Meta) para el envío real.
- **`js/routes/store.js`**: todas las rutas de catálogo/checkout/webhook de MercadoPago/health/debug que antes vivían inline en `server.js`.
- **`js/routes/admin.js`**: scaffold vacío, ahí van las rutas del panel admin a partir de Fase 1.
- **Postgres compartido**: este backend se conecta con `pg.Pool` a la **misma base de datos** que usa la app de escritorio Java (ver sección siguiente). Tabla clave: `productos` (cada fila = 1 unidad física: `id_articulo`, `prenda`, `color`, `talle`, `estado`, `publicado_en_web`). El checkout crea pedidos vía stored procedure `sp_crear_pedido_web`. **No cambiar el esquema de esta tabla sin coordinarlo con el lado Java** (rompe `Controlador_Pestanias.java`).
- **GCS bucket `imagenes-web-capri`**: imágenes + archivos `.txt` de catálogo (`productos.json` como índice). Ver detalle en memoria de proyecto si hace falta (`Novedades/{id}-{Nombre}-{Color}/`, txt de 4 líneas: Nombre/Descripción/Precio/Detalle).
- **MercadoPago**: `mercadopago` SDK, checkout + webhook con validación de stock.
- **WhatsApp**: `js/whatsapp-api-service.js` (API oficial de Meta, único medio activo). El enfoque anterior con `whatsapp-web.js` (QR) — `js/whatsapp-service.js`, `js/postgres-auth-strategy.js` — se eliminó en Fase 0 por no tener consumidor real; si aparece una referencia a esos archivos en una rama vieja, es código muerto.
- **`js/services/auth.js`**: auth del panel admin (Fase 1) — usuario fijo + `bcryptjs` + JWT en cookie httpOnly. Ver `js/routes/admin.js` para el middleware que protege `/admin/*`.
- **Hosting**: Render (`render.yaml`), memoria acotada (`--max-old-space-size=450/512` en los scripts de npm). Evitar features que carguen mucha memoria en el proceso principal.
- **Sin tests automatizados** (`npm test` es un stub). Verificar cambios manualmente contra `TEST-PLAN.md` o levantando el server local y probando el flujo a mano.

## El otro lado: app de escritorio Java (fuente de la lógica de negocio a migrar)

Repo separado en esta misma máquina: `C:\Users\guillermo.gavotti\IdeaProjects\SistemaCapri\SistemaCapri\`

Al implementar cada módulo del admin web, **leer primero el equivalente Java** para no perder reglas de negocio (validaciones, cálculos, estados) que hoy solo existen ahí:

| Módulo a migrar | Archivo Java de referencia |
|---|---|
| Controlador principal / todas las pestañas (~3300 líneas, leer en trozos) | `src\main\java\org\sistema\Controlador_Pestanias.java` |
| Modelo de artículo de venta | `src\main\java\org\sistema\ModuloVentas\RegistroArticuloVentas.java` |
| Carga de lotes / productos | `src\main\java\org\sistema\ModuloCargaArchivo\RegistroLote.java`, `RegistroProducto.java` |
| Clientes | `src\main\java\org\sistema\ModuloCargaArchivo\RegistroCliente.java` |
| Pagos | `src\main\java\org\sistema\ModuloCargaArchivo\RegistroPago.java` |
| Gastos extra | `src\main\java\org\sistema\ModuloCargaArchivo\RegistroGastoExtra.java` |
| Cash flow | `src\main\java\org\sistema\ModuloCashFlow\RegistroTransaccionCF.java` |
| Conexión a DB (para ver esquema/convenciones) | `src\main\java\org\sistema\config\DatabaseConfig.java` |
| Config de Google Cloud | `src\main\java\org\sistema\GoogleCloudConfig.java` |

`Controlador_Pestanias.java` es grande — leerlo en fragmentos (~200 líneas) buscando el método relevante en vez de cargarlo entero.

## Cómo trabajar en este proyecto

- **Una fase por sesión.** No adelantar fases futuras dentro de la misma tarea aunque parezca fácil — cada una se revisa y confirma antes de seguir.
- Al terminar una fase, **marcar el checklist de abajo** (`[x]`) y dejar una línea breve de qué se hizo, para que la próxima sesión arranque sin tener que releer todo el diff.
- No tocar rutas de checkout/webhook existentes salvo que la fase lo requiera explícitamente.
- Nuevas rutas de admin van en `routes/admin.js` (crear en Fase 0), no inline en `server.js`.
- Cualquier endpoint de escritura sobre `productos` debe replicar las validaciones que hace el Java (estado, publicado_en_web, etc.), no solo el statement SQL.

## Plan de fases

- [x] **Fase 0 — Modularizar `server.js`.** Extraído sin cambiar comportamiento a `js/db.js` (pool Postgres, retry, payment id utils), `js/services/mercadopago.js`, `js/services/whatsapp.js` (notificaciones), `js/routes/store.js` (catálogo/checkout/webhook) y `js/routes/admin.js` (scaffold vacío para Fase 1). `js/server.js` quedó como bootstrap de Express. Se confirmó por grep que `whatsapp-service.js`, `postgres-auth-strategy.js*`, `requireMobileApiKey` y las rutas `/api/whatsapp-status`, `/api/notificaciones-pendientes` y `/limpiar-sesiones-whatsapp` (esta última ya estaba rota, llamaba a una función inexistente) no tenían ningún consumidor real — se borraron junto con las dependencias `whatsapp-web.js`/`qrcode-terminal` en `package.json`. Verificado localmente: server levanta, sirve estáticos, `/health`, `/debug`, `/contact-info`, `/webhook`, `/crear-preferencia` responden igual que antes. Nota: se preservaron dos bugs preexistentes tal cual estaban (no se tocaron, fuera de alcance de esta fase): el bloque `whatsappService` no definido en `/memory-status` y `/cleanup-memory`, y las rutas duplicadas `/memory-status`/`/debug` (la segunda definición de cada una queda inalcanzable, igual que en el original).
- [x] **Fase 1 — Auth de admin.** Login con usuario fijo (`ADMIN_USERNAME`) + password hasheado con `bcryptjs` (`ADMIN_PASSWORD_HASH`, generar con `node scripts/hash-password.js "password"`) y JWT (`jsonwebtoken`) en cookie httpOnly (`js/services/auth.js`). `js/routes/admin.js`: `POST /admin/login`, `POST /admin/logout` públicas; a partir de ahí `router.use(...)` exige JWT válido para cualquier ruta futura de `/admin/*` (incluye `GET /admin/me` para probar la sesión). Freno de fuerza bruta simple en memoria (5 intentos fallidos → bloqueo de 15 min por IP). Páginas `admin-login.html` y `admin.html` (placeholder) en la raíz. No se reusó la API-key legacy (ya eliminada en Fase 0). Verificado localmente: sin cookie → 401, password incorrecta → 401, login correcto → set-cookie + 200, `/admin/me` con cookie → 200, logout invalida la cookie, 6to intento fallido → 429, y el resto del sitio (checkout, health) sigue intacto. **Pendiente antes de producción:** configurar `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` y `JWT_SECRET` reales en las env vars de Render — no existen ahí todavía. El `.env` local tiene credenciales de prueba (`admin` / `TestAdmin123!`) solo para desarrollo.
- [x] **Fase 2 — Artículos Web.** `js/services/gcs.js` (cliente de Google Cloud Storage: sube/lee/borra blobs del bucket `imagenes-web-capri`, upsert de `productos.json`, parseo/generación del `.txt` de catálogo en el formato nuevo de 4 líneas — sin talle — con fallback de lectura al formato viejo de 5 líneas). `js/routes/admin/articulos-web.js` (montado en `/admin/articulos-web`, protegido por el middleware de auth de Fase 1): `GET /productos` (equivalente a `obtenerProductosDesdeBD`, para poblar la tabla de selección), `GET /:idArticulo` (equivalente a `leerDatosTxtDesdeCloud`, para precargar el form de edición), `POST /generar` (equivalente a `generarYSubirArticulo` — multipart con 1 imagen; a diferencia del desktop que sube varios colores en un solo click, acá **una llamada = un color/carpeta**, con la misma validación de "misma prenda" reforzada a "misma prenda y mismo color" por artículo seleccionado — simplificación de UI, no de reglas de negocio: cada color sigue generando su propia carpeta/entrada igual que en Java), `PUT /:idArticulo` (equivalente a `modificarArticuloEnWeb`, imagen nueva opcional), `POST /ajuste-porcentual` (equivalente a `aplicarAjustePorcentualEnWeb`, solo afecta artículos con `publicado_en_web = 'True'`, reporta `omitidos` con motivo en vez de tragárselos en silencio). Todas las rutas exigen `estado = 'Disponible'` igual que el filtro SQL del desktop. Pantalla `admin.html` reescrita con las 3 acciones + tabla de productos con checkboxes y filtro por prenda.
  Se sumó además `DELETE /:idArticulo` (equivalente a `quitarDeLaWeb`: borra la carpeta completa de GCS, la entrada de `productos.json` y desmarca `publicado_en_web` — igual que el desktop, solo desmarca el `id_articulo` puntual aunque la carpeta borrada sea compartida por otros talles del mismo color; limitación preexistente del Java, no introducida acá). Botón "Quitar" agregado a la tabla de `admin.html` para filas publicadas.
  **Verificado localmente** (ya con `DATABASE_URL` y `GOOGLE_APPLICATION_CREDENTIALS` reales cargados en el `.env` local, usando las credenciales que el usuario copió a la raíz — ver `.gitignore`): `GET /productos` responde con datos reales de la BD compartida con el desktop.
  **Bug abierto:** `POST /generar` devuelve 500 en producción (Render) al intentar subir un artículo real; pendiente de diagnóstico con el log exacto de Render (el mensaje que ve el cliente es genérico a propósito). Sospechas: permisos del service account sobre el bucket, o el Secret File/env var de credenciales mal cargado en Render.
  **Pendiente antes de producción:** configurar `GOOGLE_APPLICATION_CREDENTIALS_JSON` (o Secret File + `GOOGLE_APPLICATION_CREDENTIALS`) y confirmar que el service account tenga permiso de escritura sobre `imagenes-web-capri`. Dependencias nuevas: `@google-cloud/storage`, `multer` (agregadas a `package.json`).
- [ ] **Fase 3 — Stock / carga de lotes.**
- [ ] **Fase 4 — Ventas presenciales.**
- [ ] **Fase 5 — Cash flow.**
- [ ] **Fase 6 — Retirar módulos del desktop ya migrados** (uno por uno, con paridad confirmada).

## Estado actual

Fase 2 completada (2026-07-14), pendiente de probar contra GCS/DB reales (ver detalle arriba). Falta configurar en Render: `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` / `JWT_SECRET` (Fase 1) y `GOOGLE_APPLICATION_CREDENTIALS_JSON` (Fase 2). Próximo paso: Fase 3 (Stock / carga de lotes).
