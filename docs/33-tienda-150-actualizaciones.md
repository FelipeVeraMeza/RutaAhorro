# 33 — Tienda online: 150 actualizaciones (requerimientos funcionales y no funcionales)

**Fecha:** 2026-10-11 · **Versión:** 0.7.0 · **Pedido:** "Ahora en la página web mejórala con 150
actualizaciones nuevas, mejoremos requerimientos funcionales y no funcionales, todo, dale full".

"La página web" es la tienda pública (`/tienda`), como en los pedidos anteriores. Se partió de los
120 requerimientos de [docs/31](31-tienda-requerimientos.md) y de lo que les faltaba. Lo más grande
es la **etapa 2 de [docs/30](30-tienda-online.md): hacer el pedido en la tienda y que llegue al
sistema.** Hasta ahora, sin un celular anotado en la sucursal, la tienda no tenía cómo recibir un
pedido.

## En corto

- **150 actualizaciones hechas:** 81 funcionales y 69 no funcionales. Ninguna es una propuesta: todas están en el código.
- **30 requerimientos funcionales nuevos (RF-T61 a RF-T90) y 9 no funcionales nuevos (RNF-T61 a RNF-T69).**
- **15 requerimientos de docs/31 cambian de estado** (abajo); docs/31 quedó al día.
- **Todo está en la rama `ccr-2f68b3d1-6i818v`, no en `main`.** Railway publica `main`.

## Antes de publicar en `main`

1. **Aplicar 0039 y 0040 en Supabase**, en ese orden: `npm run db:instalar` y después
   `npm run db:aplicar -- --aplicar`. Las dos son idempotentes y no cambian firmas. El código funciona
   igual sin 0040 (la tienda no muestra "Hacer pedido"), pero los pedidos necesitan 0040.
2. **Encender los pedidos** en Configuración → Tienda online, y en esa misma pantalla anotar el
   WhatsApp de la tienda y el horario. Están apagados por omisión: que el local los encienda cuando
   alguien vaya a mirar "Pedidos web" durante el día.
3. Crear un monitor gratuito (UptimeRobot u otro) contra `/api/tienda/salud` cada 5 minutos (RNF-T41).
4. Después de una semana sin avisos en la consola del navegador, pasar la política de contenido de
   `Content-Security-Policy-Report-Only` a `Content-Security-Policy` en `apps/web/next.config.ts`.
5. Que el local revise la página de privacidad (sigue siendo un borrador técnico, docs/31).

## Cómo se probó

| Qué | Comando | Resultado |
|---|---|---|
| Tipos de web, core y worker | `npm run typecheck` | sin errores |
| Reglas de la tienda en core | `npm test -w packages/core` | 566 de 566 (21 nuevas en `tienda-150.test.ts`) |
| Pedidos en la base (Postgres de verdad) | `npm run db:test` (usuario sin root) | 208 verdes + 1 TODO (T-45), 0 fallas (9 nuevas en `pedidos-web.test.mjs`) |
| Funciones de la base compilan | `npm run db:check` | 181 cuerpos PL/pgSQL OK |
| Worker | `CHROME_PATH=/opt/pw-browsers/chromium npm test -w apps/worker` | 6 de 6 |
| Recorrido de la tienda y "Pedidos web" en la maqueta | `RA_BASE=http://localhost:3005 node tools/ui/tienda-150.mjs` | 65 de 65 |
| Recorridos anteriores | `demo-flujo`, `demo-ronda2`, `ronda4`, `ronda6`, `demo-roles`… | verdes; `demo-roles` volvió a ver 1 vez el error #418 conocido (docs/32, E-111) |

"typecheck (sin prueba propia)" quiere decir que el cambio compila y nada se rompió, pero ninguna
prueba lo comprueba por sí mismo. "recorrido tienda-150" quiere decir que se vio funcionando en la
maqueta, en el navegador.

## Requerimientos nuevos

| ID | Requerimiento | Estado |
|---|---|---|
| RF-T61 | Ver solo lo disponible | ✅ |
| RF-T62 | Ordenar por mayor descuento | ✅ |
| RF-T63 | Buscar en plural o singular | ✅ |
| RF-T64 | Primero lo que empieza con lo buscado | ✅ |
| RF-T65 | "¿Quisiste decir…?" sin resultados | ✅ |
| RF-T66 | Precio por kilo, litro o unidad | ✅ |
| RF-T67 | Páginas con número | ✅ |
| RF-T68 | Ofertas destacadas en la portada | ✅ |
| RF-T69 | Cómo llegar y contacto del local | ✅ |
| RF-T70 | Copiar la lista del carrito | ✅ |
| RF-T71 | Horario de atención y abierto/cerrado | ✅ |
| RF-T72 | Deshacer al quitar del carrito | ✅ |
| RF-T73 | Favoritos | ✅ |
| RF-T74 | Vistos hace poco | ✅ |
| RF-T75 | Ver solo lo que tiene oferta | ✅ |
| RF-T76 | Todas las marcas en el filtro | ✅ |
| RF-T77 | Filtros puestos visibles y quitables | ✅ |
| RF-T78 | Cómo comprar (preguntas frecuentes) | ✅ |
| RF-T79 | Página de categorías | ✅ |
| RF-T80 | "No encontrado" con buscador | ✅ |
| RF-T81 | Imprimir el pedido | ✅ |
| RF-T82 | Ofertas ordenadas por mayor rebaja | ✅ |
| RF-T83 | Aviso del local en la tienda | ✅ |
| RF-T84 | Seguimiento del pedido con código | ✅ |
| RF-T85 | Guardar los datos al pedir | ✅ |
| RF-T86 | Buscar pedidos y resumen del día (personal) | ✅ |
| RF-T87 | Avisar al cliente por WhatsApp desde el pedido | ✅ |
| RF-T88 | Pedido mínimo | ✅ |
| RF-T89 | Configurar la tienda (pedidos, WhatsApp, horario, aviso) | ✅ |
| RF-T90 | Nota para el local | ✅ |
| RNF-T61 | Imágenes sin saltos y con prioridad | ✅ |
| RNF-T62 | Una dirección por página para los buscadores | ✅ |
| RNF-T63 | Datos estructurados para Google | ✅ |
| RNF-T64 | Saltar al contenido | ✅ |
| RNF-T65 | Respetar "reducir movimiento" | ✅ |
| RNF-T66 | Seguir mostrando la última copia buena | ✅ |
| RNF-T67 | Pedidos protegidos contra abuso (límite, trampa, origen, tamaño) | ✅ |
| RNF-T68 | Chequeo de salud para monitorear | ✅ |
| RNF-T69 | Funciona con o sin la migración 0040 | ✅ |

## Lo que cambia en docs/31

| ID | Antes | Ahora | Por qué |
|---|:-:|:-:|---|
| RF-T09 | ◐ | ✅ | Lo "no autorizado" es lo que el local oculta de la tienda (RF-T57). |
| RF-T43 | ◐ | ✅ | Mis pedidos con número, estado al día y seguimiento (en el celular del cliente, sin cuenta). |
| RF-T45 | ⏳ | ✅ | Confirmar pedido en el carrito; queda en el sistema. |
| RF-T46 | ◐ | ✅ | Nombre y celular obligatorios para pedir en la tienda. |
| RF-T47 | ⏳ | ◐ | Retiro en el local, sí. Despacho a domicilio: etapa 4. |
| RF-T48 | ⏳ | ✅ | Número correlativo por local y código de seguimiento. |
| RF-T49 | ⏳ | ✅ | Pantalla "Pedidos web". |
| RF-T50 | ⏳ | ◐ | Estados con historial y aviso por WhatsApp con un toque. Falta el aviso automático por correo (cuenta de Resend). |
| RF-T56 | ◐ | ✅ | El WhatsApp de la tienda se configura en Configuración → Tienda online. |
| RF-T57 | ⏳ | ✅ | "Se muestra en la tienda online" en la ficha de cada producto (0040). |
| RNF-T22 | — | ✅ | Los pedidos son de cada local (RLS), probado en pedidos-web.test.mjs. |
| RNF-T26 | ◐ | ✅ | Los datos de contacto de pedidos cerrados se borran a los 12 meses (worker mensual). |
| RNF-T41 | 🔍 | ◐ | `/api/tienda/salud` listo. Falta crear el monitor (UptimeRobot) en una cuenta del local. |
| RNF-T48 | — | ✅ | El mismo `client_uuid` no crea dos pedidos. |
| RNF-T49 | ◐ | ✅ | La base calcula los precios del pedido al confirmarlo y la tienda avisa si cambió. |

## Las 150 actualizaciones

| N° | Bloque | Tipo | Requerimiento | Qué cambia | Verificado con |
|---:|---|---|---|---|---|
| U-1 | Pedido en línea | RF | RF-T45, T48 | El cliente hace el pedido en la tienda y queda guardado en el sistema con número correlativo y código de seguimiento. | recorrido tienda-150 |
| U-2 | Pedido en línea | RNF | RNF-T49 | Los precios y ofertas del pedido los calcula la base en ese momento (`fn_precio_por_cantidad`), no el navegador. | pg-test: pedidos-web.test.mjs |
| U-3 | Pedido en línea | RNF | RNF-T48 | El mismo pedido mandado dos veces (doble toque, reintento) queda uno solo (`client_uuid`). | pg-test: pedidos-web.test.mjs |
| U-4 | Pedido en línea | RNF | RNF-T48 | El identificador del intento se reutiliza solo para el mismo carrito: un corte de red no duplica, y un carrito distinto es otro pedido. | typecheck (sin prueba propia) |
| U-5 | Pedido en línea | RNF | RNF-T19 | La base valida nombre, celular chileno, correo, nota (≤ 300), productos (1 a 60) y cantidades enteras de 1 a 99. | pg-test: pedidos-web.test.mjs |
| U-6 | Pedido en línea | RF | RF-T09, T40 | Se rechaza lo agotado (si el local no vende sin stock), oculto, desactivado, sin precio o de otro local, con el nombre del producto. | pg-test: pedidos-web.test.mjs |
| U-7 | Pedido en línea | RNF | RNF-T18 | Un celular no puede tener más de 3 pedidos sin cerrar. | pg-test: pedidos-web.test.mjs |
| U-8 | Pedido en línea | RNF | RNF-T18 | Tope de 300 pedidos por hora por local: una inundación no tapa la cola del mostrador. | revisión de código |
| U-9 | Pedido en línea | RF | RF-T88 (nuevo) | Pedido mínimo configurable: la base lo exige y el carrito dice cuánto falta. | pg-test: pedidos-web.test.mjs |
| U-10 | Pedido en línea | RF | RF-T47 | Modalidad "retiro en el local, pagas al retirar" explícita en el pedido y en el seguimiento. | recorrido tienda-150 |
| U-11 | Pedido en línea | RF | RF-T50 | Estados recibido → en preparación → listo → entregado, o cancelado; la base solo acepta los pasos válidos. | pg-test: pedidos-web.test.mjs |
| U-12 | Pedido en línea | RF | RF-T50 | Cancelar exige motivo (≤ 300 letras), y el cliente lo ve. | recorrido tienda-150 |
| U-13 | Pedido en línea | RF | RF-T50 | Historial de estados con hora: el seguimiento muestra cuándo pasó cada paso. | pg-test: pedidos-web.test.mjs |
| U-14 | Pedido en línea | RNF | RNF-T12 | Cada cambio de estado queda en la bitácora con quién lo hizo. | pg-test: pedidos-web.test.mjs |
| U-15 | Pedido en línea | RNF | RNF-T22 | RLS: los pedidos los ven solo admin, supervisor y vendedor de ese local; bodega y otros locales no; nadie los escribe a mano. | pg-test: pedidos-web.test.mjs |
| U-16 | Pedido en línea | RNF | RNF-T21 | El seguimiento por código no devuelve celular ni correo, solo el primer nombre. | pg-test: pedidos-web.test.mjs |
| U-17 | Pedido en línea | RNF | RNF-T26 | `fn_anonimizar_pedidos_web`: borra nombre, celular, correo y nota de pedidos cerrados hace más de N meses. | pg-test: pedidos-web.test.mjs |
| U-18 | Pedido en línea | RNF | RNF-T26 | Trabajo mensual del worker que anonimiza a los 12 meses (el plazo de la página de privacidad). | typecheck (sin prueba propia) |
| U-19 | Pedido en línea | RNF | RNF-T12, T17 | Crear pedidos, seguir uno y anonimizar solo con la llave de servicio: ni anon ni el personal pueden llamarlas. | pg-test: pedidos-web.test.mjs |
| U-20 | Pedido en línea | RNF | RNF-T59 | Pedidos apagados por omisión: un local no recibe pedidos hasta encenderlos en Configuración. | pg-test: pedidos-web.test.mjs |
| U-21 | Pedido en línea | RNF | RNF-T69 (nuevo) | Sin 0040 aplicada la tienda no se cae: no muestra "Hacer pedido" y la API responde "no está recibiendo pedidos". | typecheck (sin prueba propia) |
| U-22 | Pedido en línea | RF | RF-T57 | `products.publicado_tienda` y `fn_publicar_en_tienda`: elegir qué productos se muestran. | pg-test: pedidos-web.test.mjs |
| U-23 | Pedido en línea | RNF | RNF-T69 (nuevo) | El catálogo filtra lo no publicado, y si la base todavía no tiene la columna lee todo como antes. | typecheck (sin prueba propia) |
| U-24 | Pedido en línea | RF | RF-T89 (nuevo) | `fn_guardar_configuracion` acepta la configuración de la tienda (pedidos, WhatsApp, horario, aviso, mínimo) con sus límites. | pg-test: pedidos-web.test.mjs |
| U-25 | Pedido en línea | RNF | RNF-T52 | Nueve pruebas de la base para pedidos web, vistas en verde con la réplica de Postgres. | pg-test: pedidos-web.test.mjs |
| U-26 | Servidor de la tienda | RNF | RNF-T18 | `/api/tienda/pedidos` con límite de 5 pedidos cada 10 minutos por IP. | revisión de código |
| U-27 | Servidor de la tienda | RNF | RNF-T15 | Un pedido desde otro sitio (Origin distinto) se rechaza: protección CSRF. | recorrido tienda-150 |
| U-28 | Servidor de la tienda | RNF | RNF-T67 (nuevo) | Campo trampa para robots: si viene lleno, el pedido no entra. | recorrido tienda-150 |
| U-29 | Servidor de la tienda | RNF | RNF-T19 | El servidor valida el pedido con las mismas reglas de core antes de llamar a la base. | recorrido tienda-150 |
| U-30 | Servidor de la tienda | RNF | RNF-T67 (nuevo) | Tope de 32 KB por pedido: un cuerpo gigante no hace trabajar al servidor. | typecheck (sin prueba propia) |
| U-31 | Servidor de la tienda | RNF | RNF-T35 | Los errores de la base llegan al cliente en palabras ("X se agotó. Sácalo del carrito"), no en códigos. | typecheck (sin prueba propia) |
| U-32 | Servidor de la tienda | RNF | RNF-T25 | El registro del servidor anota número, total y líneas del pedido, nunca nombre ni celular. | typecheck (sin prueba propia) |
| U-33 | Servidor de la tienda | RNF | RNF-T66 (nuevo) | Si la base no responde, la tienda muestra la última lectura buena (hasta 6 horas) en vez de una página de error. | typecheck (sin prueba propia) |
| U-34 | Servidor de la tienda | RNF | RNF-T19 | `/api/tienda/productos` descarta lo que no es un id de producto antes de buscar. | recorrido tienda-150 |
| U-35 | Servidor de la tienda | RF | RF-T73, T74 | `/api/tienda/productos?completo=1` entrega la ficha pública en el orden pedido (favoritos y vistos), sin costo ni stock. | typecheck (sin prueba propia) |
| U-36 | Servidor de la tienda | RNF | RNF-T21 | `/api/tienda/pedidos/estado` solo con códigos válidos (hasta 20), sin datos de contacto, con su propio límite. | recorrido tienda-150 |
| U-37 | Servidor de la tienda | RNF | RNF-T52 | En la maqueta los pedidos viven en la memoria del servidor: se recorre todo sin Supabase. | recorrido tienda-150 |
| U-38 | Carrito y pedido | RF | RF-T45, T46 | "Confirmar pedido" en el carrito: nombre y celular obligatorios, correo opcional, prellenados con Mi cuenta. | recorrido tienda-150 |
| U-39 | Carrito y pedido | RF | RF-T85 (nuevo) | Casilla "Guardar mis datos en este celular" al pedir. | typecheck (sin prueba propia) |
| U-40 | Carrito y pedido | RF | RF-T90 (nuevo) | Nota para el local (300 letras, con contador), también en el mensaje de WhatsApp. | recorrido tienda-150 |
| U-41 | Carrito y pedido | RF | RF-T56 | Con pedidos encendidos, WhatsApp queda como alternativa ("O envíalo por WhatsApp"). | typecheck (sin prueba propia) |
| U-42 | Carrito y pedido | RF | RF-T56 | El WhatsApp de la tienda se configura aparte del teléfono de la sucursal (hoy no hay ninguno anotado). | typecheck (sin prueba propia) |
| U-43 | Carrito y pedido | RF | RF-T36 | Después de pedir, el carrito queda vacío y se lleva al seguimiento. | recorrido tienda-150 |
| U-44 | Carrito y pedido | RF | RF-T70 | "Copiar lista": el carrito como texto para mandarlo a alguien de la casa, sin datos personales. | recorrido tienda-150 |
| U-45 | Carrito y pedido | RF | RF-T72 | Quitar un producto ofrece "Deshacer". | recorrido tienda-150 |
| U-46 | Carrito y pedido | RF | RF-T33 | El "−" en 1 unidad quita el producto con la misma opción de deshacer. | typecheck (sin prueba propia) |
| U-47 | Carrito y pedido | RF | RF-T33 | El "+" se apaga en 99 unidades (el tope del pedido), en el carrito y en las tarjetas. | typecheck (sin prueba propia) |
| U-48 | Carrito y pedido | RNF | RNF-T47 | La puesta al día de precios del carrito se corta a los 10 s sin respuesta: el carrito no queda colgado. | typecheck (sin prueba propia) |
| U-49 | Carrito y pedido | RF | RF-T26 | El carrito cobra la oferta por cantidad y dice el precio de antes. | recorrido tienda-150 |
| U-50 | Seguimiento | RF | RF-T84 (nuevo) | Página del pedido con su código: estado, pasos con hora, productos, total, ahorro y nota. | recorrido tienda-150 (el paso de U-40) |
| U-51 | Seguimiento | RF | RF-T84 (nuevo) | Mensaje de confirmación al llegar: "¡Listo, Ana! Recibimos tu pedido N° 1". | recorrido tienda-150 (el paso de U-1) |
| U-52 | Seguimiento | RF | RF-T84 (nuevo) | Se pone al día solo cada minuto mientras el pedido no está cerrado (y solo con la pestaña a la vista). | recorrido tienda-150 |
| U-53 | Seguimiento | RF | RF-T50 | Muestra el motivo si el local canceló. | recorrido tienda-150 (el paso de U-52) |
| U-54 | Seguimiento | RF | RF-T69 | "Dónde se retira": dirección, abierto/cerrado, "Cómo llegar", escribir y llamar al local. | recorrido tienda-150 (el paso de U-10) |
| U-55 | Seguimiento | RNF | RNF-T62 | La página del pedido no se indexa (noindex) ni se rastrea. | recorrido tienda-150 |
| U-56 | Seguimiento | RF | RF-T81 | Imprimir o guardar en PDF el pedido. | recorrido tienda-150 |
| U-57 | Mi cuenta | RF | RF-T43 | Mis pedidos muestra número, estado al día y "Ver cómo va". | recorrido tienda-150 |
| U-58 | Mi cuenta | RF | RF-T43 | El estado se vuelve a leer al volver a la pestaña. | typecheck (sin prueba propia) |
| U-59 | Mi cuenta | RF | RF-T43 | Abrir un seguimiento lo agrega a Mis pedidos de ese celular (llegó por un enlace). | typecheck (sin prueba propia) |
| U-60 | Mi cuenta | RF | RF-T44 | "Volver a pedir" solo en los pedidos que traen sus productos; los por WhatsApp se marcan como tales. | typecheck (sin prueba propia) |
| U-61 | Mi cuenta | RNF | RNF-T28 | "Descargar mis datos": todo lo guardado en el celular en un archivo (derecho de acceso). | recorrido tienda-150 |
| U-62 | Mi cuenta | RNF | RNF-T24 | "Borrar mis datos" también borra favoritos y vistos. | typecheck (sin prueba propia) |
| U-63 | Mi cuenta | RNF | RNF-T23 | Los pedidos guardados en el navegador se revisan al leerlos (forma y tope de 20). | typecheck (sin prueba propia) |
| U-64 | Buscar | RF | RF-T63 | Buscar en plural encuentra el singular ("tomates" → Tomate, "aceites" → Aceite). | recorrido tienda-150 |
| U-65 | Buscar | RF | RF-T12 | Se busca también en la marca y el formato ("soprole", "1 kg"). | core: tienda-150.test.ts |
| U-66 | Buscar | RF | RF-T64 | Lo que empieza con lo buscado va primero ("pan" muestra el pan antes que la empanada). | core: tienda-150.test.ts |
| U-67 | Buscar | RF | RF-T65 | "¿Quisiste decir leche?" cuando no hay resultados, con enlace a la búsqueda corregida. | recorrido tienda-150 |
| U-68 | Buscar | RNF | RNF-T19 | El buscador acepta hasta 100 letras y abre el teclado con "Buscar". | typecheck (sin prueba propia) |
| U-69 | Filtrar | RF | RF-T61 | Filtro "Solo lo disponible". | recorrido tienda-150 |
| U-70 | Filtrar | RF | RF-T75 | Filtro "Solo con oferta" en Productos. | recorrido tienda-150 |
| U-71 | Filtrar | RF | RF-T76 | Todas las marcas en el filtro (las 10 primeras a la vista y el resto en "Ver N marcas más"), sin JavaScript. | typecheck (sin prueba propia) |
| U-72 | Filtrar | RF | RF-T77 | Los filtros puestos se ven arriba y se quitan de a uno. | recorrido tienda-150 |
| U-73 | Filtrar | RNF | RNF-T19 | Hasta 20 marcas de 40 letras en la dirección; precios de hasta 9 cifras. | typecheck (sin prueba propia) |
| U-74 | Ordenar | RF | RF-T62 | Orden "Mayor descuento". | recorrido tienda-150 |
| U-75 | Ordenar | RF | RF-T82 | Ofertas parte ordenada por lo que más rebaja. | recorrido tienda-150 |
| U-76 | Páginas | RF | RF-T67 | Páginas con número (1 … 4 5 6 … 20) en Productos, Inicio y Ofertas. | core: tienda-150.test.ts |
| U-77 | Páginas | RNF | RNF-T62 | Enlaces rel="prev" y rel="next" entre páginas. | typecheck (sin prueba propia) |
| U-78 | Portada | RF | RF-T68 | "Ofertas de hoy": las 4 que más rebajan, arriba, con "Ver todas". | recorrido tienda-150 |
| U-79 | Portada | RF | RF-T74 | "Vistos hace poco" en la portada. | typecheck (sin prueba propia) |
| U-80 | Tarjeta | RF | RF-T05 | La etiqueta de oferta dice cuánto rebaja ("−13%"). | recorrido tienda-150 |
| U-81 | Tarjeta | RF | RF-T66 | Precio por kilo, litro o unidad bajo el precio ("$2.475 el kg"). | core: tienda-150.test.ts |
| U-82 | Tarjeta | RF | RF-T73 | Corazón de favorito en cada tarjeta. | typecheck (sin prueba propia) |
| U-83 | Ficha | RF | RF-T66 | La ficha dice el precio por medida. | recorrido tienda-150 |
| U-84 | Ficha | RF | RF-T22 | "Hasta N % menos con la oferta" bajo el precio. | typecheck (sin prueba propia) |
| U-85 | Ficha | RF | RF-T02 | La marca es un enlace a todos sus productos. | typecheck (sin prueba propia) |
| U-86 | Ficha | RF | RF-T73 | Guardar en favoritos desde la ficha. | recorrido tienda-150 |
| U-87 | Ficha | RF | RF-T74 | "Vistos hace poco" al pie de la ficha. | recorrido tienda-150 |
| U-88 | Favoritos | RF | RF-T73 | "Mis favoritos" en Mi cuenta (hasta 100, en este celular). | recorrido tienda-150 |
| U-89 | Categorías | RF | RF-T79 | Página con todas las categorías y cuántos productos tiene cada una. | recorrido tienda-150 |
| U-90 | Categorías | RF | RF-T14 | "Más categorías" de la franja lleva a esa página. | typecheck (sin prueba propia) |
| U-91 | El local | RF | RF-T71 | Barra "Abierto · cierra a las 21:00" / "Cerrado · abre mañana a las 09:00" con la hora del local. | recorrido tienda-150 |
| U-92 | El local | RF | RF-T71 | El horario de la semana en el pie, agrupando días iguales ("Lun a Vie"). | recorrido tienda-150 |
| U-93 | El local | RF | RF-T83 (nuevo) | Aviso del local arriba de la tienda ("Cerrado el 18 por feriado"). | typecheck (sin prueba propia) |
| U-94 | El local | RF | RF-T69 | Página Contacto: dirección, horario, "Cómo llegar" (Google Maps) y WhatsApp. | recorrido tienda-150 |
| U-95 | El local | RF | RF-T69 | El pie enlaza la dirección al mapa y el teléfono a WhatsApp. | typecheck (sin prueba propia) |
| U-96 | El local | RF | RF-T78 | Página "Cómo comprar" con preguntas frecuentes según si el local recibe pedidos. | recorrido tienda-150 |
| U-97 | El local | RF | RF-T80 | El "no encontrado" ofrece buscar ahí mismo, categorías y ofertas. | recorrido tienda-150 |
| U-98 | El local | RNF | RNF-T42 | El error de la tienda ofrece reintentar y contactar al local, y recuerda que el carrito sigue guardado. | typecheck (sin prueba propia) |
| U-99 | El local | RNF | RNF-T35 | La tienda sin datos dice "no está disponible en este momento; compra directo en el local". | typecheck (sin prueba propia) |
| U-100 | Pedidos web (personal) | RF | RF-T49 | Pantalla "Pedidos web" con pestañas Nuevos, En preparación, Listos y Cerrados, con conteo. | recorrido tienda-150 |
| U-101 | Pedidos web (personal) | RF | RF-T49 | Los abiertos por orden de llegada; "hace 5 min". | typecheck (sin prueba propia) |
| U-102 | Pedidos web (personal) | RF | RF-T49 | Se pone al día solo cada 30 s y al volver a la pestaña. | typecheck (sin prueba propia) |
| U-103 | Pedidos web (personal) | RF | RF-T49 | Aviso y sonido cuando llega un pedido nuevo. | typecheck (sin prueba propia) |
| U-104 | Pedidos web (personal) | RF | RF-T50 | Un botón por paso ("Empezar a preparar", "Listo para retirar", "Entregado") y "Ya está listo" directo. | recorrido tienda-150 |
| U-105 | Pedidos web (personal) | RF | RF-T87 (nuevo) | "Avisar que está listo" abre WhatsApp al cliente con el mensaje y el enlace de seguimiento escritos. | recorrido tienda-150 (el paso de U-104) |
| U-106 | Pedidos web (personal) | RF | RF-T49 | Llamar o escribir al cliente desde el pedido (tel: y correo). | typecheck (sin prueba propia) |
| U-107 | Pedidos web (personal) | RF | RF-T50 | Cancelar con motivos rápidos ("Sin stock", "No vino a retirar"…). | recorrido tienda-150 (el paso de U-12) |
| U-108 | Pedidos web (personal) | RF | RF-T81 | Imprimir los pedidos de la pestaña para armarlos en papel. | typecheck (sin prueba propia) |
| U-109 | Pedidos web (personal) | RF | RF-T86 (nuevo) | Buscar un pedido por número, nombre o celular. | recorrido tienda-150 |
| U-110 | Pedidos web (personal) | RF | RF-T86 (nuevo) | Resumen del día: cuántos se entregaron y por cuánto. | typecheck (sin prueba propia) |
| U-111 | Pedidos web (personal) | RNF | RNF-T35 | Si la base no tiene 0040, la pantalla lo dice en vez de un error; si no llegan, enlaza a Configuración. | typecheck (sin prueba propia) |
| U-112 | Pedidos web (personal) | RNF | RNF-T12 | Entran admin, supervisor y vendedor; bodega no (los pedidos traen el celular del cliente). | recorrido tienda-150 |
| U-113 | Pedidos web (personal) | RNF | RNF-T34 | "Pedidos web" en el menú, y el menú lateral compactado para que siga cabiendo en 800 px. | recorrido demo-ronda2 |
| U-114 | Pedidos web (personal) | RF | RF-T49 | El Inicio del jefe avisa los pedidos web nuevos con enlace. | recorrido tienda-150 |
| U-115 | Configuración | RF | RF-T89 (nuevo) | Configuración → Tienda online: recibir pedidos, WhatsApp, pedido mínimo, aviso y horario por día. | recorrido tienda-150 |
| U-116 | Configuración | RNF | RNF-T19 | El horario, el WhatsApp y el mínimo se validan antes de guardar ("No se entiende el horario del lunes"). | recorrido tienda-150 |
| U-117 | Configuración | RF | RF-T57 | "Se muestra en la tienda online" en la ficha de cada producto, se guarda al tocarlo. | typecheck (sin prueba propia) |
| U-118 | Configuración | RNF | RNF-T43 | El respaldo "Descargar mis datos" incluye los pedidos web. | typecheck (sin prueba propia) |
| U-119 | Configuración | RNF | RNF-T60 | Bitácora: "Pedido web cambió de estado" y "Productos mostrados u ocultos en la tienda", en palabras. | typecheck (sin prueba propia) |
| U-120 | Configuración | RNF | RNF-T35 | Mensajes en español para los errores nuevos (pedido no encontrado, cambio de estado inválido…). | typecheck (sin prueba propia) |
| U-121 | Worker | RF | RF-T49 | El resumen diario por correo incluye pedidos web de hoy, lo entregado y lo que sigue sin entregar. | typecheck (sin prueba propia) |
| U-122 | Rendimiento | RNF | RNF-T61 | Fotos con ancho y alto declarados: la página no salta al llegar las imágenes. | typecheck (sin prueba propia) |
| U-123 | Rendimiento | RNF | RNF-T61 | La foto de la ficha se pide primero (eager, fetchpriority alto); las demás se difieren. | typecheck (sin prueba propia) |
| U-124 | Rendimiento | RNF | RNF-T61 | Las primeras 4 tarjetas de cada lista cargan su foto de inmediato. | typecheck (sin prueba propia) |
| U-125 | SEO | RNF | RNF-T62 | Dirección canónica en la ficha. | recorrido tienda-150 |
| U-126 | SEO | RNF | RNF-T62 | Canónicas en Inicio, Productos (por categoría), Ofertas, Categorías, Contacto y Cómo comprar. | typecheck (sin prueba propia) |
| U-127 | SEO | RNF | RNF-T62 | Búsquedas, filtros y páginas siguientes no se indexan (noindex, follow). | typecheck (sin prueba propia) |
| U-128 | SEO | RNF | RNF-T62 | Carrito y Mi cuenta no se indexan. | typecheck (sin prueba propia) |
| U-129 | SEO | RNF | RNF-T63 | Datos para Google: ruta (BreadcrumbList) en cada ficha. | recorrido tienda-150 |
| U-130 | SEO | RNF | RNF-T63 | Producto con marca, categoría, condición y vendedor. | recorrido tienda-150 (el paso de U-129) |
| U-131 | SEO | RNF | RNF-T63 | Sitio con su buscador (SearchAction). | recorrido tienda-150 |
| U-132 | SEO | RNF | RNF-T63 | El local (GroceryStore) con dirección y teléfono. | recorrido tienda-150 |
| U-133 | SEO | RNF | RNF-T63 | Preguntas frecuentes (FAQPage) en Cómo comprar. | recorrido tienda-150 (el paso de U-96) |
| U-134 | SEO | RF | RF-T58 | El sitemap incluye cada categoría, Categorías, Contacto y Cómo comprar. | recorrido tienda-150 |
| U-135 | SEO | RNF | RNF-T62 | robots.txt no deja rastrear carrito, cuenta, pedidos ni la API. | recorrido tienda-150 |
| U-136 | SEO | RF | RF-T59 | Vista previa al compartir con tipo, dirección y tarjeta de Twitter/X. | typecheck (sin prueba propia) |
| U-137 | SEO | RF | RF-T59 | Descripción de la tienda con su dirección, nombre del sitio y región es_CL. | typecheck (sin prueba propia) |
| U-138 | SEO | RF | RF-T59 | Descripción propia por categoría. | typecheck (sin prueba propia) |
| U-139 | Accesibilidad | RNF | RNF-T64 | Enlace "Saltar al contenido" al principio de cada página de la tienda. | recorrido tienda-150 |
| U-140 | Accesibilidad | RNF | RNF-T37 | La foto grande de la ficha lleva el nombre del producto como texto alternativo. | typecheck (sin prueba propia) |
| U-141 | Accesibilidad | RNF | RNF-T65 | Con "reducir movimiento" en el sistema, sin animaciones ni transiciones. | typecheck (sin prueba propia) |
| U-142 | Accesibilidad | RNF | RNF-T31 | Tienda, carrito y Pedidos web sin desborde a 360 px. | recorrido tienda-150 |
| U-143 | Seguridad | RNF | RNF-T14 | Política de contenido (CSP) de la tienda en modo informe, para pasar a obligatoria sin romper nada. | recorrido tienda-150 |
| U-144 | Continuidad | RNF | RNF-T41, T68 (nuevo) | `/api/tienda/salud` para el monitor de disponibilidad (200 / 503), sin datos internos. | recorrido tienda-150 |
| U-145 | Continuidad | RNF | RNF-T46 | Un error de la tienda se informa al buzón del servidor (sin datos del cliente). | typecheck (sin prueba propia) |
| U-146 | Privacidad | RNF | RNF-T29 | La página de privacidad dice qué guarda el pedido, quién lo ve y que se anonimiza a los 12 meses. | typecheck (sin prueba propia) |
| U-147 | Privacidad | RNF | RNF-T27 | Al pedir se informa qué datos recibe el local, con enlace a la política. | typecheck (sin prueba propia) |
| U-148 | Calidad | RNF | RNF-T52 | 21 pruebas nuevas en core (búsqueda, precio por medida, páginas, horario, pedido web). | core: tienda-150.test.ts |
| U-149 | Calidad | RNF | RNF-T53 | Recorrido de la tienda `tools/ui/tienda-150.mjs` (65 comprobaciones) y la lista de funciones permitidas al día. | recorrido tienda-150 |
| U-150 | Calidad | RNF | RNF-T42 | Sin errores de JavaScript en todo el recorrido de la tienda. | recorrido tienda-150 |

## Lo que queda pendiente

- **Pago en línea y boleta del pedido (RF-T60):** necesita una cuenta de pasarela a nombre del local (docs/30, etapa 3).
- **Despacho a domicilio (RF-T47):** por ahora solo retiro en el local.
- **Aviso automático por correo (RF-T50):** el aviso es por WhatsApp con un toque del personal. El correo automático necesita una cuenta de Resend.
- **Combos en la tienda (RF-T27):** la tienda cobra las ofertas por cantidad, no los combos (0023).
- **Política de contenido (RNF-T14):** en modo informe; pasarla a obligatoria después de una semana sin avisos.
- **Monitor de disponibilidad (RNF-T41):** el chequeo está listo; falta crear el monitor.
- **Ambientes separados y respaldos (RNF-T43 a T45, T55):** sin cambios, siguen en docs/31.
- **Navegadores (RNF-T39):** se probó en Chromium; faltan Firefox y Safari/iPhone.
- **Mis pedidos sin cuenta:** viven en el celular del cliente (como el carrito). En otro celular se ven con el enlace de seguimiento.
