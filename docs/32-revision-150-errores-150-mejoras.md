# 32 — Revisión 2026-10-11: 150 errores y 150 mejoras

**Fecha:** 2026-10-11 · **Versión:** 0.6.4 · **Pedido:** "Necesito que revisemos y hagamos pruebas
normales en el front y backend de la página web, ¿podemos mejorar? Busca 150 errores y 150 mejoras".

Se revisó todo `apps/web` (el sistema del local y la tienda), sus rutas `/api`, las funciones
de la base (Supabase) y el worker, empezando por lo que se usa el primer día: Vender, Cobro,
Caja, Recibir mercadería, Inventario y el ingreso. La numeración es propia (E-1 a E-150 y
M-1 a M-150): no sigue la de [docs/26](26-revision-por-rol-50-errores.md) y
[docs/27](27-revision-por-rol-50-errores-mas.md).

## En corto

- **150 errores encontrados:** 147 corregidos y 3 pendientes, con su motivo.
  Gravedad: 22 altos, 73 medios y 55 bajos.
- **150 mejoras:** 25 hechas en esta revisión y 125 propuestas, con prioridad.
- **Todo está en la rama `ccr-2f68b3d1-6i818v`, no en `main`.** Railway publica `main`.

## Antes de publicar en `main` (obligatorio)

1. **Aplicar la migración 0040 en Supabase** (antes, la 0039 de `main` si no está) (`npm run db:instalar` y después
   `npm run db:aplicar -- --aplicar`, que diagnostica y aplica lo que falte). Es idempotente y no cambia
   ninguna firma: puede ir antes que el código. Sin ella siguen abiertos los errores de la base
   (caja con montos negativos, ajustes sin lotes, cuentas desactivadas que anulan, vencimientos
   con el día de UTC).
2. **Revisar que `WORKER_SHARED_SECRET` esté configurada en el worker de Railway.** Desde esta
   revisión, sin ella el worker rechaza toda llamada a `/jobs` en producción (antes las aceptaba
   de cualquiera). Los trabajos programados (cron) no se ven afectados.
3. Avisar al local lo de [Novedades 0.6.4](../apps/web/src/lib/novedades.ts): Fiado ya no aparece al
   cobrar, y la recepción pide la fecha de la factura.

## Cómo se probó

| Qué | Comando | Resultado |
|---|---|---|
| Tipos de la web, core y worker | `npx tsc --noEmit` en cada paquete | sin errores |
| Pruebas de core | `npm test -w packages/core` | 545 de 545 |
| Pruebas del worker | `CHROME_PATH=/opt/pw-browsers/chromium npm test -w apps/worker` | 6 de 6 (portal simulado del SII; el resumen diario no tiene prueba propia) |
| Funciones de la base compilan | `npm run db:check` | 173 cuerpos PL/pgSQL OK |
| Pruebas de la base (Postgres de verdad) | `npm run db:test` (usuario sin root) | 199 verdes + 1 TODO (T-45), 0 fallas; las 7 nuevas de `revision-150.test.mjs` vistas fallar antes |
| Recorridos de pantalla en la maqueta | `RA_BASE=http://localhost:3005 node tools/ui/<recorrido>.mjs` | 12 recorridos; 11 verdes y `demo-roles` con 1 de 184 pantallas con el error #418 (E-111, pendiente) |

## Cómo leer las tablas

*Alta*: plata, stock o documentos que quedan mal, o la persona no puede terminar lo que hace.
*Media*: información engañosa, un paso que confunde o un riesgo de seguridad acotado. *Baja*:
formato, texto o un caso raro. "typecheck (sin prueba propia)" quiere decir que se corrigió y nada
se rompió, pero **no hay una prueba que lo demuestre por sí misma**. "vista fallar" quiere decir
que la prueba se escribió primero y falló contra el código de antes (regla 16).

## Los 150 errores

| N° | Área | Lo ve | Gravedad | Qué pasaba | Estado | Verificado con |
|---:|---|---|---|---|---|---|
| E-1 | Vender · cola | Vendedor | Alta | Una venta que se cortaba a mitad del envío (pestaña cerrada, celular apagado) quedaba en estado "enviando" para siempre: fuera de la cola, con la plata en el cajón y sin venta en el sistema. | Corregido | typecheck (sin prueba propia) |
| E-2 | Vender · cola | Vendedor | Alta | Un corte de red al sincronizar marcaba la venta como "rechazada por la base" (barra roja) cuando solo faltaba señal. | Corregido | core: esErrorDeRed (pruebas) · typecheck |
| E-3 | Vender · cola | Vendedor | Alta | Si la sincronización automática (cada 60 s) estaba corriendo al cobrar, el cobro no esperaba: se entregaba el comprobante "sin folio" de una venta que la base todavía podía rechazar. | Corregido | typecheck (sin prueba propia) |
| E-4 | Vender · cola | Vendedor | Alta | Con la señal cortada a mitad del cobro, la venta seguía marcada "con conexión": al llegar después la base la podía rechazar por stock aunque el cliente ya se había ido con el producto. | Corregido | typecheck (sin prueba propia) |
| E-5 | Vender · cola | Vendedor | Media | Las ventas rechazadas no tenían salida: aunque se resolvieran a mano, la barra roja quedaba para siempre. | Corregido | typecheck (sin prueba propia) |
| E-6 | Barra de conexión | Todos | Media | "Enviar ahora" quedaba en "enviando…" para siempre si fallaba IndexedDB o la red a mitad. | Corregido | typecheck (sin prueba propia) |
| E-7 | Salir | Todos | Baja | db.ts decía "al cerrar sesión se borra todo", pero nadie llamaba a clearLocalData: el catálogo, el carrito y el borrador quedaban para el siguiente turno. | Corregido | recorrido demo-flujo |
| E-8 | Configuración del local | Vendedor | Alta | Si la primera lectura de la configuración fallaba (sin señal), quedaban los valores por omisión TODA la sesión: "vender sin stock" apagado y, con el stock en cero el primer día, el cajero no podía cobrar. | Corregido | typecheck (sin prueba propia) |
| E-9 | Configuración del local | Vendedor | Media | La configuración no se guardaba en el celular: sin conexión se cobraba con los valores por omisión (sin redondeo, sin vender sin stock). | Corregido | typecheck (sin prueba propia) |
| E-10 | Vender | Vendedor | Media | Vender no volvía a leer la configuración al recuperar internet. | Corregido | typecheck (sin prueba propia) |
| E-11 | Catálogo del celular | Vendedor | Alta | Los códigos de barra se bajaban sin paginar: la API corta en 1.000 sin avisar y los demás productos "no estaban en el catálogo" al escanearlos. | Corregido | typecheck (sin prueba propia) |
| E-12 | Catálogo del celular | Vendedor | Alta | El stock de cada producto se bajaba sin paginar (tope 1.000): con más productos, el resto aparecía con stock 0. | Corregido | typecheck (sin prueba propia) |
| E-13 | Catálogo del celular | Vendedor | Media | Los vencimientos (lotes) se bajaban sin paginar: el aviso de lote vencido dejaba de salir. | Corregido | typecheck (sin prueba propia) |
| E-14 | Catálogo del celular | Vendedor | Media | Las ofertas por cantidad se bajaban sin paginar: con más de 1.000 tramos, algunas no se cobraban sin conexión. | Corregido | typecheck (sin prueba propia) |
| E-15 | Catálogo del celular | Vendedor | Media | La bajada parcial usaba la hora del celular como marca: con el reloj adelantado, lo que cambió en esos minutos no se bajaba nunca. | Corregido | typecheck (sin prueba propia) |
| E-16 | Catálogo del celular | Vendedor | Media | Un producto eliminado seguía en el celular hasta una bajada completa: se vendía sin conexión y la base rechazaba la venta entera. | Corregido | typecheck (sin prueba propia) |
| E-17 | Catálogo del celular | Vendedor | Baja | Las páginas de productos se pedían ordenadas solo por fecha: con empates podían repetir o saltar productos. | Corregido | typecheck (sin prueba propia) |
| E-18 | Catálogo del celular | Vendedor | Media | Se bajaban dos o tres catálogos a la vez (la pantalla, la de cada 10 min, la de después de vender), cruzándose al escribir. | Corregido | typecheck (sin prueba propia) |
| E-19 | Vender | Vendedor | Media | Escape en la cantidad de una línea confirmaba lo escrito en vez de descartarlo. | Corregido | typecheck (sin prueba propia) |
| E-20 | Vender | Vendedor | Alta | Un descuento en pesos puesto con 3 unidades quedaba mayor que la línea al bajar a 1: el total de la pantalla y el de la base no coincidían y el cobro fallaba con "el pago no cuadra". | Corregido | typecheck (sin prueba propia) |
| E-21 | Cobro | Vendedor | Media | "Fiado" seguía apareciendo al cobrar a clientes con tope de antes, aunque el local dejó de fiar y ya no hay pantalla para cobrar esa deuda. | Corregido | recorrido demo-ronda4 |
| E-22 | Vender | Vendedor | Baja | La pantalla no tenía título (h1) para el lector de pantalla (demo-roles: h1=""). | Corregido | recorrido demo-roles |
| E-23 | Descuento | Vendedor | Baja | La cantidad salía sin formato ("1.5 × $990"). | Corregido | typecheck (sin prueba propia) |
| E-24 | Comprobante | Vendedor | Baja | El diálogo hecho a mano no cerraba con Escape y dejaba el foco detrás, en el carrito que ya no existe. | Corregido | typecheck (sin prueba propia) |
| E-25 | Vender | Vendedor | Baja | La lectura de "precios actualizados hace…" no manejaba su error (promesa sin catch). | Corregido | typecheck (sin prueba propia) |
| E-26 | Diálogos | Todos | Media | Todos los diálogos ignoraban el autoFocus de sus campos (el foco iba a "Cancelar") y al cerrar el foco se perdía. | Corregido | typecheck (sin prueba propia) |
| E-27 | Caja | Vendedor | Alta | Cerrar la caja con ventas de ese celular todavía sin enviar daba un sobrante falso (y un faltante al llegar después a una caja cerrada). No avisaba. | Corregido | typecheck (sin prueba propia) |
| E-28 | Caja (maqueta) | Todos | Baja | La caja de ejemplo se abría "a las 9:15" del día del servidor (UTC) fijadas al arrancar: pasada la medianoche de Chile salía "de otro día" (QA-01 de demo-ronda5 fallaba). | Corregido | recorrido demo-ronda5 |
| E-29 | Caja | Vendedor | Baja | Quedaba código que calculaba el día en la zona del navegador (regla 17). | Corregido | typecheck (sin prueba propia) |
| E-30 | Base · caja | Jefe | Media | fn_add_cash_movement no revisaba que la cuenta siguiera activa: un desactivado con la sesión abierta seguía moviendo plata. | Corregido | pg-test: revision-150.test.mjs |
| E-31 | Base · caja | Jefe | Baja | fn_close_cash_session no revisaba que la cuenta siguiera activa. | Corregido | pg-test: revision-150.test.mjs |
| E-32 | Base · caja | Jefe | Media | fn_close_cash_session aceptaba un efectivo contado negativo (el arqueo quedaba con un faltante falso). | Corregido | pg-test: revision-150.test.mjs |
| E-33 | Base · caja | Jefe | Media | Bodega podía abrir caja por la API (la pantalla lo impedía, la base no; doc 02: bodega no ve dinero). | Corregido | pg-test: revision-150.test.mjs |
| E-34 | Base · caja | Jefe | Baja | Un monto inicial negativo se convertía en 0 sin avisar, y no había tope. | Corregido | pg-test: revision-150.test.mjs |
| E-35 | Base · caja | Jefe | Baja | Los movimientos de caja no tenían tope de monto ni largo máximo del motivo. | Corregido | db:check · pg-test |
| E-36 | Base · inventario | Bodega | Alta | Un ajuste a la baja (merma, pérdida) de un perecible no descontaba de sus lotes: Vencimientos seguía mostrando lo que se botó. | Corregido | pg-test: revision-150.test.mjs |
| E-37 | Base · inventario | Bodega | Alta | La toma de inventario a la baja tampoco descontaba de los lotes. | Corregido | pg-test: revision-150.test.mjs |
| E-38 | Base · inventario | Bodega | Media | fn_adjust_stock aceptaba una cantidad negativa. | Corregido | pg-test: revision-150.test.mjs |
| E-39 | Base · inventario | Bodega | Media | fn_adjust_stock aceptaba decimales (0032 dejó todo por unidad). | Corregido | pg-test: revision-150.test.mjs |
| E-40 | Base · inventario | Bodega | Media | fn_apply_stock_count aceptaba conteos negativos o con decimales. | Corregido | pg-test: revision-150.test.mjs |
| E-41 | Base · inventario | Jefe | Media | fn_apply_stock_count aceptaba un producto de OTRO local y le creaba stock acá. | Corregido | pg-test: revision-150.test.mjs |
| E-42 | Base · ventas | Jefe | Media | Una venta con la hora del celular adelantada quedaba con fecha futura y salía en los reportes de mañana. | Corregido | pg-test: revision-150.test.mjs |
| E-43 | Base · seguridad | Jefe | Alta | CP-10 (T-45): un vendedor puede leer costos desde products y sale_items. Necesita rehacer RLS y vistas; no se toca la víspera de partir. | Pendiente | pg-test TODO existente |
| E-44 | Base · inventario | Bodega | Media | Un ajuste o toma HACIA ARRIBA de un perecible deja stock sin lote ni vencimiento (no hay dónde pedir la fecha en la función). | Pendiente | revisión de código |
| E-45 | Recibir mercadería | Bodega | Alta | Un segundo toque en "Confirmar recepción" mientras se revisaba la caja o el total del papel lanzaba otra recepción: la mercadería entraba dos veces. | Corregido | typecheck (sin prueba propia) |
| E-46 | Recibir mercadería | Bodega | Alta | Con "costos con IVA" (la boleta, que viene marcada así) la línea partía con el costo anterior NETO en un campo que se lee con IVA: sin reescribirlo, el costo bajaba 16 %. | Corregido | typecheck (sin prueba propia) |
| E-47 | Recibir mercadería | Bodega | Media | Cambiar entre neto y con IVA no rehacía el costo de las líneas sin tocar. | Corregido | typecheck (sin prueba propia) |
| E-48 | Recibir mercadería | Bodega | Media | Escanear dos veces el mismo producto no sumaba: solo avisaba "ya está en la lista". | Corregido | typecheck (sin prueba propia) |
| E-49 | Recibir mercadería | Bodega | Baja | Al escanear, los datos del producto se buscaban por su nombre (con comas o paréntesis no lo encontraba). | Corregido | typecheck (sin prueba propia) |
| E-50 | Recibir mercadería | Jefe | Media | La factura iba al libro de compras con la fecha de HOY, no la de la factura: una del 30 recibida el 1 quedaba en otro mes. | Corregido | typecheck (sin prueba propia) |
| E-51 | Recibir mercadería | Jefe | Media | El resultado de la recepción viajaba en la dirección (&detalle=…): cualquiera podía armar un enlace que mostraba un mensaje verde inventado dentro del sistema, y recargar lo repetía. | Corregido | typecheck (sin prueba propia) |
| E-52 | Compras | Jefe | Media | Solo se veían las últimas 30 recepciones: las anteriores no se podían ver ni anular. | Corregido | typecheck (sin prueba propia) |
| E-53 | Qué comprar | Jefe | Media | El proveedor sugerido salía de 5.000 líneas sin orden: con más, podía ser el de una compra vieja. | Corregido | typecheck (sin prueba propia) |
| E-54 | Qué comprar | Jefe | Baja | Si no se podía copiar el pedido, el error reemplazaba la lista entera. | Corregido | typecheck (sin prueba propia) |
| E-55 | Por pagar | Jefe | Baja | Una factura podía registrarse con vencimiento ANTERIOR a su emisión (escribiendo la fecha a mano). | Corregido | typecheck (sin prueba propia) |
| E-56 | Inventario · toma | Bodega | Alta | Con el buscador filtrando otra cosa, la revisión de la toma mostraba "Producto 0 → 12": sin nombre ni stock del sistema de lo contado antes. | Corregido | typecheck (sin prueba propia) |
| E-57 | Inventario | Bodega | Baja | El saldo del historial salía sin formato. | Corregido | typecheck (sin prueba propia) |
| E-58 | Inventario · toma | Bodega | Baja | Las diferencias de la toma salían sin formato. | Corregido | typecheck (sin prueba propia) |
| E-59 | Inventario · toma | Bodega | Baja | El buscador de la toma no tenía nombre accesible (RNF-61). | Corregido | typecheck (sin prueba propia) |
| E-60 | Inventario | Jefe | Media | "Valor al costo" y "Bajo mínimo" pasaban a contar solo lo buscado sin decirlo. | Corregido | typecheck (sin prueba propia) |
| E-61 | Inventario | Bodega | Baja | Una respuesta lenta de una búsqueda anterior podía pisar la lista de la búsqueda nueva. | Corregido | typecheck (sin prueba propia) |
| E-62 | Inventario · toma | Bodega | Baja | Una toma que fallaba al aplicarse quedaba "en progreso" para siempre. | Corregido | typecheck (sin prueba propia) |
| E-63 | Inventario y Productos | Todos | Media | Lo vendido sin stock aparecía como "−3 unidades en bodega", que nadie entiende. | Corregido | typecheck (sin prueba propia) |
| E-64 | Producto | Bodega | Media | Un doble toque en "Guardar" mientras se revisaba el código escrito creaba el producto dos veces. | Corregido | typecheck (sin prueba propia) |
| E-65 | Producto | Bodega | Alta | Si el alta quedaba guardada pero fallaban las ofertas o la foto, volver a "Guardar" creaba OTRO producto igual. | Corregido | typecheck (sin prueba propia) |
| E-66 | Producto | Bodega | Baja | La categoría nueva se volvía a crear en el reintento (y chocaba con la que ya existía). | Corregido | typecheck (sin prueba propia) |
| E-67 | Etiquetas | Bodega | Media | Generar un código interno escribía todos los datos de la lista cargada: si alguien cambió el precio entremedio, lo devolvía al viejo sin avisar. | Corregido | typecheck (sin prueba propia) |
| E-68 | Etiquetas | Bodega | Media | Elegir productos en una búsqueda y después en otra sacaba de la impresión los de la primera. | Corregido | typecheck (sin prueba propia) |
| E-69 | Importar | Jefe | Media | Una planilla CSV guardada por Excel en Windows (Windows-1252) se leía como UTF-8: "Categoría" no se reconocía y los nombres con ñ o tildes quedaban rotos. | Corregido | typecheck (sin prueba propia) |
| E-70 | Ventas | Jefe | Baja | "Anulada por" salía vacío en producción (solo la maqueta lo mostraba). | Corregido | typecheck (sin prueba propia) |
| E-71 | Ventas | Jefe | Media | Si no se podían leer las líneas o los pagos, el detalle se mostraba vacío como si la venta no tuviera productos. | Corregido | typecheck (sin prueba propia) |
| E-72 | Ventas | Jefe | Baja | Una respuesta lenta de un filtro anterior podía pisar la lista del filtro nuevo. | Corregido | recorridos demo |
| E-73 | Ventas | Jefe | Baja | La copia del comprobante calculaba el neto como total − IVA, que no es el neto con impuestos adicionales. | Corregido | typecheck (sin prueba propia) |
| E-74 | Devolución | Jefe | Baja | La cantidad a devolver aceptaba decimales (la base los rechaza desde 0032). | Corregido | typecheck (sin prueba propia) |
| E-75 | Devolución | Jefe | Baja | El campo de cantidad abría el teclado decimal. | Corregido | typecheck (sin prueba propia) |
| E-76 | Usuarios · turnos | Jefe | Alta | /turno y /api/cuenta/rol leen los "roles permitidos" de cada persona, pero NADA los escribía: elegir "Vendo / Bodega" al entrar solo se podía activando a mano en Supabase. | Corregido | typecheck (sin prueba propia) |
| E-77 | Turno | Vendedor | Media | Pasar a Bodega con la caja abierta la dejaba abierta y escondida (bodega no ve Caja). | Corregido | typecheck (sin prueba propia) |
| E-78 | Cuenta desactivada | Todos | Media | La pantalla "Tu cuenta está desactivada" no tenía "Salir": el celular quedaba tomado y nadie más podía entrar en él. | Corregido | typecheck (sin prueba propia) |
| E-79 | Bloqueo de pantalla | Todos | Media | Los intentos fallidos se reiniciaban al recargar la página: se podía probar contraseñas sin pausa. | Corregido | typecheck (sin prueba propia) |
| E-80 | Ingreso | Todos | Baja | "No recordar" no valía para quien entra con RUT: la casilla volvía marcada. | Corregido | typecheck (sin prueba propia) |
| E-81 | Mi cuenta | Todos | Media | Al cambiar el RUT, el ingreso seguía recordando el viejo y la próxima entrada fallaba sin que se entendiera por qué. | Corregido | typecheck (sin prueba propia) |
| E-82 | Mi cuenta · PIN | Jefe | Media | El PIN para autorizar descuentos aceptaba 0000, 1111 o 1234. | Corregido | typecheck (sin prueba propia) |
| E-83 | Varias pantallas | Todos | Baja | Proveedores, recepción y toma usaban auth.getUser() y después user!.id: con la sesión vencida reventaban con "Cannot read properties of null". | Corregido | typecheck (sin prueba propia) |
| E-84 | Servidor · /api | Jefe | Baja | Restablecer una contraseña devolvía el mensaje de Supabase en inglés. | Corregido | typecheck (sin prueba propia) |
| E-85 | Servidor · /api | Jefe | Baja | Invitar por correo aceptaba cualquier texto como correo y devolvía errores en inglés. | Corregido | typecheck (sin prueba propia) |
| E-86 | Servidor · /api | Jefe | Baja | El estado de las cuentas devolvía el texto crudo del error de la base. | Corregido | typecheck (sin prueba propia) |
| E-87 | Servidor · /api | — | Media | El buzón de errores (/api/errores) no pide sesión y no tenía límite: cualquiera podía llenar el registro del servidor. | Corregido | typecheck (sin prueba propia) |
| E-88 | Servidor · límites | — | Media | El límite de solicitudes tomaba la IP del PRIMER X-Forwarded-For, que escribe quien pide: bastaba cambiarlo para saltarse el límite. | Corregido | typecheck (sin prueba propia) |
| E-89 | Servidor · middleware | Todos | Baja | Una ruta /api/ sin sesión respondía con la página HTML de /login en vez de un 401 en JSON. | Corregido | typecheck (sin prueba propia) |
| E-90 | Servidor · middleware | Todos | Baja | "Salir" con la sesión ya vencida rebotaba a /login con un 307, que repite el POST. | Corregido | typecheck (sin prueba propia) |
| E-91 | Servidor · middleware | Todos | Baja | /api/version (aviso de versión nueva) redirigía a /login sin sesión. | Corregido | typecheck (sin prueba propia) |
| E-92 | Configuración | Jefe | Baja | Al cambiar de pestaña la dirección quedaba "#[object Object]": el enlace directo a una pestaña no servía. | Corregido | recorrido demo-ronda2 |
| E-93 | Configuración | Jefe | Alta | "Respaldo" decía "los respaldos diarios de la base siguen corriendo aparte", y el respaldo automático no está activado. | Corregido | revisión de texto |
| E-94 | Configuración | Jefe | Media | El RUT del emisor se guardaba sin validar y salía en cada documento. | Corregido | typecheck (sin prueba propia) |
| E-95 | Emisor SII | Jefe | Media | "Borrar credenciales" del SII no pedía confirmar (RNF-19). | Corregido | typecheck (sin prueba propia) |
| E-96 | Facturación | Jefe | Baja | Un error (un reintento rechazado) reemplazaba la lista de facturas entera, sin forma de volver a verla. | Corregido | typecheck (sin prueba propia) |
| E-97 | Bitácora | Jefe | Baja | Lo que escriben las rutas del servidor (rol del turno, datos de cuenta, claves del SII) salía con el código crudo. | Corregido | typecheck (sin prueba propia) |
| E-98 | Clientes | Jefe | Baja | La pantalla seguía diciendo que los clientes son "para la factura y el fiado" (el local ya no fía). | Corregido | revisión de texto |
| E-99 | Reportes · productos | Jefe | Alta | La vista trae una fila por producto y día: con 30 días se pasaba de 1.000 filas y el reporte quedaba corto sin avisar. | Corregido | typecheck (sin prueba propia) |
| E-100 | Reportes · vendedores | Jefe | Media | Por vendedor tampoco se paginaba. | Corregido | typecheck (sin prueba propia) |
| E-101 | Reportes · inventario | Jefe | Media | Inventario valorizado se cortaba en 1.000 productos. | Corregido | typecheck (sin prueba propia) |
| E-102 | Reportes · sin vender | Jefe | Media | "Sin vender" se cortaba en 1.000 productos. | Corregido | typecheck (sin prueba propia) |
| E-103 | Reportes · mermas | Jefe | Media | Mermas y ajustes se cortaba en 1.000 filas (la toma inicial de todo el catálogo las pasa en un día). | Corregido | typecheck (sin prueba propia) |
| E-104 | Impuestos | Jefe | Media | Al elegir productos para un impuesto, los que pasaban de 1.000 salían "sin impuesto". | Corregido | typecheck (sin prueba propia) |
| E-105 | Impuestos | Jefe | Baja | El conteo de productos de cada impuesto se cortaba en 1.000. | Corregido | typecheck (sin prueba propia) |
| E-106 | Cantidades (core) | Bodega | Alta | "1.000" de algo que se cuenta entero se leía como 1 (punto decimal) en Vender, Recibir, Ajustar y la toma: recibir "1.000 bolsas" dejaba una. | Corregido | core: cantidad-venta.test.ts (vista fallar) |
| E-107 | Cantidades (core) | Todos | Media | "1e2" se leía 100 y "0x10" 16 en cualquier cantidad. | Corregido | core: cantidad-venta.test.ts (vista fallar) |
| E-108 | RUT (core) | Todos | Baja | "00.000.000-0" pasaba como RUT válido (el dígito cuadra y el largo engañaba). | Corregido | core: validaciones.test.ts |
| E-109 | Montos (core) | Todos | Baja | Sin máximo propio, un monto pasaba del integer de PostgreSQL y la base lo rechazaba con un error ininteligible. | Corregido | core: validar-monto.test.ts |
| E-110 | Inicio | Jefe | Baja | El mínimo de "Bajo stock" salía sin formato ni rótulo. | Corregido | typecheck (sin prueba propia) |
| E-111 | Inicio | Supervisor | Media | Error de hidratación de React (#418) intermitente en el Inicio (demo-roles lo vio una vez en 184 pantallas, igual que en la 6ª ronda). | Pendiente | recorrido demo-roles (no se pudo repetir) |
| E-112 | Barra de conexión y maqueta | Todos | Baja | Las barras de "Sin conexión" y "MODO DEMO" medían 29–32 px (RNF-16 pide 44). | Corregido | recorrido demo-roles |
| E-113 | Pruebas · demo-flujo | — | Media | El recorrido creaba la cuenta con correo; desde el 2026-10-07 se crea con RUT y fallaba. | Corregido | recorrido |
| E-114 | Pruebas · demo-ronda2 | — | Baja | Buscaba "Descargar mis datos" fuera de la pestaña Respaldo. | Corregido | recorrido |
| E-115 | Pruebas · demo-ronda3 | — | Baja | Creaba la cuenta con correo (hoy RUT). | Corregido | recorrido |
| E-116 | Pruebas · demo-ronda4 | — | Media | Probaba Fiado, que salió del sistema: ahora prueba que no quede ninguna puerta abierta. | Corregido | recorrido |
| E-117 | Pruebas · demo-ronda6 | — | Baja | Igual con "Dar crédito". | Corregido | recorrido |
| E-118 | Pruebas · seguridad | — | Baja | Una prueba usaba a bodega como cajero: con 0040 bodega no abre caja. | Corregido | pg-test seguridad |
| E-119 | Vencimientos | Bodega | Media | v_expiring_lots calculaba "días para vencer" con el día de UTC: desde las 21:00 de Chile lo que vence hoy salía como vencido. | Corregido | pg-test: revision-150.test.mjs |
| E-120 | Recibir mercadería | Bodega | Media | fn_confirm_receipt rechazaba con LOTE_YA_VENCIDO un lote que vence HOY si se recibía de noche (comparaba con el día de UTC). | Corregido | pg-test: revision-150.test.mjs |
| E-121 | Servidor · foto | Jefe | Media | Subir foto por enlace seguía redirecciones: un enlace público podía rebotar a una dirección interna (SSRF). | Corregido | typecheck (sin prueba propia) |
| E-122 | Servidor · foto | Jefe | Baja | Sin Content-Length, la foto por enlace se descargaba entera antes de mirar el tamaño (memoria del servidor). | Corregido | typecheck (sin prueba propia) |
| E-123 | Tienda | Cliente | Baja | Un filtro de precio "desde" mayor que "hasta" mostraba la tienda vacía sin explicación. | Corregido | typecheck (sin prueba propia) |
| E-124 | Tienda | Cliente | Baja | Una página inválida en la dirección (?pagina=-3 o 9999) dejaba el catálogo vacío; y la búsqueda no tenía largo máximo. | Corregido | typecheck (sin prueba propia) |
| E-125 | Clientes | Jefe | Media | La lista de clientes no se paginaba: pasado el cliente 1.000 no aparecían ni al buscar ni al facturar. | Corregido | typecheck (sin prueba propia) |
| E-126 | Worker | — | Alta | Sin WORKER_SHARED_SECRET el worker aceptaba a cualquiera también en producción: desde su dominio público se podían disparar respaldos, correos o la emisión de facturas. | Corregido | typecheck · pruebas del worker |
| E-127 | Resumen diario | Jefe | Media | El día del resumen iba con "-03:00" fijo: con el horario de invierno (-04:00) sumaba la última hora del día anterior. | Corregido | typecheck · pruebas del worker |
| E-128 | Resumen diario | Jefe | Media | Las ventas del día no se paginaban: con más de 1.000 ventas el total del correo salía corto. | Corregido | typecheck · pruebas del worker |
| E-129 | Resumen diario | Jefe | Media | Una caja olvidada abierta desde ayer no salía como "SIN CERRAR" (solo miraba las abiertas hoy). | Corregido | typecheck · pruebas del worker |
| E-130 | Usuarios · crear | Jefe | Media | Un RUT con un dígito de más que por azar cuadraba el verificador creaba una cuenta que no podía entrar nunca (se entra con 7 u 8 dígitos). | Corregido | typecheck (sin prueba propia) |
| E-131 | Usuarios · crear | Jefe | Baja | Crear una cuenta devolvía el error de Supabase en inglés. | Corregido | typecheck (sin prueba propia) |
| E-132 | Usuarios · datos | Todos | Media | Cambiar el RUT tenía el mismo problema del dígito de más: la persona quedaba sin poder entrar. | Corregido | typecheck (sin prueba propia) |
| E-133 | Ofertas de un producto | Bodega | Media | "Llevando desde" aceptaba 2,5 (todo es por unidad desde 0032) y leía "1.000" como 1, que después rechazaba con un mensaje que no se entendía. | Corregido | typecheck (sin prueba propia) |
| E-134 | Ofertas a varios productos | Jefe | Media | Lo mismo en la oferta masiva. | Corregido | typecheck (sin prueba propia) |
| E-135 | Producto | Bodega | Baja | El stock mínimo aceptaba decimales y leía "1.000" como 1. | Corregido | typecheck (sin prueba propia) |
| E-136 | Devolver a proveedor | Bodega | Media | Al escanear, el producto se buscaba por su nombre: con comas o paréntesis no se agregaba y no decía nada. | Corregido | typecheck (sin prueba propia) |
| E-137 | Facturas recibidas | Jefe | Media | Se podía registrar un vencimiento anterior a la emisión: quedaba "vencida" en Por pagar desde el primer día. | Corregido | typecheck (sin prueba propia) |
| E-138 | Facturas recibidas | Jefe | Baja | Borrar la fecha de emisión o escribir una futura a mano (el calendario no lo frena) llegaba a la base y fallaba con un error ininteligible o quedaba en el mes que no era. | Corregido | typecheck (sin prueba propia) |
| E-139 | Respaldo · descargar mis datos | Jefe | Media | Las páginas de 1.000 filas se pedían sin orden: en tablas grandes (ventas, kardex) el respaldo podía repetir filas y saltarse otras sin avisar. | Corregido | typecheck (sin prueba propia) |
| E-140 | Base · ventas | Jefe | Media | fn_void_sale no revisaba que la cuenta siguiera activa: un supervisor desactivado con la sesión abierta podía anular ventas. | Corregido | pg-test: revision-150.test.mjs |
| E-141 | Base · compras | Jefe | Media | fn_void_receipt tampoco: un administrador desactivado podía anular recepciones (y mover stock). | Corregido | pg-test: revision-150.test.mjs |
| E-142 | Base · productos | Bodega | Media | fn_update_product tampoco: una cuenta desactivada podía cambiar precios. | Corregido | pg-test: revision-150.test.mjs |
| E-143 | Configuración · impuestos | Jefe | Baja | El código SII del impuesto aceptaba "27,1" y lo redondeaba a 27 sin avisar: va impreso en la boleta. | Corregido | typecheck (sin prueba propia) |
| E-144 | Por pagar | Jefe | Baja | Con la fecha de emisión borrada a mano, la factura llegaba sin fecha a la base. | Corregido | typecheck (sin prueba propia) |
| E-145 | Reportes · exportar | Jefe | Media | Inyección de fórmulas: un texto que empieza con = + - @ (un motivo de merma, un nombre) se ejecutaba como fórmula al abrir el CSV en Excel. | Corregido | core: csv.test.ts (vista fallar) |
| E-146 | Ingreso | Todos | Media | Los intentos fallidos se reiniciaban al recargar la página: la espera tras 5 intentos se saltaba con F5. | Corregido | typecheck (sin prueba propia) |
| E-147 | Ingreso | Todos | Media | Con Supabase caído o en su límite (429/5xx) decía "RUT o contraseña incorrectos" y además sumaba intentos hasta hacer esperar. | Corregido | typecheck (sin prueba propia) |
| E-148 | Recuperar contraseña | Jefe | Baja | Sin conexión decía igual "te enviamos el enlace": se esperaba un correo que no iba a llegar. | Corregido | typecheck (sin prueba propia) |
| E-149 | Usuarios · contraseña | Jefe | Media | Restablecer la contraseña de otra persona no quedaba en la bitácora, y con la temporal se puede entrar como ella hasta que la cambie. | Corregido | typecheck (sin prueba propia) |
| E-150 | Carga masiva | Jefe | Alta | El catálogo exportado usa otros nombres de columna (codigo_interno, codigos_de_barra, costo_promedio): exportar, cambiar precios en Excel y volver a importar no reconocía ningún producto y los creaba todos de nuevo, duplicados. | Corregido | core: import.test.ts (vista fallar) |

### Los pendientes, y por qué

- **E-43 · Base · seguridad.** CP-10 (T-45): un vendedor puede leer costos desde products y sale_items. Necesita rehacer RLS y vistas; no se toca la víspera de partir.
- **E-44 · Base · inventario.** Un ajuste o toma HACIA ARRIBA de un perecible deja stock sin lote ni vencimiento (no hay dónde pedir la fecha en la función).
- **E-111 · Inicio.** Error de hidratación de React (#418) intermitente en el Inicio (demo-roles lo vio una vez en 184 pantallas, igual que en la 6ª ronda).

## Las 150 mejoras

### Hechas en esta revisión (25)

| N° | Área | Prioridad | Mejora | Verificado con |
|---:|---|---|---|---|
| M-1 | Usuarios | Media | El estado de las cuentas se lee con una consulta por página (listUsers) y no una por persona: con 200 cuentas eran 200 llamadas. | typecheck |
| M-2 | Inventario | Media | La búsqueda ya no hace tres consultas por cada letra: espera a que se termine de escribir y solo recarga los productos. | typecheck |
| M-3 | Catálogo del celular | Media | Las bajadas del catálogo se juntan: si se pide otra mientras corre una, se hace una sola al terminar. | typecheck |
| M-4 | Catálogo del celular | Media | Una bajada completa al día (además de las parciales) limpia lo eliminado sin esperar a cerrar sesión. | typecheck |
| M-5 | Cobro | Alta | Enter en "¿Con cuánto paga?" confirma el cobro: con lector y teclado no hay que ir al botón. | recorridos |
| M-6 | Vender | Media | Después de cada venta el foco vuelve al buscador, solo con mouse o teclado (en el celular no abre el teclado). | recorridos |
| M-7 | Comprobante | Baja | El foco cae en "Nueva venta" y Escape cierra. | typecheck |
| M-8 | Caja | Alta | Al cerrar con ventas sin enviar, la caja lo dice y ofrece "Enviarlas ahora". | typecheck |
| M-9 | Caja | Media | El cierre forzado de la caja de otro muestra faltante o sobrante antes de confirmar. | recorrido demo-ronda4 |
| M-10 | Caja | Baja | El motivo de un ingreso o egreso tiene tope visible de 300 letras (la base lo cortaba sin avisar). | typecheck |
| M-11 | Barra de errores | Media | "Ya la resolví: quitarla" para las ventas rechazadas que ya se arreglaron a mano. | typecheck |
| M-12 | Usuarios | Alta | Diálogo "Turnos" para elegir en qué roles puede trabajar cada persona (antes solo se podía en Supabase). | typecheck |
| M-13 | Usuarios | Media | Se ve el tope de descuento de cada persona en la lista. | typecheck |
| M-14 | Compras | Media | "Ver 30 más antiguas" en las recepciones. | typecheck |
| M-15 | Inventario | Baja | "Ver 80 más" en el historial (kardex) de un producto. | typecheck |
| M-16 | Tienda | Media | Después de mandar el pedido por WhatsApp se ofrece vaciar el carrito. | typecheck |
| M-17 | Bitácora | Baja | Nombres legibles para lo que escriben las rutas del servidor (turnos, datos de cuenta, claves SII, contraseña temporal). | typecheck |
| M-18 | Código compartido | Media | `esErrorDeRed` en core, con pruebas: una sola regla para decidir "sin señal" o "rechazada". | core: validaciones.test.ts |
| M-19 | Código compartido | Media | `todasLasFilas`: un solo ayudante para leer más de 1.000 filas, usado en catálogo, reportes, precios y clientes. | typecheck |
| M-20 | Código compartido | Baja | `perfilActual()`: el perfil desde la sesión sin `user!.id`. | typecheck |
| M-21 | Base de datos | Alta | 0040 con 7 pruebas propias (pg-test/revision-150) vistas fallar antes de corregir. | npm run db:test |
| M-22 | Pruebas | Media | Recorridos de la maqueta al día con el ingreso por RUT, sin fiado y con la fecha de la factura. | 12 recorridos verdes |
| M-23 | Novedades | Baja | Entrada 0.6.4 en Novedades con lo que cambia para quien usa el sistema. | revisión de texto |
| M-24 | Carga masiva | Alta | El catálogo exportado se puede editar en Excel y volver a importar tal cual. | core: import.test.ts |
| M-25 | Worker | Media | El resumen diario usa la zona del local de su configuración, no una fija. | typecheck |

### Propuestas (125)

Ordenadas por prioridad. *Alta*: conviene antes de crecer en uso. *Media*: ahorra trabajo diario.
*Baja*: comodidad. Ninguna está hecha; las de **Operación** son tareas de configuración.

| N° | Área | Prioridad | Mejora |
|---:|---|---|---|
| M-26 | Cobro | Alta | Pago mixto: parte en efectivo y parte con tarjeta en la misma venta (hoy se cobra con un solo medio). |
| M-27 | Sin conexión | Alta | Contador visible de ventas sin enviar en la barra superior, con la hora de la última sincronización exitosa. |
| M-28 | Inventario | Alta | Pedir la fecha de vencimiento al ajustar o contar HACIA ARRIBA un perecible (hoy queda stock sin lote; pendiente de la tabla de errores). |
| M-29 | Seguridad | Alta | CP-10 / T-45: que vendedor no pueda leer costos desde products y sale_items (rehacer RLS y vistas con calma, con pruebas). (pendiente de la tabla de errores) |
| M-30 | Seguridad | Alta | Content-Security-Policy en next.config (los demás encabezados de seguridad ya están: X-Frame-Options, HSTS, nosniff, Referrer y Permissions-Policy). |
| M-31 | Respaldo | Alta | Activar el respaldo automático diario del worker (BACKUP_BUCKET) y probar una restauración completa. |
| M-32 | Pruebas | Alta | Correr typecheck, pruebas de core, db:test y los recorridos en cada push (GitHub Actions) antes de Railway. |
| M-33 | Operación | Alta | Aplicar 0040 en Supabase (`npm run db:aplicar`) ANTES de publicar este código en main. (ver HANDOFF) |
| M-34 | Operación | Alta | Configurar WORKER_SHARED_SECRET en Railway (sin ella el worker ahora rechaza todo en producción). (ver HANDOFF) |
| M-35 | Vender | Media | Atajo de teclado para "Cobrar" (F2) y para quitar la última línea (Supr), para la caja con computador. |
| M-36 | Vender | Media | Pausar una venta (cliente que fue a buscar algo) y atender a otro sin perder el carrito. |
| M-37 | Vender | Media | Buscar también por parte del código de barras (los últimos 4–5 dígitos), como se hace a mano con un código dañado. |
| M-38 | Comprobante | Media | Enviar el comprobante por WhatsApp o correo además de imprimirlo. |
| M-39 | Descuentos | Media | Editar el tope de descuento por persona desde Usuarios (hoy sigue al rol). |
| M-40 | Sin conexión | Media | Avisar al salir (beforeunload) si quedan ventas sin enviar en ese celular. |
| M-41 | Sin conexión | Media | Reintentar el envío con espera creciente (5 s, 15 s, 60 s) en vez de cada 60 s fijos al volver la señal. |
| M-42 | Caja | Media | Arqueo parcial (contar a media jornada sin cerrar) para detectar diferencias antes. |
| M-43 | Caja | Media | Retiro de efectivo a caja fuerte con doble firma (quien retira y quien recibe). |
| M-44 | Caja | Media | Historial de cierres con su diferencia, por persona, con tendencia del mes. |
| M-45 | Inventario | Media | Toma de inventario por categoría o por pasillo, en varias sesiones, sin bloquear la venta. |
| M-46 | Inventario | Media | Conteo ciego: la toma no muestra el stock del sistema hasta terminar. |
| M-47 | Inventario | Media | Escanear para contar: cada lectura suma 1 al producto en la toma. |
| M-48 | Inventario | Media | Alerta de stock negativo agrupada por día, con el vendedor que vendió sin stock. |
| M-49 | Vencimientos | Media | Sugerir bajar el precio de lo que vence en 3 días (oferta rápida desde la alerta). |
| M-50 | Productos | Media | Cambio de precio masivo por categoría o proveedor (+5 %, redondeo a $10). |
| M-51 | Productos | Media | Marcar productos "a pedido" que no deben avisar stock bajo. |
| M-52 | Etiquetas | Media | Imprimir etiquetas de todo lo que cambió de precio desde una fecha. |
| M-53 | Carga masiva | Media | Advertir antes de salir de la página mientras se importa (beforeunload). |
| M-54 | Recibir mercadería | Media | Leer la factura electrónica del proveedor (XML del SII) para llenar la recepción sola. |
| M-55 | Recibir mercadería | Media | Guardar la recepción a medias en la base (hoy solo en la pestaña) para terminarla en otro equipo. |
| M-56 | Compras | Media | Órdenes de compra: lo pedido contra lo recibido, con faltantes marcados. |
| M-57 | Qué comprar | Media | Sugerencia por velocidad de venta (días de cobertura), no solo por stock mínimo. |
| M-58 | Por pagar | Media | Abonos parciales a una factura (hoy se marca pagada completa). |
| M-59 | Devolver a proveedor | Media | Ligar la nota de crédito recibida a la devolución para cerrar el ciclo. |
| M-60 | Ventas | Media | Buscar una venta por monto aproximado o por producto vendido. |
| M-61 | Devoluciones | Media | Cambio de producto (devolver uno y llevar otro) en un solo paso. |
| M-62 | Reportes | Media | Margen por categoría y por proveedor. |
| M-63 | Reportes | Media | Comparar dos periodos (este mes contra el anterior) en la misma pantalla. |
| M-64 | Reportes | Media | Ventas por hora del día por día de la semana (mapa de calor) para turnos. |
| M-65 | Inicio | Media | Meta de venta del día con avance. |
| M-66 | Inicio | Media | Aviso cuando una caja lleva abierta más de lo configurado, en vivo (hoy lo hace el worker de noche). |
| M-67 | Seguridad | Media | Cerrar las sesiones abiertas de una persona al desactivarla (signOut global con la llave de servicio). |
| M-68 | Seguridad | Media | Límite de intentos del ingreso también en el servidor por RUT (hoy en la pestaña y el de Supabase por IP). |
| M-69 | Seguridad | Media | Revisar cada mes en Supabase el "Security Advisor" y dejarlo en el HANDOFF. |
| M-70 | Usuarios | Media | Horario permitido por persona (no entrar fuera del turno). |
| M-71 | Ingreso | Media | En el celular, un enlace discreto "Entrar con correo" para el administrador cuando no está en el computador. |
| M-72 | Recuperar contraseña | Media | Para cuentas con RUT (sin correo real), explicar en pantalla que la clave la restablece el administrador. |
| M-73 | Configuración | Media | Validar en vivo el formato del giro y la dirección del emisor contra lo que exige el SII. |
| M-74 | Respaldo | Media | Restaurar desde "Descargar mis datos" (hoy solo se descarga). |
| M-75 | Facturación | Media | Reintento automático de una factura que el portal del SII rechazó por caída, con aviso si sigue fallando. |
| M-76 | Facturación | Media | Libro de ventas y compras del mes en el formato que pide el contador. |
| M-77 | Tienda | Media | Horario de atención y "cerrado ahora" en la cabecera. |
| M-78 | Tienda | Media | Pedido con retiro en local guardado en el sistema (hoy solo por WhatsApp). |
| M-79 | Base de datos | Media | Índice por (tenant_id, sold_at) en sales y por (tenant_id, created_at) en inventory_movements, para reportes de meses largos. |
| M-80 | Base de datos | Media | Vista materializada de ventas por día que se refresca de noche (los reportes de un año leen menos). |
| M-81 | Base de datos | Media | Una prueba que recorra todas las funciones security definer y exija cuenta activa (para que no vuelva a faltar en una nueva). |
| M-82 | Servidor · /api | Media | Un solo `clienteAdmin()` en lib/supabase/admin (facturacion/pdf todavía arma el suyo). |
| M-83 | Servidor · límites | Media | Límite de solicitudes compartido entre instancias (hoy vive en la memoria de cada proceso). |
| M-84 | Worker | Media | Alertas de stock bajo y vencimientos sin consulta por producto (hoy una por fila: N+1). |
| M-85 | Worker | Media | Registrar en job_runs cuántos correos salieron y cuántos fallaron. |
| M-86 | Rendimiento | Media | Partir el catálogo del celular por cambios (deltas) también para códigos de barra y stock, no solo productos. |
| M-87 | Accesibilidad | Media | Revisar contraste de los textos suaves (--texto-suave) sobre fondo gris con un medidor (WCAG AA). |
| M-88 | PWA | Media | Aviso "Hay una versión nueva: actualizar" que no interrumpa una venta en curso. |
| M-89 | Pruebas | Media | Prueba de la ruta /api/usuarios/clave y /api/usuarios/crear contra un Supabase local (hoy solo typecheck). |
| M-90 | Pruebas | Media | Aislar el error #418 del Inicio del supervisor con React sin minificar en la maqueta. (pendiente de la tabla de errores) |
| M-91 | Pruebas | Media | Recorrido del ingreso con fallos y recarga (la espera ahora sobrevive a F5). |
| M-92 | Operación | Media | Monitoreo de errores del navegador (/api/errores) con alerta cuando pasan de N por hora. |
| M-93 | Operación | Media | Página de estado simple (base, worker, SII) para que el local sepa si el problema es suyo. |
| M-94 | Documentación | Media | Guía de una página para el primer día (abrir caja, vender, cerrar) impresa en el mostrador. |
| M-95 | Bitácora | Media | Filtro por persona y exportar a Excel. |
| M-96 | Avisos | Media | Marcar todos los avisos como leídos y silenciar un tipo por una semana. |
| M-97 | Caja | Media | Sugerir un retiro a caja fuerte cuando el efectivo esperado pasa de un monto configurable. |
| M-98 | Recibir mercadería | Media | Proponer el precio de venta nuevo según un margen objetivo cuando el costo sube. |
| M-99 | Vender | Baja | Sonido corto al escanear (bien / no encontrado), configurable. |
| M-100 | Vender | Baja | Mostrar el stock que queda al agregar un producto con pocas unidades. |
| M-101 | Comprobante | Baja | Reimprimir el último comprobante desde Vender (hoy se hace buscando la venta en Ventas). |
| M-102 | Descuentos | Baja | Motivos de descuento predefinidos (vencimiento cercano, cliente frecuente, envase dañado) para los reportes. |
| M-103 | Caja | Baja | Imprimir el cierre de caja (resumen por medio de pago y diferencia) para archivarlo. |
| M-104 | Caja | Baja | Sugerir el monto inicial con lo que quedó en el cierre anterior. |
| M-105 | Inventario | Baja | Exportar el kardex de un producto a Excel. |
| M-106 | Vencimientos | Baja | Mostrar en Vender que el lote que sale vence pronto. |
| M-107 | Productos | Baja | Gráfico del historial de precios en la ficha del producto (hoy es una lista). |
| M-108 | Productos | Baja | Foto desde la cámara del celular al crear el producto, recortada a cuadrado. |
| M-109 | Productos | Baja | Unificar dos productos duplicados (mover códigos, stock y kardex a uno). |
| M-110 | Etiquetas | Baja | Plantillas de etiqueta para impresora térmica de 58 mm además de la hoja A4. |
| M-111 | Combos | Baja | Marcar "vencido" en la lista los combos cuya fecha de término ya pasó. |
| M-112 | Ofertas | Baja | Vista de calendario de las promociones con fechas. |
| M-113 | Carga masiva | Baja | Vista previa de lo que cambiará en los productos que ya existen (precio antes → después). |
| M-114 | Recibir mercadería | Baja | Fotografiar la factura y adjuntarla a la recepción. |
| M-115 | Qué comprar | Baja | Mandar el pedido al proveedor por WhatsApp con su número guardado. |
| M-116 | Proveedores | Baja | Días de visita del proveedor y recordatorio el día antes. |
| M-117 | Por pagar | Baja | Exportar lo por pagar del mes para el contador. |
| M-118 | Ventas | Baja | Filtro por medio de pago. |
| M-119 | Reportes | Baja | Programar el envío de un reporte por correo cada semana. |
| M-120 | Reportes | Baja | Exportar a .xlsx además de CSV (hoy Excel abre el CSV, pero sin formatos). |
| M-121 | Inicio | Baja | Productos más vendidos hoy. |
| M-122 | Seguridad | Baja | Avisar al administrador por correo cuando se restablece una contraseña o se cambia un rol. |
| M-123 | Usuarios | Baja | Foto o inicial de color por persona para reconocerla rápido en Caja y Ventas. |
| M-124 | Mi cuenta | Baja | Ver los últimos ingresos propios (fecha y equipo). |
| M-125 | Ingreso | Baja | Recordar el último rol del turno por equipo (la caja siempre "Vendo"). |
| M-126 | Configuración | Baja | Exportar e importar la configuración del local (para abrir una segunda sucursal igual). |
| M-127 | Facturación | Baja | Plantillas de cliente frecuente para facturar en dos toques. |
| M-128 | Tienda | Baja | Validar las cantidades del carrito guardado (enteras, ≤ 99) también al leerlo del navegador. |
| M-129 | Tienda | Baja | Categorías destacadas configurables en la portada. |
| M-130 | Tienda | Baja | Imagen para compartir (Open Graph) de cada producto generada con su foto y precio. |
| M-131 | Base de datos | Baja | Largo máximo en los textos libres que quedan (motivos de anulación, devolución y ajuste). |
| M-132 | Base de datos | Baja | Particionar audit_log por año cuando pase el millón de filas. |
| M-133 | Servidor · /api | Baja | Validar los id (uuid) en la entrada de cada ruta antes de consultar. |
| M-134 | Worker | Baja | Advertir al arrancar en producción si falta WORKER_SHARED_SECRET (hoy cierra los endpoints sin decirlo). |
| M-135 | Rendimiento | Baja | Cargar Reportes por pestaña (hoy trae varias consultas al entrar). |
| M-136 | Rendimiento | Baja | Medir con Lighthouse cada versión y dejar el número en Novedades. |
| M-137 | Accesibilidad | Baja | Anunciar al lector de pantalla el total del carrito cuando cambia (aria-live). |
| M-138 | Accesibilidad | Baja | Tamaño de letra grande opcional en Mi cuenta para el mostrador. |
| M-139 | PWA | Baja | Instalar como app desde un botón en Mi cuenta (hoy depende del menú del navegador). |
| M-140 | Pruebas | Baja | Prueba del resumen diario del worker con un Supabase local y dos zonas horarias. |
| M-141 | Operación | Baja | Rotar las claves de Supabase y del SII cada seis meses, con el paso a paso en el HANDOFF. |
| M-142 | Documentación | Baja | Videos cortos (30 s) por tarea en Ayuda. |
| M-143 | Documentación | Baja | Regenerar docs/24 (matriz) con las pruebas nuevas de esta revisión. |
| M-144 | Ayuda | Baja | Buscador dentro de Ayuda. |
| M-145 | Novedades | Baja | Marcar como leída la novedad y mostrar un punto mientras no se lea. |
| M-146 | Clientes | Baja | Importar clientes desde una planilla (RUT, razón social, giro). |
| M-147 | Clientes | Baja | Historial de compras del cliente en su ficha. |
| M-148 | Bitácora | Baja | Mostrar "antes → después" en los cambios de precio y de configuración. |
| M-149 | Avisos | Baja | Aviso en el celular (notificación push) para cajas sin cerrar y stock en cero de lo más vendido. |
| M-150 | Inventario | Baja | Ubicación dentro de la bodega (pasillo y estante) para encontrar y contar más rápido. |

## Lo que no cubre esta revisión

- Las rutas `/api` que usan la llave de servicio se revisaron leyendo el código y con typecheck;
  no hay un Supabase local con Auth para probarlas de punta a punta.
- La emisión real ante el SII (worker con Chromium) no se ejecutó.
- El error #418 no se pudo repetir a voluntad: salió 1 vez en 184 pantallas, siempre en el Inicio
  del supervisor a 360 px.
- La tienda se revisó en sus filtros, carrito y la ruta de productos; no se midió de nuevo su
  velocidad (docs/31 tiene las mediciones vigentes).
