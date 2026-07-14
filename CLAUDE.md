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
- **Sin auth de usuarios todavía**: no hay `jsonwebtoken`/`bcrypt`/sesiones. Falta agregar para el panel admin (Fase 1).
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
- [ ] **Fase 1 — Auth de admin.** Login simple (usuario fijo + password hasheado con bcrypt, JWT o sesión) protegiendo todo `/admin/*`. No reusar la API-key legacy.
- [ ] **Fase 2 — Artículos Web.** Endpoints en `routes/admin.js` que reemplacen `generarYSubirArticulo`, `modificarArticuloEnWeb`, `aplicarAjustePorcentualEnWeb` de `Controlador_Pestanias.java`, + pantalla web simple para operarlo. Desktop sigue funcionando en paralelo.
- [ ] **Fase 3 — Stock / carga de lotes.**
- [ ] **Fase 4 — Ventas presenciales.**
- [ ] **Fase 5 — Cash flow.**
- [ ] **Fase 6 — Retirar módulos del desktop ya migrados** (uno por uno, con paridad confirmada).

## Estado actual

Fase 0 completada (2026-07-14). Próximo paso: Fase 1 (auth de admin) sobre `js/routes/admin.js`.
