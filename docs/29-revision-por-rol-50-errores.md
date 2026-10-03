# 29 — Revisión por rol: 50 errores más (ronda 8, del 251 al 300)

**Fecha:** 2026-10-03 · **Versión:** 0.6.4 · **Pedido:** "Quiero que encuentres
y corrijas 50 errores o problemas más en este proyecto, los documentes y los
subas a GitHub".

Sigue la numeración de [docs/26](26-revision-por-rol-50-errores.md),
[27](27-revision-por-rol-50-errores-mas.md) y
[28](28-revision-por-rol-150-errores.md). Se partió de la rama
`ccr-d1747f17-ru4skw` (0037, sin integrar a `main`). Esta vez se recorrió:
las políticas RLS **aplicadas** (consultadas en la réplica, no leídas en el
SQL), las funciones de la base que la 0037 no tocó, el robot del SII cuando
se cae a la mitad, el resumen diario y la revisión semanal del worker, el
service worker, la importación, el CSV y las pantallas de Caja, Vender,
Ventas, Facturación, Recibir, Devolver, Productos, Usuarios, Ayuda y
Novedades.

**Antes de buscar errores nuevos se corrió por primera vez `db:test` con la
0037** (como usuario sin privilegios: ver Verificación). Las 9 pruebas de
`revision-0037.test.mjs` **pasan con 0037 y fallan las 9 sin ella** (regla
16). No hubo nada que arreglar en la 0037.

## Cómo leer la tabla

Igual que las anteriores. *Alta*: plata, stock o documentos que quedan mal,
una puerta de seguridad abierta, o el usuario no puede terminar lo que hace.
*Media*: información engañosa o un paso que confunde, con riesgo de error.
*Baja*: formato, texto o un caso raro. "typecheck (sin prueba propia)": se
corrigió y compila, pero **ninguna prueba lo demuestra por sí misma**.
"revision-0038 (n)" es la prueba n de `tools/pg-test/revision-0038.test.mjs`:
todas se vieron **fallar sin 0038 y pasar con ella**. Las de core se vieron
fallar sin el arreglo (`git stash` del archivo corregido).

| N° | Lo ve | Gravedad | Qué pasaba | Estado | Verificado con |
|---:|---|---|---|---|---|
| 251 | Jefe | Alta | **Desactivar a alguien no le cortaba los datos.** Las políticas RLS no miraban `is_active`: con su sesión (el token se renueva solo) seguía leyendo ventas, costos y clientes por la API, y escribiendo productos, categorías y proveedores. `current_tenant_id()` vuelve null para una cuenta desactivada; su propio perfil lo sigue viendo (para el aviso "desactivada"). | Corregido (0038) | revision-0038 (1, 2) |
| 252 | Jefe | Alta | **Un vendedor podía crear proveedores, categorías y tiendas por la API.** Las políticas "for all" de 0004 revisaban el rol en USING y solo el local en WITH CHECK, que es lo único que mira un INSERT. | Corregido (0038) | revision-0038 (6) |
| 253 | Jefe | Media | Productos: la política de UPDATE dejaba cambiar cualquier columna por la API (costo promedio, impuesto de otro local, perecible) sin las revisiones de `fn_update_product`. Ahora solo `is_active`, que la app cambia directo; insertar, solo por la función. | Corregido (0038) | revision-0038 (3) |
| 254 | Jefe | Media | Códigos de barra: bodega/supervisor podían insertarlos y borrarlos directo (regla 14), sin las revisiones de código repetido de las funciones de producto. | Corregido (0038) | revision-0038 (4) |
| 255 | Jefe | Media | Perfiles: cada uno podía cambiarse el correo que muestran Usuarios y la Bitácora, y el admin insertar perfiles a mano. Ahora solo las columnas que la app usa; el perfil lo crea `handle_new_user`. | Corregido (0038) | revision-0038 (5) |
| 256 | Jefe | Media | Devolver productos aceptaba "1,5" unidades (pantalla y base): media unidad volvía al stock y la mitad de la plata salía de la caja. | Corregido (pantalla + 0038) | revision-0038 (7) · typecheck |
| 257 | Jefe | Media | Nota de crédito de una factura: un producto se devolvía con decimales (pantalla y base). Una línea libre (un servicio) sigue admitiéndolos. | Corregido (pantalla + 0038) | revision-0038 (8) · typecheck |
| 258 | Jefe | Media | Crear y editar productos con la cuenta desactivada: `fn_create_product` y `fn_update_product` no miraban `is_active_user()`. | Corregido (0038) | revision-0038 (9) |
| 259 | Bodega | Baja | Crear producto con el mismo código dos veces en la lista: error con el nombre de un índice (editar ya lo revisaba). | Corregido (0038) | revision-0038 (9) |
| 260 | Jefe | Baja | Crear/editar producto con la categoría de otro local (la función corre sin RLS): el producto quedaba colgado de ella. | Corregido (0038) | revision-0038 (9) |
| 261 | Bodega | Baja | Stock inicial y mínimo con decimales por la API (desde 0032 todo va por unidad; la pantalla ya los rechazaba). | Corregido (0038) | revision-0038 (9) |
| 262 | Bodega | Media | La base dejaba crear un perecible **con stock y sin fecha de vencimiento** (decisión 4 de 0032): stock sin lote, sin FEFO ni aviso. Es de donde salían los "perecibles sin lotes" de la revisión semanal. | Corregido (0038) | stock-inicial.test (reescrita) |
| 263 | Bodega | Media | Importar: la planilla no tenía columna de vencimiento, así que todo perecible con stock entraba sin lote. Columna nueva `vencimiento` (31-12-2026 o 2026-12-31); sin ella, un perecible con stock no se carga. La plantilla de ejemplo trae la leche en 0. | Corregido | core: import.test, xlsx.test |
| 264 | Bodega | Baja | Importar: "treinta" en días de aviso quedaba en 30 sin aviso y "-5" en 0, que la base rechazaba producto por producto. | Corregido | core: import.test |
| 265 | Bodega | Baja | Importar → "Ver qué significa cada columna": `descripcion` salía sin explicación. | Corregido | typecheck (sin prueba propia) |
| 266 | Jefe | Media | Worker, revisión semanal: partía de `v_stock_by_lot`, que solo trae productos con algún lote activo, así que un perecible con stock y sin lotes (el peor descuadre) no aparecía; además se leía sin páginas y sin mirar el error ("0 descuadres"). Ahora parte de los perecibles con stock. | Corregido | typecheck worker (sin prueba propia) |
| 267 | Jefe | Media | Worker, alertas de stock bajo y de vencimiento: `v_low_stock` y `v_expiring_lots` sin páginas (los de después de 1.000 no avisaban nunca). | Corregido | typecheck worker (sin prueba propia) |
| 268 | Jefe | Media | Resumen diario: ninguna lectura miraba su error; con Supabase caído el correo decía "Total vendido $0" y sin cajas abiertas. | Corregido | typecheck worker (sin prueba propia) |
| 269 | Jefe | Media | Resumen diario: el "valor en riesgo" sumaba solo los 15 lotes que se listan. | Corregido | typecheck worker (sin prueba propia) |
| 270 | Jefe | Baja | Resumen diario: stock bajo mínimo y vencimientos se cortaban en 15 sin decir que había más. | Corregido | typecheck worker (sin prueba propia) |
| 271 | Jefe | Alta | **Robot del SII: si registrar la emisión fallaba un segundo, la factura que el SII YA emitió quedaba en "error"** y la pantalla ofrecía "Reintentar" (otra factura, otro folio). Ahora el registro se reintenta 4 veces con espera. | Corregido | typecheck worker · robot 6/6 (no lo cubre) |
| 272 | Jefe | Alta | Facturación: con "El SII emitió el folio N" en el error, "Reintentar" solo pedía confirmar. Ya no se ofrece. | Corregido | typecheck (sin prueba propia) |
| 273 | Jefe | Media | Facturación: "Descartar" esa misma factura devolvía el stock aunque la mercadería salió con una factura válida. | Corregido | typecheck (sin prueba propia) |
| 274 | Jefe | Alta | La base dejaba reintentar y descartar esa factura (la pantalla no es seguridad). `fn_reintentar_factura` y `fn_descartar_factura` responden `FACTURA_YA_EMITIDA_EN_SII`. | Corregido (0038) | revision-0038 (12) |
| 275 | Vendedor | Media | Caja con Supabase lento o caído: la página decía "Abrir caja" a quien la tenía abierta (y "Debería haber $0"). Ahora muestra la pantalla de error, que deja reintentar. | Corregido | typecheck (sin prueba propia) |
| 276 | Vendedor | Media | Vender, mismo caso: "Abre tu caja para vender" con la caja abierta. | Corregido | typecheck (sin prueba propia) |
| 277 | Todos | Media | **/recuperar no quitaba la marca de contraseña temporal** (pendiente de docs/28): quien la cambiaba por el correo volvía a /clave. Ahora pasa por `/api/cuenta/clave` y renueva el token. | Corregido | typecheck (sin prueba propia) |
| 278 | Vendedor | Media | Service worker: las copias de Vender y Consultar precio (con nombre, rol y tope de descuento de quien las abrió) se borraban solo al tocar "Salir". Si la sesión vencía y entraba otra persona, sin red veía la pantalla del anterior. Se borran también al entrar. | Corregido | typecheck (sin prueba propia) |
| 279 | Jefe | Baja | Configuración: "variación de costo 12,5 %" se aceptaba y al guardar salía un error sin decir qué campo (la base pide entero). | Corregido | typecheck (sin prueba propia) |
| 280 | Jefe | Baja | Usuarios: cambiar rol, desactivar y reactivar sin `.select('id')`: si la política no tocaba la fila, decía "listo". | Corregido | typecheck (sin prueba propia) |
| 281 | Bodega | Baja | Recibir: si la lista de proveedores no cargaba, quedaba "Sin especificar" sin aviso y se creaba un proveedor repetido. | Corregido | typecheck (sin prueba propia) |
| 282 | Jefe | Baja | Facturas recibidas: lo mismo; la factura quedaba sin proveedor (y no en Por pagar a su nombre). | Corregido | typecheck (sin prueba propia) |
| 283 | Bodega | Media | Recibir y Devolver: una búsqueda que fallaba (sin red) dejaba los resultados de lo escrito antes ("leche" bajo "lechuga") y se agregaba otro producto. | Corregido | typecheck (sin prueba propia) |
| 284 | Jefe | Baja | Producto: si fallaban las ofertas después de guardar la edición, "Guardar" otra vez decía "lo cambió *tu propio nombre* mientras editabas". | Corregido | typecheck (sin prueba propia) |
| 285 | Vendedor | Media | **Lector de códigos físico: un código que no está en el catálogo agregaba otro producto.** Enter usaba "el único resultado", que era el de un pedazo del código (calzaba con el SKU de otro). | Corregido | typecheck (sin prueba propia) |
| 286 | Todos | Baja | Ayuda desactualizada: bodega no tenía la guía de productos (los crea), faltaba el descuento con PIN y la fecha obligatoria de los perecibles. | Corregido | typecheck (sin prueba propia) |
| 287 | Jefe | Baja | Facturación: al cambiar de mes rápido (o con la recarga cada 15 s) la respuesta del mes anterior llegaba después y mostraba facturas de otro mes. | Corregido | typecheck (sin prueba propia) |
| 288 | Jefe | Media | `montosDevolucion` (core): la misma línea pedida dos veces se medía por separado; "2 + 2" de una línea con 3 pasaba y se calculaba como si fuera todo. | Corregido | core: dte.test |
| 289 | Jefe | Baja | Combos con "1,5 × Pan" (pantalla y base): no se podía vender así y el ahorro se calculaba sobre media unidad. | Corregido (core + 0038) | core: combos.test · revision-0038 (10) |
| 290 | Jefe | Baja | Ofertas por cantidad "desde 2,5" (pantalla y base): se guardaba y se mostraba así. | Corregido (core + 0038) | core: precios.test · revision-0038 (11) |
| 291 | Bodega | Media | Inventario → Lotes: `v_expiring_lots` sin páginas; con más de 1.000 lotes los que vencen más tarde no salían ni se podían dar de baja. | Corregido | typecheck (sin prueba propia) |
| 292 | Jefe | Baja | Reportes → Ajustes: paginaba sin una columna única al final (dos ajustes iguales en el borde de una página se repetían o se perdían). `v_adjustments` suma `movement_id` al final (regla 22); la pantalla lo usa si existe (regla 23). | Corregido (0038) | instalacion.test (reinstalar dos veces) · typecheck |
| 293 | Vendedor | Baja | Catálogo del celular: la marca incremental (`updated_at > marca`) podía saltarse para siempre un cambio confirmado tarde. Se baja con 5 minutos de margen. | Corregido | typecheck (sin prueba propia) |
| 294 | Jefe | Media | **Exportar a CSV ejecutaba fórmulas:** un nombre de producto o motivo que empieza con `=`, `+`, `-` o `@` corría como fórmula en el Excel del dueño. Se antepone un apóstrofo. | Corregido | core: csv.test |
| 295 | Jefe | Baja | Impuesto adicional: "18,555 %" se guardaba 18,56 sin aviso (y el mensaje decía 18,555); código SII 0 o negativo pasaba (pantalla y base). | Corregido (pantalla + 0038) | revision-0038 (13) |
| 296 | Jefe | Baja | PDF de una factura del SII: con Supabase caído decía "Esa factura no tiene PDF". | Corregido | typecheck (sin prueba propia) |
| 297 | Jefe | Baja | Respaldo diario: el archivo se nombraba con el día de UTC (regla 17); uno pedido a mano de noche quedaba con la fecha de mañana y lo pisaba el de la madrugada. | Corregido | typecheck worker (sin prueba propia) |
| 298 | Jefe | Baja | Bitácora: las ofertas salían sin el producto (las funciones anotan `'product'` en singular y la pantalla buscaba `'products'`). | Corregido | typecheck (sin prueba propia) |
| 299 | Vendedor | Baja | Resumen impreso del cierre: salía con el resumen de la pantalla, no con el que guardó la base; una venta sin red sincronizada recién quedaba en el cierre y no en el papel. | Corregido | typecheck (sin prueba propia) |
| 300 | Supervisor | Baja | Novedades: el supervisor solo veía lo marcado "supervisor" y no los cambios de Vender o Recibir, que también usa. | Corregido | typecheck (sin prueba propia) |

## Resumen

| | Cantidad |
|---|:-:|
| Alta | 5 (251, 252, 271, 272, 274) |
| Media | 22 |
| Baja | 23 |
| Corregidos | 50 |
| Con prueba de base propia, vista fallar sin 0038 | 251–262, 274, 289, 290, 295 (13 pruebas en `revision-0038.test.mjs` + `stock-inicial.test.mjs` reescrita) |
| Con prueba de core, vista fallar sin el arreglo | 263, 264, 288, 289, 290, 294 |
| typecheck (sin prueba propia) | el resto |

**No cuentan como errores de esta ronda:** los dos de la maqueta anotados en
docs/27 ("se vuelve a sembrar en cada carga" y "Devolver abre vacío") **ya
estaban corregidos** (0.6.0: `VERSION_SEMILLA`, y la maqueta explica que no
hace devoluciones). Se revisó el código y se dejan cerrados.

## Lo más grave, en una línea cada uno

- **N° 251 · Desactivar a alguien no le cortaba los datos**: seguía leyendo
  ventas y costos, y escribiendo productos, por la API.
- **N° 252 · Un vendedor podía crear proveedores, categorías y tiendas**: el
  INSERT de las políticas "for all" no miraba el rol.
- **N° 271, 272, 274 · Una factura que el SII ya emitió podía emitirse otra
  vez** (o descartarse devolviendo el stock) si el registro fallaba un segundo.
- **N° 285 · El lector de códigos agregaba otro producto** cuando el código no
  estaba en el catálogo.
- **N° 294 · El CSV exportado podía ejecutar fórmulas** escritas por cualquier
  usuario en el Excel del dueño.
- **N° 262–263 · Perecibles con stock sin lote** (sin FEFO ni aviso), por la
  base y por la planilla.

## Migración nueva: 0038 (sin aplicar en Supabase)

`supabase/migrations/0038_revision_ronda_8.sql`. Cada función parte de su
última definición copiada tal cual y conserva su firma (regla 21):
`fn_devolver_venta` (0029), `fn_nota_credito_factura` (0026),
`fn_create_product` (0024), `fn_update_product` (0020), `fn_guardar_combo`
(0037), `fn_problema_tramo` (0021), `fn_reintentar_factura` y
`fn_descartar_factura` (0026), `fn_guardar_impuesto` (0018) y
`current_tenant_id` (0002). Además: políticas (`profiles_read`,
`stores_write`, `categories_write`, `suppliers_write`, `prod_sup_write`,
`suppliers_insert`, `categories_insert`; se borran `products_insert`,
`barcodes_write`, `profiles_insert`), permisos por columna en `products`
(`is_active`) y `profiles`, y `v_adjustments` con `movement_id` al final.
**0005 y 0013 ahora hacen `drop view if exists v_adjustments`** antes de
crearla (regla 22: sin eso, reinstalar falla con "cannot drop columns from
view"; lo encontró `instalacion.test`).

**Antes de aplicarla:**
1. 0029 a 0037 aplicadas, en orden. 0038 no agrega RPC: `db:aplicar` sigue
   esperando **46 funciones**.
2. **Cambia comportamiento, a propósito:**
   - Una cuenta desactivada deja de ver datos al instante (antes seguía con su
     sesión). Es el punto.
   - `products` ya no admite UPDATE directo salvo `is_active`, ni INSERT
     directo. Si algún script externo escribe productos a mano, que use
     `fn_create_product`/`fn_update_product`.
   - `profiles`: nadie cambia `email`, `tenant_id` ni `id` por la API.
   - Un perecible con stock inicial y sin vencimiento se rechaza
     (`VENCIMIENTO_REQUERIDO`). La pantalla ya lo exigía; la planilla, desde
     esta ronda, pide la columna `vencimiento`.
   - Supervisor y bodega **sí** pueden crear proveedores y categorías (Recibir
     y Producto nuevo lo ofrecen); vendedor ya no.
3. Correr `npm run db:test` como un usuario que no sea root (ver abajo).

## Encontrados después del 300 (sin corregir)

- **Convertir en perecible un producto que ya tiene stock** (`fn_update_product`)
  lo deja con stock y sin lote: la revisión semanal ahora lo marca como
  descuadre, pero nada lo impide ni pide la fecha.
- **Copia sin red de Vender**: si la caja se cierra y después se queda sin
  red, la copia guardada dice que hay caja abierta; la venta se encola y la
  base la rechaza al sincronizar (`CAJA_NO_ABIERTA`).
- **Kardex**: movimientos del mismo producto en la misma transacción tienen el
  mismo `created_at` y salen en cualquier orden (el saldo parece saltar).
- **`alerts_update`**: un supervisor puede reescribir el `payload` de una
  alerta (solo debería marcarla leída). Mismo arreglo que `products`: permiso
  por columna.
- **Correo del worker**: la fecha del encabezado es la de Santiago, no la zona
  del local.
- `fn_devolver_venta` con `p_reembolso` nulo llega hasta el insert (error
  técnico en vez de `REEMBOLSO_INVALIDO`); la pantalla siempre lo manda.
- `/api/usuarios/estado` revisa como máximo 200 cuentas.

## Verificación

- **`npm run db:test`: 207 pruebas, 0 fallas, 1 TODO (T-45, conocido).**
  Corrido como un usuario sin privilegios (`useradd pgtest`, `runuser -u
  pgtest -- npm run db:test`), con `packages/core/dist` construido antes y
  permiso de escritura en `supabase/` (instalacion.test regenera
  `instalar.sql`). Así se pudo correr por primera vez la 0037.
- `revision-0037.test.mjs`: 9/9 con 0037; **9/9 fallan sin ella**.
- `revision-0038.test.mjs`: 13/13 con 0038; **13/13 fallan sin ella**.
  `stock-inicial.test.mjs` reescrita para la decisión 4 (falla sin 0038).
- `packages/core`: **470 pruebas, 0 fallas** (vitest). Las nuevas se vieron
  fallar sin el arreglo.
- `apps/web`: `tsc --noEmit` sin errores; `next build` de producción
  (`NEXT_PUBLIC_DEMO=false`) termina bien.
- `apps/worker`: `tsc --noEmit` sin errores; `npm test` **6/6 con
  Chromium** (`CHROME_PATH=/opt/pw-browsers/…/chrome`; sin él se omiten las 6).
- `npm run db:check`: **185 cuerpos PL/pgSQL compilan**.
- **No corrido:** los recorridos de la maqueta y contra la base real
  (`tools/ui`), y nada contra Supabase de verdad (la 0037 y la 0038 siguen sin
  aplicar). Las filas "typecheck (sin prueba propia)" compilan pero no tienen
  una prueba que las demuestre.
