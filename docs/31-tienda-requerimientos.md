# 31 — Tienda online: 120 requerimientos y su estado

> **Corte: 2026-10-09.** Amplía [30 — Tienda online](30-tienda-online.md). La lista
> viene de una propuesta de 60 funcionales y 60 no funcionales; cada uno se
> revisó **contra el código**, no se supuso.
>
> **Numeración:** `RF-T01…RF-T60` y `RNF-T01…RNF-T60`. La "T" es de tienda: el
> sistema ya usa `RF-M…` y `RNF-01…RNF-66` ([03](03-requerimientos-funcionales.md),
> [04](04-requerimientos-no-funcionales.md)), y "RNF-01" no puede significar dos
> cosas.
>
> **Estados:** ✅ hecho y probado · ◐ parcial · ⏳ pendiente · 🔍 por validar
> (falta una medición o una decisión) · — no aplica todavía.
>
> **Publicado vs. local:** Railway tiene el commit `3788b45` ("09-10"). Todo lo
> marcado ✅ después de esa fecha está en el código local hasta el próximo push.

## Resumen

| | ✅ | ◐ | ⏳ | 🔍 / — | Total |
|---|---:|---:|---:|---:|---:|
| Funcionales | 47 | 6 | 7 | 0 | 60 |
| No funcionales | 37 | 16 | 3 | 4 | 60 |

Lo que falta se concentra en cuatro bloques, cada uno con lo que necesita:

| Bloque | Requerimientos | Qué se necesita |
|---|---|---|
| Pedido guardado en el sistema (etapa 2) | RF-T45, T47 a T50, T57; RNF-T22, T48, T49 | Una migración en la base de producción, coordinada antes del push |
| Pago y documentos (etapa 3) | RF-T60 | Cuenta de pasarela a nombre del local (Flow recomendado) y la boleta del pedido |
| Respaldo y continuidad | RNF-T41, T43 a T46 | Desplegar el worker de respaldo o pasar a Supabase Pro; un monitor de disponibilidad |
| Ambientes | RNF-T55 | Un proyecto Supabase aparte para desarrollo (pregunta P-14 de [15](15-preguntas-abiertas.md)) |

---

## 1. Funcionales

### A. Catálogo de productos

| ID | Requerimiento | Prioridad | Estado | Evidencia / nota |
|---|---|---|---|---|
| RF-T01 | Mostrar los productos activos de la sucursal | Must | ✅ | `TIENDA_TENANT_ID`; `datosTienda` filtra `is_active` |
| RF-T02 | Consultar nombre, marca, formato y precio | Must | ◐ | Nombre y precio siempre. Marca y formato salen del nombre (`marcaPorNombre`, `formatoPorNombre`): se muestran cuando el nombre los trae. No hay columna de marca |
| RF-T03 | "Consultar precio" sin precio de venta | Must | ✅ | `precioTienda`; prueba en `tienda.test.ts` |
| RF-T04 | Disponibles y agotados identificables | Must | ✅ | Etiqueta "Agotado"; lo agotado al final. Con "vender sin stock" nada sale agotado |
| RF-T05 | Etiqueta visible de oferta | Must | ✅ | "Oferta" sobre la foto (`rebajaMaximaPct`) |
| RF-T06 | Ficha con URL propia | Must | ✅ | `/tienda/p/<id>` |
| RF-T07 | Productos relacionados | Should | ✅ | `relacionados` (mismo grupo) |
| RF-T08 | Compartir el enlace | Should | ✅ | `Compartir`: menú del celular o copiar |
| RF-T09 | Excluir desactivados o no autorizados | Must | ◐ | Desactivados sí. "No autorizados" requiere RF-T57 |
| RF-T10 | Imagen o presentación alternativa | Must | ✅ | Foto, o ícono del rubro (`iconoProducto`); si la foto no carga, se dice |

### B. Búsqueda, categorías y navegación

| ID | Requerimiento | Prioridad | Estado | Evidencia / nota |
|---|---|---|---|---|
| RF-T11 | Buscar por nombre | Must | ✅ | `filtrarCatalogo` |
| RF-T12 | Buscar por marca | Must | ✅ | Por el texto (la marca suele estar en el nombre) y filtro "Marca" |
| RF-T13 | Ignorar mayúsculas y tildes | Must | ✅ | `normalizarBusqueda`; "azucar" → "Azúcar" |
| RF-T14 | Filtrar por categoría o rubro | Must | ✅ | Categoría del local o rubro automático |
| RF-T15 | Precio mínimo y máximo | Must | ✅ | Probado: $500–$1.000 → 208, todos en rango |
| RF-T16 | Combinar categoría, marca y precio | Must | ✅ | Todo en la dirección; prueba "filtros de la barra lateral" |
| RF-T17 | Ordenar por relevancia, nombre y precio | Must | ✅ | `ORDENES_TIENDA`; sin precio siempre al final |
| RF-T18 | Máximo 48 por página | Must | ✅ | `POR_PAGINA_TIENDA` |
| RF-T19 | Sin resultados: avisar y sugerir | Should | ✅ | Consejo + 4 sugeridos |
| RF-T20 | Restablecer filtros | Should | ✅ | "Limpiar filtros", "Todas las categorías", "Ver todos" |

### C. Ofertas, promociones y precios

| ID | Requerimiento | Prioridad | Estado | Evidencia / nota |
|---|---|---|---|---|
| RF-T21 | Sección de ofertas | Must | ✅ | `/tienda/ofertas` |
| RF-T22 | Precio normal y promocional | Must | ✅ | Tarjeta: precio + "Desde 2: $500 c/u"; carrito: "con oferta (antes $600)" |
| RF-T23 | Explicar la promoción por cantidad | Must | ✅ | Ficha: "Llevando 2 o más: $500 c/u" |
| RF-T24 | Ahorro estimado | Must | ✅ | Ficha por unidad; carrito "Ahorras $X" |
| RF-T25 | Cantidad mínima para la promoción | Must | ✅ | "Desde N"; carrito "Lleva N más y paga $X" (`proximaOferta`) |
| RF-T26 | Oferta vencida deja de mostrarse | Must | ✅ | `tramosVigentes` por día del local; caché de 60 s |
| RF-T27 | Respetar las promociones configuradas | Must | ◐ | Precio por cantidad e interruptor de ofertas: igual que la caja. **Los combos (0023) no se aplican en la tienda** |
| RF-T28 | Actualizar precios cuando cambian | Must | ✅ | < 1 minuto en el catálogo; el carrito se pone al día |
| RF-T29 | Avisar si no hay precio confirmado | Must | ✅ | "Consultar precio"; no se puede agregar al carrito |
| RF-T30 | Ver la promoción antes de agregar | Should | ✅ | Recuadro "Ofertas de hoy" en la ficha |

### D. Carrito

| ID | Requerimiento | Prioridad | Estado | Evidencia / nota |
|---|---|---|---|---|
| RF-T31 | Agregar desde las tarjetas | Must | ✅ | `AgregarAlCarrito` |
| RF-T32 | Agregar desde la ficha | Must | ✅ | |
| RF-T33 | Aumentar y disminuir | Must | ✅ | − cantidad + |
| RF-T34 | Eliminar un producto | Must | ✅ | "Quitar" |
| RF-T35 | Vaciar el carrito | Must | ✅ | "Vaciar", pide confirmación |
| RF-T36 | Conservarlo entre visitas | Must | ✅ | Almacenamiento del navegador; probado al recargar |
| RF-T37 | Subtotal por producto y total | Must | ✅ | `calcularCarrito` |
| RF-T38 | Recalcular promociones al cambiar cantidades | Must | ✅ | Prueba "con 2, el precio desde 3 no rige" |
| RF-T39 | Precios al día antes de enviar | Must | ✅ | Al abrir el carrito y al volver a la pestaña (`/api/tienda/productos`) |
| RF-T40 | Avisar cambio de precio, agotado o retirado | Must | ✅ | Probado: "cambió de precio: ahora $600" |

### E. Clientes, pedidos y pagos

| ID | Requerimiento | Prioridad | Estado | Evidencia / nota |
|---|---|---|---|---|
| RF-T41 | Consultar sus datos sin exponerlos | Must | ✅ | "Mi cuenta": solo en el navegador del cliente |
| RF-T42 | Editar datos de contacto | Should | ✅ | Con validación (`validarDatosCliente`) |
| RF-T43 | Historial de pedidos | Should | ◐ | "Mis pedidos" de ese dispositivo (los enviados por WhatsApp). Historial real con la etapa 2 |
| RF-T44 | Volver a pedir | Should | ✅ | "Volver a pedir" |
| RF-T45 | Checkout para confirmar productos y cantidades | Must | ⏳ | Hoy el carrito se envía por WhatsApp. Etapa 2 |
| RF-T46 | Pedir datos de contacto para el pedido | Must | ◐ | El carrito los pide y los pone en el mensaje; no son obligatorios para enviar |
| RF-T47 | Elegir modalidad de entrega | Should | ⏳ | Etapa 2 (retiro) y 4 (despacho) |
| RF-T48 | Registrar el pedido con identificador único | Must | ⏳ | Etapa 2 (migración) |
| RF-T49 | El personal gestiona los pedidos web | Must | ⏳ | Pantalla "Pedidos web", etapa 2 |
| RF-T50 | Estados del pedido y aviso al cliente | Must | ⏳ | Etapa 2; correo necesita cuenta de Resend |

### F. Administración, fotos e integraciones

| ID | Requerimiento | Prioridad | Estado | Evidencia / nota |
|---|---|---|---|---|
| RF-T51 | Personal autorizado gestiona las fotos de su local | Must | ✅ | Productos → Foto; admin, supervisor y bodega; el local sale de la sesión |
| RF-T52 | Validar tipo y tamaño de la imagen | Must | ✅ | JPG/PNG/WebP por sus bytes, ≤ 5 MB |
| RF-T53 | Buscar el producto por código de barras | Should | ✅ | `/api/productos/codigo` (Open Food Facts) |
| RF-T54 | Completar datos desde fuentes externas | Should | ✅ | Alta escaneada: nombre, descripción y foto, con "Deshacer". Lote: `npm run db:fotos` |
| RF-T55 | Conservar la atribución de fotos externas | Must | ✅ | Pie de la tienda y nota en el formulario (CC BY-SA) |
| RF-T56 | Consultar o enviar el pedido por WhatsApp | Should | ◐ | Listo; aparece cuando la sucursal tenga celular anotado (hoy no) |
| RF-T57 | Elegir qué productos se publican | Should | ⏳ | Necesita una columna nueva (migración) |
| RF-T58 | Sitemap | Should | ✅ | `/sitemap.xml` con todas las fichas |
| RF-T59 | Metadatos y vista previa al compartir | Should | ✅ | Título, descripción, Open Graph, datos schema.org |
| RF-T60 | Integrar pago, documentos y correo | Could | ⏳ | Etapa 3; cuentas externas |

---

## 2. No funcionales

### A. Rendimiento y capacidad

Condiciones de prueba (2026-10-09): Edge sin interfaz, celular de 390 px,
red 4G simulada (150 ms de latencia, ~6,4 Mb/s) y CPU 4 veces más lenta.
Carga: versión de producción en un PC local, sesiones que "piensan" 0,5–1,5 s
entre clics. Scripts en el historial de la sesión; resultados aquí.

| ID | Requerimiento | Criterio | Estado | Medición |
|---|---|---|---|---|
| RNF-T01 | Carga rápida | LCP ≤ 2,5 s p75 | ✅ | **Railway:** Inicio 0,97 s · búsqueda 0,76 s · Ofertas 0,73 s (p75) |
| RNF-T02 | Búsqueda oportuna | ≤ 1 s p95 | ✅ | Servidor sin carga: p95 38 ms. Con 100 sesiones simultáneas: p95 1,9 s (ver T05) |
| RNF-T03 | Filtros y orden oportunos | ≤ 1 s p95 | ✅ | Igual que T02 (son la misma página) |
| RNF-T04 | Imágenes diferidas | lazy | ✅ | `loading="lazy"` en todas las fotos |
| RNF-T05 | Visitas simultáneas | 100 sesiones sin errores críticos | ✅ | 100 sesiones, 2 min, ~6.000 solicitudes (50/s): **0 errores**. Latencia p50 1,06 s, p95 1,9 s. 100 compradores activos a la vez es mucho más de lo que tendrá un almacén |
| RNF-T06 | Memoria y CPU controladas | sin crecimiento en 30 min | ◐ | En 2 min la memoria sube al calentarse y se estabiliza en ~540 MB. Falta la prueba de 30 min |
| RNF-T07 | Consultas eficientes | plan de ejecución revisado | ◐ | Una lectura del catálogo por minuto (en memoria 60 s), no una por visita. Falta revisar el plan con `EXPLAIN` |
| RNF-T08 | Paginación limita los datos | ≤ 48 por página | ✅ | |
| RNF-T09 | Imágenes en tamaño adecuado | tamaños según espacio | ◐ | Fotos del celular a 800 px; las de Open Food Facts ~400 px. No hay tamaños distintos para tarjeta y ficha (Supabase lo da en el plan Pro) |
| RNF-T10 | Aguanta el doble de catálogo | umbrales con 2× | ✅ | Filtrar y ordenar 1.602 productos: p95 1,1 ms (801: 0,5 ms). El costo está en armar el HTML, que no depende del tamaño del catálogo (48 por página) |

### B. Seguridad y control de acceso

| ID | Requerimiento | Criterio | Estado | Evidencia / nota |
|---|---|---|---|---|
| RNF-T11 | No exponer información interna | sin costos ni datos internos | ✅ | El servidor elige las columnas; "Código anterior" se limpia (`descripcionPublica`); la API pública solo da id, nombre, precio, ofertas y disponibilidad |
| RNF-T12 | Permisos en cada operación | acceso denegado sin permiso | ✅ | `/api/productos/*`: 403 sin rol; sin sesión el middleware manda al ingreso |
| RNF-T13 | Prevenir inyección SQL | parámetros + pruebas | ◐ | La tienda no arma SQL: todo va por supabase-js (parámetros). Falta una prueba específica de inyección |
| RNF-T14 | Prevenir XSS | tratamiento por contexto + pruebas | ◐ | React escapa todo; el único HTML crudo (datos para Google) escapa `<`. Falta prueba específica |
| RNF-T15 | Protección CSRF | según la sesión | ✅ | La sesión va en cookies `SameSite=Lax` (Supabase SSR): otro sitio no puede mandar un POST con ellas. DELETE y JSON exigen CORS, que no está abierto |
| RNF-T16 | HTTPS | producción | ✅ | Railway + `Strict-Transport-Security` |
| RNF-T17 | Secretos privados | fuera del código | ✅ | Variables de entorno; a Open Food Facts no se le manda nada personal |
| RNF-T18 | Limitar abuso | límites + pruebas | ✅ | `lib/limites.ts`: tienda 60/min por IP, ficha y foto 30/min por usuario; 429 con `Retry-After`. Prueba de `crearLimitador` |
| RNF-T19 | Validar en el servidor | rechaza datos inválidos | ✅ | Ids con patrón, filtros parseados, foto validada |
| RNF-T20 | Archivos no confiables | formato real, tamaño | ✅ | `tipoRealDeFoto` (bytes), ≤ 5 MB; la foto del celular se vuelve a dibujar en el navegador (sale sin EXIF/GPS) |

### C. Privacidad y datos personales

**Inventario de datos personales de la tienda** (RNF-T21, T23, T30):

| Dato | Dónde | Para qué | Cuánto tiempo |
|---|---|---|---|
| Nombre, celular, correo (opcional) | Navegador del cliente (`tienda:cliente`) | Saber a quién entregarle el pedido | Hasta que el cliente lo borre |
| Carrito | Navegador (`tienda:carrito`) | No perder lo elegido | Hasta que lo vacíe o borre sus datos |
| Pedidos enviados (últimos 20) | Navegador (`tienda:pedidos`) | "Volver a pedir" | Hasta que los borre |
| Pedido enviado | WhatsApp del local | Entregarlo | Lo decide el local (política pendiente) |
| A Open Food Facts | Solo el código de barras | Ficha y foto | — |

| ID | Requerimiento | Criterio | Estado | Evidencia / nota |
|---|---|---|---|---|
| RNF-T21 | Solo los datos necesarios | finalidad por campo | ✅ | Inventario de arriba; no se pide RUT, dirección ni pago |
| RNF-T22 | Aislamiento entre cuentas | — | — | No hay cuentas de clientes todavía. Aplica con la etapa 2 |
| RNF-T23 | Datos locales seguros | documentados, sin secretos | ✅ | Inventario; no se guarda nada secreto |
| RNF-T24 | Borrar los datos locales | borra todo lo del alcance | ✅ | "Borrar mis datos" borra datos, pedidos **y carrito** |
| RNF-T25 | Registros sin datos personales | sin tokens ni datos | ✅ | Los registros de la tienda anotan códigos de barras y estados HTTP, nada personal |
| RNF-T26 | Política de conservación | plazos documentados | ◐ | Los de la tienda están en la página de privacidad; falta que el local fije el de los pedidos por WhatsApp |
| RNF-T27 | WhatsApp con lo mínimo | solo lo necesario | ✅ | El mensaje lleva el pedido, el nombre y el celular, y solo si el cliente los guardó |
| RNF-T28 | Procedimientos de derechos | acceso, rectificación, eliminación | ◐ | La página dice cómo pedirlo; falta el procedimiento interno del local |
| RNF-T29 | Política de privacidad pública | enlazada desde la tienda | ✅ | `/tienda/privacidad`, en el pie y en "Mi cuenta". **Borrador:** el local debe revisarlo y completar RUT y correo |
| RNF-T30 | Integraciones con lo mínimo | campos documentados | ✅ | Inventario de arriba |

### D. Usabilidad, accesibilidad y compatibilidad

| ID | Requerimiento | Criterio | Estado | Evidencia / nota |
|---|---|---|---|---|
| RNF-T31 | 320 a 1920 px | se ve bien | ✅ | Probado en 320, 390, 1440, 1536 y 1920 px |
| RNF-T32 | Sin scroll horizontal | desde 320 px | ✅ | 6 vistas a 320 px |
| RNF-T33 | Controles táctiles de 44 px | mínimo 44 × 44 | ✅ | Botones de 44 px; la barra lateral se subió de 36 a 44 px |
| RNF-T34 | Navegación consistente | | ✅ | Las mismas pestañas arriba (computador) o abajo (celular) en todas las páginas |
| RNF-T35 | Errores comprensibles | qué pasó y qué hacer | ✅ | Páginas de error y "no encontrado" propias; mensajes de foto y carrito en palabras |
| RNF-T36 | Teclado | sin ratón | ✅ | Probado: Tab hasta "Agregar" y Enter lo agrega |
| RNF-T37 | Texto alternativo | | ✅ | Las fotos van con `alt` vacío porque el nombre del producto está al lado (no se repite en el lector); la vista previa del formulario tiene "Foto del producto" |
| RNF-T38 | Contraste WCAG 2.2 AA | | ◐ | Corregido: "Oferta" era blanco sobre naranjo (2,87:1) y pasó a marino (5,8:1). Falta una auditoría completa |
| RNF-T39 | Navegadores modernos | Chrome, Edge, Firefox, Safari | ◐ | Probado en Edge (Chromium). Falta Firefox y Safari/iPhone |
| RNF-T40 | Sin JavaScript | buscar, filtrar, ordenar, paginar | ✅ | Probado con JavaScript apagado. **Corregido:** el esqueleto de carga (`loading.tsx`, ya publicado en Railway) dejaba la tienda vacía sin JavaScript; se reemplazó por una barrita (`IndicadorCarga`). El orden se envía con un botón en `<noscript>`; los filtros del celular se abren sin JavaScript |

### E. Disponibilidad y recuperación

| ID | Requerimiento | Criterio | Estado | Evidencia / nota |
|---|---|---|---|---|
| RNF-T41 | Disponibilidad ≥ 99,5 % | mensual | 🔍 | Sin monitor. Propuesta: un monitor gratuito (UptimeRobot) contra `/manifest.webmanifest` |
| RNF-T42 | Errores controlados | página propia sin trazas | ✅ | `tienda/error.tsx`, `tienda/not-found.tsx` |
| RNF-T43 | Recuperar el catálogo | restauración probada | ⏳ | El respaldo diario del worker no está desplegado ([09 §3.4](09-despliegue.md)); Supabase Free no respalda. Las fotos (bucket `productos`) tampoco |
| RNF-T44 | Política de respaldos | frecuencia, retención, responsable | ⏳ | Depende de T43 |
| RNF-T45 | RPO y RTO | acordados y probados | 🔍 | Por acordar con el cliente |
| RNF-T46 | Errores registrados | registros y alertas | ◐ | Errores del navegador al buzón `/api/errores`; del servidor, en el registro de Railway. Sin alertas |
| RNF-T47 | Tolerar fallas externas | mensajes y reintentos | ✅ | Open Food Facts: tiempo límite, reintentos ante 429, y si no responde el alta sigue a mano |
| RNF-T48 | Pedidos sin duplicar | idempotencia | — | No hay pedidos guardados todavía (etapa 2) |
| RNF-T49 | Coherencia de precios | el servidor revalida | ◐ | El carrito se revalida al abrirlo y al volver a la pestaña. La validación al confirmar llega con el pedido |
| RNF-T50 | Volver a la versión estable | documentado y probado | ◐ | Ver §3. Documentado; falta probarlo |

### F. Mantenibilidad y calidad

| ID | Requerimiento | Criterio | Estado | Evidencia / nota |
|---|---|---|---|---|
| RNF-T51 | Estructura comprensible | | ✅ | Lógica en `packages/core/src/tienda.ts` y `fichaPorCodigo.ts`; pantallas en `app/tienda`; servidor en `lib/tienda` y `lib/productos` |
| RNF-T52 | Reglas probadas aisladas | pruebas unitarias | ✅ | `tienda.test.ts` (64) y `fichaPorCodigo.test.ts` (6); 533 en core |
| RNF-T53 | Validación automática antes de publicar | CI que bloquea | ◐ | `.github/workflows/ci.yml` (pruebas, tipos, SQL y build). Para que **bloquee**: activar "Wait for CI" en Railway (§3) |
| RNF-T54 | Dependencias controladas | versiones y vulnerabilidades | ◐ | `package-lock.json` fija versiones. Falta revisar vulnerabilidades (`npm audit`, Dependabot) |
| RNF-T55 | Ambientes separados | credenciales por ambiente | ⏳ | **El desarrollo local usa la base de producción.** Crear un Supabase de desarrollo (P-14) |
| RNF-T56 | Respetar a los proveedores | límites, tiempos, errores | ✅ | Open Food Facts: 900 ms entre consultas, reintentos, `User-Agent` propio |
| RNF-T57 | Licencias de fotos | atribución | ✅ | Archivos con `-off-`; la tienda cita la fuente cuando hay alguna |
| RNF-T58 | Indexación validada | con herramientas de inspección | ◐ | robots.txt, sitemap y datos de producto hechos; falta pasarlos por Google Search Console (requiere el dominio) |
| RNF-T59 | Migraciones reproducibles | versionadas y probadas aparte | ✅ | La tienda no agregó migraciones; las del sistema se prueban en `db:test` (Postgres embebido) |
| RNF-T60 | Documentación de operación | | ◐ | [09](09-despliegue.md), [30](30-tienda-online.md) y este documento. Falta un manual de monitoreo |

---

## 3. Procedimientos

### Volver a la versión estable (RNF-T50)

1. Railway → servicio web → **Deployments**.
2. En el último despliegue que funcionaba: **⋯ → Redeploy**. Vuelve en 2–3 minutos.
3. En GitHub, revertir el commit defectuoso (`git revert <commit>` y push), para
   que el próximo despliegue no lo traiga de vuelta.
4. Si el problema venía de una migración, la vuelta atrás es otra migración
   (las migraciones no se deshacen solas).

### Integración continua que bloquea (RNF-T53)

`.github/workflows/ci.yml` corre en cada push a `main`. Para que Railway
**espere** a que pase antes de desplegar: Railway → servicio web → Settings →
Source → activar **Wait for CI**. Sin eso, el CI avisa pero no detiene nada.

### Completar fotos por código (RF-T54)

`npm run db:fotos` (solo revisa) · `npm run db:fotos -- --aplicar` (guarda).
Solo toca productos activos sin foto; se puede volver a correr. Corrida del
2026-10-09 sobre el catálogo real: ver [30](30-tienda-online.md).
