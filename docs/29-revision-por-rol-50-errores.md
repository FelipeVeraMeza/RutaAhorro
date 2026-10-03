# 29 — Revisión por rol: 50 errores más (ronda 8, del 251 al 300)

**Fecha:** 2026-10-03 · **Versión:** 0.6.4 · **Pedido:** "Sigue full" (la
ronda de 50 que proponía el prompt al cierre de [docs/28](28-revision-por-rol-150-errores.md)).

Se siguió la numeración de [docs/26](26-revision-por-rol-50-errores.md),
[docs/27](27-revision-por-rol-50-errores-mas.md) y docs/28. Se partió por lo
que docs/28 dejó anotado sin corregir (recuperar contraseña, la revisión
semanal y las lecturas sin paginar del worker) y se fue a lo que ninguna ronda
había mirado: las políticas RLS por sí solas (no las funciones), una cuenta
desactivada con la sesión abierta, qué pasa en cada pantalla cuando Supabase
responde con error en vez de datos (estados vacíos que mienten), la planilla
que se exporta, la importación, el resumen diario línea por línea y la maqueta
contra la base.

Esta ronda es la primera en que **todas las pruebas de base se vieron fallar
sin la migración** antes de darlas por buenas: `db:test` ya corre en el
contenedor (ver Verificación). Al hacerlo se descubrió que una corrección
anotada como "bodega no puede crear categorías" era falsa (la política dejaba
crear a cualquiera) y se cambió por el problema real, N° 296.

## Cómo leer la tabla

Igual que docs/26 a 28. *Alta*: plata, stock o documentos que quedan mal, una
puerta de seguridad abierta, o el usuario no puede terminar lo que hace.
*Media*: información engañosa o un paso que confunde. *Baja*: formato, texto o
un caso raro. "typecheck (sin prueba propia)" quiere decir que se corrigió y
compila, pero **no hay una prueba que lo demuestre por sí misma** (🟡, regla de
docs/17). Las de la base dicen si tienen prueba en
`tools/pg-test/revision-0038.test.mjs`.

| N° | Lo ve | Gravedad | Qué pasaba | Estado | Verificado con |
|---:|---|---|---|---|---|
| 251 | Todos | Media | Recuperar contraseña no quitaba la marca de contraseña temporal: quien la tenía y la cambiaba por el correo volvía a /clave a inventar otra. | Corregido | typecheck (sin prueba propia) |
| 252 | Bodega | Media | Worker, revisión semanal: un perecible con stock y sin ningún lote con cantidad no aparecía en v_stock_by_lot y su descuadre no se detectaba nunca (además: una consulta por producto y sin paginar). | Corregido | typecheck del worker (sin prueba propia) |
| 253 | Jefe | Baja | Worker: el aviso de stock bajo mínimo leía v_low_stock sin paginar: pasados 1.000 productos, el resto no avisaba. | Corregido | typecheck del worker (sin prueba propia) |
| 254 | Bodega | Baja | Worker: el aviso de vencimientos leía v_expiring_lots sin paginar. | Corregido | typecheck del worker (sin prueba propia) |
| 255 | Jefe | Alta | Seguridad (base): una cuenta desactivada con la sesión abierta seguía pasando todas las políticas RLS: leía ventas, costos y clientes y escribía directo en productos, códigos y categorías (current_tenant_id no miraba is_active). | Corregido | pg-test revision-0038 ✅ (pasa con 0038, vista fallar sin ella) |
| 256 | Jefe | Media | Seguridad (base): fn_create_product y fn_update_product no miraban si la cuenta seguía activa (cambio de precios con la cuenta desactivada). | Corregido | db:check · db:test completo pasa (sin prueba propia) |
| 257 | Jefe | Media | Base: un producto se podía crear o editar con la categoría de otro local. | Corregido | pg-test revision-0038 ✅ (pasa con 0038, vista fallar sin ella) |
| 258 | Bodega | Baja | Base: el stock mínimo (y el inicial) aceptaba decimales al crear o editar un producto, aunque desde 0032 todo se cuenta por unidad. | Corregido | pg-test revision-0038 ✅ (pasa con 0038, vista fallar sin ella) |
| 259 | Jefe | Baja | Base: devolver "0,5" de un producto por unidad dejaba media unidad en stock y lotes. | Corregido | pg-test revision-0038 ✅ (pasa con 0038, vista fallar sin ella) |
| 260 | Jefe | Media | Base: una factura manual con un cliente elegido y OTRO RUT quedaba ligada al cliente equivocado y le completaba giro y dirección del receptor ajeno. | Corregido | pg-test revision-0038 ✅ (pasa con 0038, vista fallar sin ella) |
| 261 | Jefe | Alta | Base: se podía descartar (y devolver el stock de) una factura que el SII ya había emitido y solo faltaba anotar. | Corregido | pg-test revision-0038 ✅ (pasa con 0038, vista fallar sin ella) |
| 262 | Vendedor | Media | Vender: una línea de un producto eliminado se quedaba en el carrito (guardado o en curso) y la venta fallaba al cobrar con PRODUCTO_NO_ENCONTRADO. | Corregido | typecheck (sin prueba propia) |
| 263 | Jefe | Media | Producto: si fallaban las ofertas al editar y se tocaba Guardar otra vez, decía que otra persona lo cambió mientras se editaba (era uno mismo) y no dejaba reintentar. | Corregido | typecheck (sin prueba propia) |
| 264 | Bodega | Baja | Ayuda: bodega no veía la guía de crear productos aunque puede hacerlo, y no había guía de ajustes y mermas, su tarea más común. | Corregido | typecheck (sin prueba propia) |
| 265 | Vendedor | Baja | Ayuda: faltaban las guías de lo agregado en 0021–0036 (descuento con PIN, ofertas y combos, factura a mano) y la toma no decía dónde se empieza. | Corregido | typecheck (sin prueba propia) |
| 266 | Jefe | Media | Seguridad: exportar a Excel no neutralizaba fórmulas: un producto o cliente llamado "=HYPERLINK(...)" se ejecutaba en la planilla del contador (inyección CSV). | Corregido | core (vitest): csv.test.ts |
| 267 | Jefe | Baja | Montos negativos salían "$-1.500" (margen del producto, utilidad en Reportes), en vez de "-$1.500". | Corregido | core (vitest): money.test.ts |
| 268 | Jefe | Media | Worker, resumen diario: un error al leer ventas o cajas se ignoraba y el correo decía "Total vendido $0" o "Sin novedades" en un día normal. | Corregido | typecheck del worker (sin prueba propia) |
| 269 | Jefe | Baja | Worker, resumen diario: los 15 productos bajo mínimo salían sin orden (15 cualquiera, distintos cada noche), no los más urgentes, y no decía cuántos más había. | Corregido | typecheck del worker (sin prueba propia) |
| 270 | Jefe | Baja | Worker, resumen diario: "Valor en riesgo" sumaba solo los 15 lotes del correo y lo presentaba como el total. | Corregido | typecheck del worker (sin prueba propia) |
| 271 | Jefe | Baja | Worker, resumen diario: "vence en 0 d" en vez de "vence hoy" y el asunto con la fecha 2026-10-03. | Corregido | typecheck del worker (sin prueba propia) |
| 272 | Bodega | Media | Recibir mercadería: sin red, pagar con "Efectivo de la caja" decía "No tienes la caja abierta" aunque estuviera abierta (miCajaAbierta tomaba el error como "no hay caja"). | Corregido | typecheck (sin prueba propia) |
| 273 | Bodega | Baja | Recibir mercadería: sin red la lista de proveedores quedaba vacía sin aviso y el "+ Nuevo" invitaba a duplicar un proveedor. | Corregido | typecheck (sin prueba propia) |
| 274 | Todos | Media | Si Supabase fallaba al leer el perfil, la app decía "Tu cuenta no está vinculada a ningún local" (como si lo hubieran sacado); ahora dice que es la conexión y deja reintentar. | Corregido | typecheck (sin prueba propia) |
| 275 | Vendedor | Media | Caja: un error al leer la caja abierta mostraba "Abrir caja" con la caja abierta, y abrirla respondía "ya tienes una caja abierta". | Corregido | typecheck (sin prueba propia) |
| 276 | Jefe | Baja | Bitácora: lo agregado desde 0018 (descuento autorizado con PIN, cambio de PIN, impuestos, devolución a proveedor, factura descartada o emitida en el SII, claves del SII) salía con el código interno y no se podía filtrar. | Corregido | typecheck (sin prueba propia) |
| 277 | Jefe | Baja | Bitácora: los cambios de ofertas no decían de qué producto eran (la base los anota como "product" y solo se buscaba "products"). | Corregido | typecheck (sin prueba propia) |
| 278 | Vendedor | Baja | Escáner: con la cámara en error el único botón era "Reintentar": no había cómo cerrarla y el recuadro negro seguía tapando la pantalla. | Corregido | typecheck (sin prueba propia) |
| 279 | Bodega | Media | Etiquetas: lo marcado en una búsqueda se perdía al buscar otra cosa (la hoja se armaba solo con la lista visible): marcar Coca-Cola × 5, buscar pan y marcar Pan × 3 imprimía solo el pan. | Corregido | typecheck (sin prueba propia) |
| 280 | Vendedor | Media | Cerrar caja: si entraba una venta mientras se contaba (la cola sin conexión, otra pestaña), la base pedía explicar una diferencia que la pantalla no mostraba y el campo para explicarla estaba escondido: no había cómo cerrar. | Corregido | typecheck (sin prueba propia) |
| 281 | Bodega | Media | Importar: "S" o "Sí." en la columna perecible valía "no" sin avisar: los perecibles quedaban sin control de vencimiento. | Corregido | core (vitest): import.test.ts |
| 282 | Bodega | Baja | Importar: días de alerta "abc" pasaban como 30 sin decir nada, y 0 hacía fallar la fila recién al cargar. | Corregido | core (vitest): import.test.ts |
| 283 | Bodega | Baja | Importar: un perecible con stock entraba sin lote (fuera de FEFO y alertas) sin aviso, y la plantilla de ejemplo enseñaba justo eso. | Corregido | core (vitest): import.test.ts |
| 284 | QA (maqueta) | Baja | Maqueta: la misma factura recibida se podía registrar dos veces y con fecha futura (la base no lo acepta). | Corregido | typecheck (sin prueba propia) |
| 285 | Vendedor | Baja | Vender: un descuento en pesos quedaba mayor que la línea al bajar la cantidad; la venta guardaba el descuento entero (reporte de descuentos inflado) y el tope de autorización se medía contra plata que no se rebajó. | Corregido | typecheck (sin prueba propia) |
| 286 | Jefe | Baja | Ofertas: se aceptaba "desde 2,5 unidades" aunque todo se vende por unidad (en Vender salía "Desde 2,5"). | Corregido | core (vitest): precios.test.ts |
| 287 | Jefe | Media | Fiado: sin red decía "Total que deben $0" y "Ningún cliente tiene crédito todavía", como si nadie debiera. | Corregido | typecheck (sin prueba propia) |
| 288 | Vendedor | Baja | Clientes: sin red decía "Todavía no hay clientes. Agrégalos acá" e invitaba a duplicar clientes que existen. | Corregido | typecheck (sin prueba propia) |
| 289 | Bodega | Media | Vencimientos: los lotes se leían sin paginar: con más de 1.000, los que vencían más tarde no salían ni contaban en el valor en riesgo. | Corregido | typecheck (sin prueba propia) |
| 290 | QA (maqueta) | Baja | Maqueta, toma de inventario: aceptaba conteos con decimales y, con un error a la mitad, dejaba aplicada la mitad (la base no aplica nada). | Corregido | typecheck (sin prueba propia) |
| 291 | Jefe | Baja | Facturación: las facturas emitidas y recibidas del mes se leían sin paginar: pasadas 1.000, la lista y el CSV para el contador salían incompletos sin aviso. | Corregido | typecheck (sin prueba propia) |
| 292 | Jefe | Media | Inicio: "Marcar como vistos" daba por vistos los 20 avisos leídos aunque el panel muestra 6: 14 avisos (stock, vencimientos, descuadres) se descartaban sin que nadie los viera. | Corregido | typecheck (sin prueba propia) |
| 293 | Vendedor | Media | Caja: si fallaba leer el resumen de la caja abierta, la pantalla decía "debería haber $0" y no mostraba los ingresos y retiros; ahora muestra el error y deja reintentar. | Corregido | typecheck (sin prueba propia) |
| 294 | Jefe | Baja | Descargar mis datos: proveedores por producto y stock por ubicación se paginaban ordenados solo por producto: pasadas 1.000 filas la copia podía traer filas repetidas y perder otras. | Corregido | typecheck (sin prueba propia) |
| 295 | Jefe | Baja | Worker: la fecha bajo el título de los correos usaba siempre la hora de Santiago: un local en otra zona (Isla de Pascua) recibía el resumen de las 22:00 con la fecha de mañana. | Corregido | typecheck del worker (sin prueba propia) |
| 296 | Jefe | Media | Seguridad (base): cinco políticas "for all" miraban el rol al leer, cambiar y borrar, pero no al crear: un vendedor podía crear categorías, códigos de barra de cualquier producto, proveedores, vínculos producto–proveedor y locales con la llave pública. | Corregido | pg-test revision-0038 ✅ (pasa con 0038, vista fallar sin ella) |
| 297 | Jefe | Media | Seguridad (base): admin o supervisor podían reescribir un aviso del worker (bajar un descuadre a "info", cambiar el producto) o anotar que lo vio otra persona; ahora solo se marca como visto, por uno mismo. | Corregido | pg-test revision-0038 ✅ (pasa con 0038, vista fallar sin ella) |
| 298 | Jefe | Baja | Inicio: si fallaba contar productos, cuentas, cajas o ventas, el panel le mostraba a un local en marcha los primeros pasos ("Carga tus productos · Haz la primera venta"). | Corregido | typecheck (sin prueba propia) |
| 299 | Bodega | Media | Toma de inventario: el conteo vivía solo en memoria: recargar, tocar otro menú o que el celular cerrara la pestaña borraba el conteo sin preguntar. | Corregido | typecheck (sin prueba propia) |
| 300 | Jefe | Media | Worker, resumen diario: un error en un local (una consulta que falla, una zona horaria mal escrita) cortaba el ciclo y los locales que venían después se quedaban sin resumen esa noche. | Corregido | typecheck del worker (sin prueba propia) |

## Resumen

| | Cantidad |
|---|:-:|
| Alta | 2 |
| Media | 23 |
| Baja | 25 |
| Corregidos | 50 |
| Con prueba propia corrida (✅, core) | 266, 267, 281, 282, 283, 286 |
| Con prueba de base ✅ (vista fallar sin 0038) | 255, 257, 258, 259, 260, 261, 296, 297 |
| Base sin prueba propia (compila y db:test completo pasa, 🟡) | 256 |
| Pantalla o worker sin prueba propia (typecheck, 🟡) | el resto (35) |

## Lo más grave, en una línea cada uno

- **N° 255 · Una cuenta desactivada seguía adentro.** Desactivar a alguien
  en Usuarios no le cerraba la sesión, y `current_tenant_id()` no miraba
  `is_active`: con la sesión abierta seguía leyendo ventas, costos y clientes,
  y escribiendo directo en productos y códigos con la llave pública. 0038 hace
  que para una cuenta inactiva no haya local.
- **N° 261 · Se podía descartar una factura que el SII ya había emitido**
  (solo faltaba anotar el folio): se devolvía el stock y la factura válida
  quedaba fuera del libro de ventas.
- **N° 296 · Cinco políticas "for all" no miraban el rol al crear.** Un
  vendedor podía crear categorías, códigos de barra para cualquier producto,
  proveedores, vínculos producto–proveedor y locales.
- **N° 266 · Inyección de fórmulas en el Excel del contador.** Un producto o
  cliente llamado `=HYPERLINK(...)` se ejecutaba al abrir la planilla.
- **N° 292 · "Marcar como vistos" descartaba 14 avisos que nadie vio**
  (se leen 20, se muestran 6).
- **N° 299 · Una toma de inventario de una hora se perdía al recargar.**
- **N° 300 · Un local con un error dejaba sin resumen diario a los que venían
  después** en el ciclo del worker.

## Migración nueva: 0038 (sin aplicar en Supabase)

`supabase/migrations/0038_revision_50_errores.sql`. Las funciones con **la
misma firma** que su última versión (regla 21); se generó copiando la última
definición de cada una y aplicando cambios mínimos.

- `fn_devolver_venta`: `CANTIDAD_ENTERA` salvo que sea justo lo que queda por
  devolver (N° 259).
- `fn_emitir_factura_manual`: si el RUT del cliente elegido no es el del
  receptor, la factura no se liga a ese cliente ni toma sus datos (N° 260).
- `fn_create_product`, `fn_update_product`: cuenta activa (`NO_AUTENTICADO`),
  categoría del mismo local (`CATEGORIA_NO_ENCONTRADA`), mínimo y stock
  inicial enteros (`CANTIDAD_ENTERA`) (N° 256–258).
- `fn_descartar_factura`: `FACTURA_EMITIDA_EN_SII` cuando el último error dice
  que el SII emitió el folio (N° 261).
- `current_tenant_id()`: `… and is_active` (N° 255), y la política
  `profiles_read_self` para que la cuenta desactivada vea su propio perfil y
  la app le diga "Tu cuenta está desactivada".
- Políticas `stores_write`, `categories_write`, `barcodes_write`,
  `suppliers_write`, `prod_sup_write`: el `with check` pide los mismos roles
  que el `using`. Para no romper lo que la app ya hace, dos políticas solo de
  creación: `categories_insert_bodega` (bodega crea categorías desde Productos
  e Importar) y `suppliers_insert_recepcion` (supervisor y bodega crean el
  proveedor desde Recibir mercadería) (N° 296).
- Disparador `trg_guard_alert_update`: desde la app un aviso solo se marca
  como visto, y "quién lo vio" es uno mismo (N° 297).

**Antes de aplicarla:**
1. Aplicar antes 0029 a 0037, en orden (ver HANDOFF).
2. **Desactivar una cuenta ahora la deja sin nada al instante**, aunque tenga
   la sesión abierta: ve "Tu cuenta está desactivada" y puede salir. Es el
   punto.
3. Un vendedor que creaba proveedores o categorías por fuera de la app deja
   de poder. Ninguna pantalla se lo ofrecía.
4. `npm run db:test` ya se corrió (ver Verificación). Volver a correrlo si se
   toca algo.
5. `db:aplicar` sigue esperando **46 funciones** (0038 no agrega RPC nuevas).

## Encontrados después del 300 (sin corregir)

- **T-45 · El vendedor puede leer costos** (la prueba sigue marcada TODO en
  `db:test`). Es un cambio grande: las vistas y tablas con costo necesitan
  separarse para el rol vendedor.
- **La toma pisa las ventas hechas entre el conteo y el "Aplicar".** Se cuenta
  a las 10, se vende a las 11 y se aplica a las 12: el stock queda con lo
  contado a las 10. Arreglo propuesto: guardar el stock del sistema al empezar
  a contar cada producto y aplicar la diferencia, no el número.
- **`fn_descartar_factura` en el caso "Firmar":** si el error fue al firmar,
  el folio pudo quedar consumido sin emitirse; hoy se descarta sin anotarlo.
- **El resumen diario va a un solo correo global** (`ALERTS_EMAIL_TO`
  del worker), no al de cada local: con varios locales, cada dueño no recibe
  el suyo.
- **Las pantallas de Vencimientos e Inventario traen todos los lotes en cada
  búsqueda** (ahora paginados): con muchos lotes, cada letra escrita en el
  buscador vuelve a leerlos todos.
- **La revisión semanal del worker manda su correo sin la zona del local**
  (el resumen diario ya la usa).

## Verificación

- `packages/core`: **465 pruebas, 0 fallas** (vitest), con las nuevas de
  `money`, `csv`, `import` y `precios`. Cada una se vio fallar sin su
  corrección.
- `apps/web`: `tsc --noEmit` sin errores; `next build` de producción
  (`NEXT_PUBLIC_DEMO=false`) termina bien.
- `apps/worker`: `npm run typecheck` sin errores; `npm test` 0 fallas (6
  omitidas, necesitan Supabase).
- `npm run db:check`: **182 cuerpos PL/pgSQL compilan** (0038 incluida).
- **`npm run db:test`** (2026-10-03): **201 pasan + 1 TODO conocido (T-45), 0 fallas**.
  `revision-0038.test.mjs`: **7/7 con 0038 y 0/7 sin ella** (regla 16).
- Cómo correr `db:test` en el contenedor (como root `initdb` se niega; se usa
  el usuario `ubuntu` que ya existe):

  ```sh
  npm run db:instalar && chmod o+w supabase/instalar.sql
  runuser -u ubuntu -- env HOME=/tmp/ubuntu-home PATH="$PATH" \
    node --test --test-concurrency=1 --test-timeout=120000 "tools/pg-test/*.test.mjs"
  chmod o-w supabase/instalar.sql
  ```

- No se corrieron los recorridos de la maqueta (`tools/ui`) en esta sesión.
