# Plan de Pruebas - Capri Store

## 1. Objetivo y Alcance
- Asegurar que las funcionalidades críticas del e-commerce (catálogo, carrito, checkout, cálculo de envío, pagos, notificaciones y contacto) operen correctamente antes del despliegue a producción.
- Validar la integración end-to-end entre frontend (HTML/CSS/JS), backend Express, PostgreSQL, Mercado Pago, Andreani API y WhatsApp Business.

## 2. Roles y Responsables
| Rol | Responsable | Responsabilidades |
| --- | --- | --- |
| QA Lead | __________________ | Definir estrategia, coordinar ejecución y consolidar resultados. |
| QA Tester | __________________ | Ejecutar casos, documentar evidencia y reportar defectos. |
| Dev Backend | __________________ | Resolver incidencias en APIs, Mercado Pago, Andreani, WhatsApp. |
| Dev Frontend | __________________ | Corregir issues de UI, carrito, validaciones. |

## 3. Ambiente y Datos de Prueba
- Rama: `main`
- Entorno: local (`npm install && npm start`) y staging Render.
- Variables `.env`: tokens de Mercado Pago (test/producción), credenciales Andreani, `ADMIN_WHATSAPP`, `ADMIN_INSTAGRAM`, `ADMIN_EMAIL`.
- Datos: catálogo base del sitio; usuarios ficticios con distintas direcciones y códigos postales; tarjetas de prueba Mercado Pago.
- Dependencias externas:
  - Mercado Pago Sandbox (`https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/test-cards`).
  - Andreani API (credenciales QA).
  - WhatsApp Business mediante `whatsapp-web.js` (número configurado).

## 4. Riesgos Principales
| ID | Riesgo | Mitigación |
| -- | ------ | ---------- |
| R1 | Tokens inválidos o caducados de Mercado Pago/Andreani | Verificar credenciales antes de iniciar pruebas. |
| R2 | Desconexión de WhatsApp Business | Mantener sesión activa, monitorear consola al levantar backend. |
| R3 | Incompatibilidad responsive en dispositivos clave | Ejecutar smoke responsive en Chrome/Edge (desktop), Chrome/Safari (mobile), Firefox. |
| R4 | Inestabilidad de APIs externas durante pruebas | Definir ventanas de prueba y reintentos controlados. |

## 5. Criterios de Entrada
- Código integrado en `main` y despliegue en staging actualizado.
- Variables de entorno configuradas y validadas.
- Casos de prueba priorizados disponibles en herramienta de seguimiento.

## 6. Criterios de Salida / Go-Live
- 100% de casos críticos ejecutados.
- 0 defectos críticos/altos abiertos.
- Evidencias almacenadas (capturas, logs, IDs de pago/envío).
- Aprobación formal de QA Lead y Product Owner.

## 7. Estrategia de Prueba
- **Funcional**: flujo end-to-end de compra, contacto y notificaciones.
- **Integración**: Mercado Pago (success/pending/failure), Andreani, WhatsApp Business.
- **UI/UX**: comportamiento responsive, validaciones de formularios, accesos a redes sociales.
- **Regresión dirigida**: carrito/localStorage, páginas de estado (`success.html`, `failure.html`, `pending.html`).
- **Smoke post-deploy**: verificación rápida en producción antes de abrir tráfico.

## 8. Funcionalidades Críticas a Validar
| ID | Funcionalidad | Objetivo | Tipo |
| --- | ------------- | -------- | ---- |
| F1 | Catálogo y detalle de producto (`index.html`, `detalle.html`) | Mostrar productos, carrusel, CTA "Agregar al carrito". | UI/Funcional |
| F2 | Carrito persistente (`js/main.js`, localStorage) | Agregar, editar, eliminar items, totales actualizados. | Funcional |
| F3 | Checkout (`checkout.html`, `js/checkout.js`) | Validaciones, cálculo de envío Andreani, resumen final. | Funcional/Integración |
| F4 | Pago Mercado Pago (`success.html`, `failure.html`, `pending.html`) | Redirecciones correctas, estados reflejados. | Integración |
| F5 | Notificaciones WhatsApp (`js/whatsapp-service.js`) | Envío automático al completar compra exitosa. | Integración |
| F6 | Contacto directo (WhatsApp, Instagram, Email) | Links con datos dinámicos del `.env`, mensaje predefinido. | UI/Funcional |
| F7 | Backend Express (`js/server.js`) | Endpoints sanos, logs, conexión PostgreSQL. | Backend |

## 9. Casos de Prueba Prioritarios
| ID | Escenario | Pasos resumidos | Datos | Resultado esperado |
| --- | -------- | --------------- | ----- | ------------------ |
| TC01 | Smoke inicial | Levantar backend (`npm start`); abrir `http://localhost:3001`; verificar carga de assets. | N/A | Sitio renderiza hero, carrusel y productos. |
| TC02 | Carrito persistente | Agregar 2 productos, actualizar cantidades, recargar página. | Productos demo | Items y totales persisten vía localStorage. |
| TC03 | Cálculo de envío Andreani | Completar checkout con CP válido; solicitar cotización. | CP 2000 / 5000 | Retorna costo y plazo estimado; se suma al total. |
| TC04 | Pago exitoso Mercado Pago | Completar checkout y pagar con tarjeta de prueba aprobada. | Tarjeta Visa test | Redirección a `/success.html`, pedido registrado, notificación WhatsApp enviada. |
| TC05 | Pago rechazado | Repetir flujo con tarjeta rechazada. | Tarjeta con rechazo | Redirección a `/failure.html`, mensaje instructivo mostrado, sin notificación. |
| TC06 | Pago pendiente | Usar medio que genere estado pendiente. | Ticket test | Redirección a `/pending.html`, se muestra instrucción de espera. |
| TC07 | Contacto WhatsApp | Desde `index.html`, click en botón WhatsApp. | Número `.env` | Se abre WhatsApp Web/app con mensaje prellenado correcto. |
| TC08 | Notificación WhatsApp | Confirmar recepción del mensaje en número admin tras pago exitoso. | Pedido TC04 | Mensaje contiene cliente, productos, total y estado. |
| TC09 | Integración PostgreSQL | Crear compra y validar registro en DB. | Pedido TC04 | Registro insertado con estado correcto. |

## 10. Matriz de Navegadores/Dispositivos
| Navegador | Desktop | Mobile |
| --------- | ------- | ------ |
| Chrome (última) | ✅ | ✅ |
| Edge (última) | ✅ | N/A |
| Firefox | ✅ | N/A |
| Safari | N/A | ✅ (iOS) |
| Chrome Android | N/A | ✅ |

## 11. Seguimiento y Evidencia
- Herramienta sugerida: Jira/Sheets (ID de caso, estado, evidencias).
- Almacenar capturas, videos y logs en carpeta compartida.
- Documentar IDs de pago Mercado Pago y tracking Andreani para trazabilidad.

## 12. Checklist Pre-Producción
1. Variables de entorno (Mercado Pago PROD, Andreani, WhatsApp) verificadas.
2. Base de datos PostgreSQL limpia y migraciones aplicadas.
3. Certificados/SSL de Render vigentes.
4. Resultados de pruebas firmados por QA y aprobados por Stakeholders.
5. Plan de rollback definido (último release estable).

---
Actualizado: 28/01/2026
