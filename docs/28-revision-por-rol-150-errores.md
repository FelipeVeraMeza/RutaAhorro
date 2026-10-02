# 28 — Revisión por rol: 150 errores más (ronda 7, del 101 al 250)

**Fecha:** 2026-10-02 · **Versión:** 0.6.3 · **Pedido:** "Necesito que me
encuentres 150 errores o bugs y los arregles […] y cuando termines lo subes a
GitHub".

Se siguió la numeración de [docs/26](26-revision-por-rol-50-errores.md) y
[docs/27](27-revision-por-rol-50-errores-mas.md). Esta vez se fue a lo que
nadie había mirado con más de 1.000 filas (la API de Supabase corta ahí sin
avisar), a vender sin internet de verdad (wifi sin internet, token vencido,
Supabase caído), a las funciones de la base que la pantalla protegía y la base
no, y a pantallas que las rondas anteriores no recorrieron: Por pagar, Combos,
Ofertas, Importar, Ingreso/Recuperar/Clave, Bloqueo, Inicio, Facturación
(manual, recibidas, emisor), Bitácora, Fiado, el worker y la maqueta.

## Cómo leer la tabla

Igual que docs/26 y 27. *Alta*: plata, stock o documentos que quedan mal, una
puerta de seguridad abierta, o el usuario no puede terminar lo que hace.
*Media*: información engañosa o un paso que confunde. *Baja*: formato, texto o
un caso raro. "typecheck (sin prueba propia)" quiere decir que se corrigió y
compila, pero **no hay una prueba que lo demuestre por sí misma** (🟡, regla de
docs/17). Las de la base dicen si tienen prueba escrita en
`tools/pg-test/revision-0037.test.mjs` — **que no se pudo correr en esta
sesión** (ver Verificación).

| N° | Lo ve | Gravedad | Qué pasaba | Estado | Verificado con |
|---:|---|---|---|---|---|
| 101 | Vendedor | Alta | Cola sin conexión: una venta que quedaba en "enviando" (pestaña cerrada o batería agotada a mitad del envío) salía de la cola para siempre: ni se reenviaba ni contaba en "ventas sin enviar". | Corregido | typecheck (sin prueba propia) |
| 102 | Vendedor | Alta | Cola sin conexión: un error de red (wifi sin internet, `navigator.onLine` en true) dejaba la venta "rechazada por la base"; ahora vuelve a pendiente y se corta la pasada. | Corregido | typecheck (sin prueba propia) |
| 103 | Vendedor | Alta | Vender: con otra sincronización en curso, `syncQueue` volvía al tiro y el POS entregaba el comprobante de una venta que la base todavía podía rechazar (regla 19). | Corregido | typecheck (sin prueba propia) |
| 104 | Vendedor | Media | Vender: cuando la red fallaba al registrar, la venta quedaba en la cola sin la marca `sinConexion` y al sincronizar la base podía rechazarla por stock aunque ya estaba entregada. | Corregido | typecheck (sin prueba propia) |
| 105 | Vendedor | Alta | Cola sin conexión: sin red y con el token vencido (pasa a la hora), la venta se encolaba sin dueño y la enviaba el siguiente cajero que entrara: quedaba en SU caja. | Corregido | typecheck (sin prueba propia) |
| 106 | Vendedor | Media | Cola sin conexión: un token vencido (401) o Supabase caído (5xx) dejaban la venta "rechazada por la base" y el POS le decía al cajero que no existía. | Corregido | typecheck (sin prueba propia) |
| 107 | Vendedor | Baja | Barra de conexión: si "enviar ahora" fallaba (sin red para bajar el código, IndexedDB), quedaba en "enviando…" y deshabilitada hasta recargar. | Corregido | typecheck (sin prueba propia) |
| 108 | Vendedor | Media | Comprobante: era un diálogo hecho a mano; Escape cerraba el detalle de atrás y el foco no quedaba adentro (regla 10). Ahora usa `<Modal>`. | Corregido | typecheck (sin prueba propia) |
| 109 | Vendedor | Media | Pedir autorización de descuento: Enter repetido mandaba dos intentos de PIN (y sumaba dos fallos al bloqueo). | Corregido | typecheck (sin prueba propia) |
| 110 | Vendedor | Baja | Pedir autorización: con un solo autorizador lo dejaba elegido aunque su tope no alcanzara para el descuento pedido. | Corregido | typecheck (sin prueba propia) |
| 111 | Vendedor | Media | Carrito: un descuento mayor que el subtotal de su línea se restaba de las otras líneas; el total no cuadraba con lo que la base calcula (PAGO_NO_CUADRA). | Corregido | core (vitest): cart.test.ts |
| 112 | Jefe | Baja | Utilidad estimada del carrito: comparaba el precio con IVA (y con IABA/ILA) contra el costo neto, y la inflaba. | Corregido | core (vitest): cart.test.ts |
| 113 | Bodega | Media | Cantidades: "1.000" (punto de miles) se leía 1. | Corregido | core (vitest): validar-monto.test.ts |
| 114 | Bodega | Baja | Cantidades: se aceptaban "1e3", "0x10" e "Infinity". | Corregido | core (vitest): validar-monto.test.ts |
| 115 | QA | Baja | `npm test` y `npm run typecheck` fallaban en un clon nuevo: el worker y la web necesitan `packages/core/dist` y nadie lo construía antes. | Corregido | npm test en clon limpio |
| 116 | Jefe | Alta | Reportes: ventas por día, por producto y por vendedor, inventario valorizado, sin movimiento y mermas se cortaban en 1.000 filas sin aviso (la API de Supabase no devuelve más). | Corregido | typecheck (sin prueba propia) |
| 117 | Jefe | Media | Ventas → detalle: los errores de las cuatro consultas (líneas, pagos, documentos, devoluciones) se ignoraban y el detalle salía vacío como si la venta no tuviera nada. | Corregido | typecheck (sin prueba propia) |
| 118 | Bodega | Media | Toma de inventario con la sesión vencida: TypeError y "Ocurrió un problema inesperado" en vez de "vuelve a ingresar". | Corregido | typecheck (sin prueba propia) |
| 119 | Bodega | Baja | Crear producto con la sesión vencida: TypeError ("problema inesperado"). | Corregido | typecheck (sin prueba propia) |
| 120 | Jefe | Baja | Crear proveedor con la sesión vencida: TypeError ("problema inesperado"). | Corregido | typecheck (sin prueba propia) |
| 121 | Vendedor | Media | Resumen de cierre impreso: no traía ventas en efectivo, ingresos ni egresos; no había cómo rehacer la cuenta del "debería haber". | Corregido | typecheck (sin prueba propia) |
| 122 | Vendedor | Baja | Resumen de cierre: el redondeo del efectivo parecía sumarse aparte; ahora dice "(ya en ventas)". | Corregido | typecheck (sin prueba propia) |
| 123 | Jefe | Media | Cerrar la caja de otro: el "Debería haber" no aparecía nunca (la vista guarda `expected_amount` recién al cerrar); ahora se calcula con `fn_cash_session_summary`. | Corregido | typecheck (sin prueba propia) |
| 124 | Jefe | Media | Ventas → copia del comprobante: el descuento salía dos veces (`discount_total` ya incluye el de las líneas). | Corregido | typecheck (sin prueba propia) |
| 125 | Jefe | Media | Ventas → copia del comprobante: el neto incluía el IABA/ILA y no salía la línea del impuesto adicional. | Corregido | typecheck (sin prueba propia) |
| 126 | QA (maqueta) | Baja | Maqueta: una venta con descuento mostraba descuento $0 y subtotal igual al total. | Corregido | typecheck (sin prueba propia) |
| 127 | Jefe | Media | Ventas: el error al anular salía en la pantalla de atrás, tapado por el detalle; parecía que "Anular" no hacía nada. | Corregido | typecheck (sin prueba propia) |
| 128 | Jefe | Media | Ventas: una venta anulada se podía reimprimir como comprobante válido, sin decir que estaba anulada. | Corregido | typecheck (sin prueba propia) |
| 129 | Jefe | Baja | Documento tributario impreso: el impuesto adicional salía sin nombre (ILA de vinos y de cervezas iguales). | Corregido | typecheck (sin prueba propia) |
| 130 | Bodega | Media | Inventario: una merma con una cantidad mayor a la del sistema SUMABA stock. | Corregido | typecheck (sin prueba propia) |
| 131 | Bodega | Baja | Inventario: un error de carga quedaba pegado arriba aunque la siguiente carga funcionara. | Corregido | typecheck (sin prueba propia) |
| 132 | Bodega | Media | Toma de inventario: en la revisión, lo contado bajo otro filtro salía como "Producto · sistema 0" con la diferencia mal. | Corregido | typecheck (sin prueba propia) |
| 133 | Bodega | Baja | Kardex: el saldo salía sin formato (decimales flotantes). | Corregido | typecheck (sin prueba propia) |
| 134 | Bodega | Baja | Toma de inventario: la diferencia salía con punto decimal y decimales flotantes. | Corregido | typecheck (sin prueba propia) |
| 135 | Jefe | Media | Producto nuevo: si fallaban las ofertas o el impuesto después de crearlo, "Crear" otra vez duplicaba el producto (y la categoría nueva). | Corregido | typecheck (sin prueba propia) |
| 136 | Bodega | Baja | Producto: el stock mínimo aceptaba decimales (desde 0032 todo se cuenta por unidad). | Corregido | typecheck (sin prueba propia) |
| 137 | Bodega | Baja | Producto: "Cancelar" quedaba activo mientras se guardaba. | Corregido | typecheck (sin prueba propia) |
| 138 | Jefe/Bodega | Alta | Productos, Inventario y Etiquetas: la lista se cortaba en 200 productos sin aviso; el Valor al costo, la toma y la hoja de conteo salían incompletos. | Corregido | typecheck (sin prueba propia) |
| 139 | Bodega | Media | Productos: el filtro "Agotado" buscaba solo entre los 200 primeros. | Corregido | typecheck (sin prueba propia) |
| 140 | Jefe | Media | Combos, Ofertas masivas, Qué comprar y Configuración pedían 5.000 productos y la API entrega 1.000. | Corregido | typecheck (sin prueba propia) |
| 141 | Bodega | Media | Etiquetas: el código interno "siguiente" se calculaba sobre 200 productos y chocaba con uno usado. | Corregido | typecheck (sin prueba propia) |
| 142 | Jefe | Media | Qué comprar: el último proveedor de cada producto salía de 1.000 líneas de recepción sin orden. | Corregido | typecheck (sin prueba propia) |
| 143 | Jefe | Media | Respaldo (Configuración): faltaban fiado, por pagar, devoluciones a proveedor, autorizaciones de descuento, emisor y folios. | Corregido | typecheck (sin prueba propia) |
| 144 | Jefe | Media | Respaldo (Configuración): las páginas sin orden estable repetían o perdían filas. | Corregido | typecheck (sin prueba propia) |
| 145 | Bodega | Baja | Etiquetas: el error de carga quedaba pegado. | Corregido | typecheck (sin prueba propia) |
| 146 | Jefe | Baja | Usuarios y Compras: el error de carga quedaba pegado aunque la siguiente carga funcionara. | Corregido | typecheck (sin prueba propia) |
| 147 | Bodega | Media | Devolver a proveedor: sin red, las listas quedaban vacías sin ningún aviso. | Corregido | typecheck (sin prueba propia) |
| 148 | Jefe | Alta | Worker, respaldo diario: la lista de tablas era la de 0006: sin boletas, facturas, clientes, fiado, devoluciones ni por pagar. | Corregido | typecheck worker (sin prueba propia) |
| 149 | Jefe | Media | Worker, respaldo diario: páginas sin orden (filas repetidas o faltantes). | Corregido | typecheck worker (sin prueba propia) |
| 150 | Jefe | Media | Worker, resumen diario: el día se calculaba con -03:00 fijo y una zona escrita a mano (regla 17). | Corregido | typecheck worker (sin prueba propia) |
| 151 | Jefe | Media | Worker, resumen diario: el total no restaba las devoluciones. | Corregido | typecheck worker (sin prueba propia) |
| 152 | Jefe | Media | Worker, resumen diario: el total se cortaba en 1.000 ventas. | Corregido | typecheck worker (sin prueba propia) |
| 153 | Jefe | Media | Worker, resumen diario: una caja olvidada desde ayer no aparecía (solo las abiertas hoy). | Corregido | typecheck worker (sin prueba propia) |
| 154 | QA | Alta | Worker: sin WORKER_SHARED_SECRET, en producción cualquiera podía disparar respaldos, correos o la cola del SII con un POST. | Corregido | typecheck worker (sin prueba propia) |
| 155 | Jefe | Baja | Worker, correo: los nombres sin escapar rompían el HTML del resumen. | Corregido | typecheck worker (sin prueba propia) |
| 156 | Vendedor | Media | Fiado en el cobro: se leían todas las cuentas (tope 1.000) para buscar una; un cliente fuera de las 1.000 no podía fiar. | Corregido | typecheck (sin prueba propia) |
| 157 | Jefe/Vendedor | Media | Clientes: la lista se cortaba en 1.000 (en la pantalla y en el POS). | Corregido | typecheck (sin prueba propia) |
| 158 | Vendedor | Alta | Catálogo del celular: los códigos de barra se cortaban en 1.000: el resto no se escaneaba. | Corregido | typecheck (sin prueba propia) |
| 159 | Vendedor | Alta | Catálogo del celular: el stock se cortaba en 1.000: un producto con stock figuraba en 0 y no se podía cobrar. | Corregido | typecheck (sin prueba propia) |
| 160 | Vendedor | Media | Catálogo del celular: las ofertas se cortaban en 1.000: se cobraba sin oferta. | Corregido | typecheck (sin prueba propia) |
| 161 | Vendedor | Media | Catálogo del celular: los lotes se cortaban en 1.000: no avisaba lo vencido. | Corregido | typecheck (sin prueba propia) |
| 162 | Vendedor | Alta | Catálogo del celular: páginas ordenadas solo por `updated_at`; tras una carga masiva (miles con la misma hora) había productos que no bajaban nunca. | Corregido | typecheck (sin prueba propia) |
| 163 | Vendedor | Media | Catálogo del celular: la marca incremental era la hora del celular; con el reloj adelantado se perdían cambios. | Corregido | typecheck (sin prueba propia) |
| 164 | Jefe | Baja | Configuración → impuestos: "N productos" y el impuesto de cada producto se cortaban en 1.000. | Corregido | typecheck (sin prueba propia) |
| 165 | Jefe | Media | Ofertas de varios productos: "ya tiene oferta" se leía de solo 1.000 tramos. | Corregido | typecheck (sin prueba propia) |
| 166 | Jefe | Alta | Por pagar: con más de 1.000 facturas, las pendientes más nuevas desaparecían de la lista y del aviso del Inicio. | Corregido | typecheck (sin prueba propia) |
| 167 | Jefe | Media | Inicio → avisos: los que escribe el worker salían como "lot_expiring" o "cash_session_open" (el código en inglés). | Corregido | typecheck (sin prueba propia) |
| 168 | Jefe | Alta | Seguridad (base): `handle_new_user` le creía al metadata del registro: con el registro público de Supabase, cualquiera que conociera el id del local se creaba una cuenta de ADMINISTRADOR. Ahora el local y el rol salen de `cuentas_autorizadas`, que solo escribe el servidor. | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 169 | Vendedor | Alta | Seguridad (base): `fn_register_sale` aceptaba pagos negativos (efectivo 2.000 + débito −1.000 en una venta de 1.000). | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 170 | Jefe | Media | Base: `fn_register_sale` aceptaba ventas con fecha futura (reloj adelantado): caían en otro día del Inicio, Reportes y la caja. | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 171 | Jefe | Media | Seguridad (base): bodega podía abrir caja por la API (`fn_open_cash_session`). | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 172 | Jefe | Media | Seguridad (base): bodega podía registrar ventas por la API (`fn_register_sale` no miraba el rol). | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 173 | Jefe | Media | Seguridad (base): una cuenta desactivada con la sesión abierta seguía registrando ingresos/egresos y cerrando caja. | Corregido | db:check (sin prueba corrida) |
| 174 | Jefe | Media | Seguridad (base): una cuenta desactivada seguía anulando ventas (`fn_void_sale`). | Corregido | db:check (sin prueba corrida) |
| 175 | Jefe | Media | Seguridad (base): una cuenta desactivada seguía ajustando stock y aplicando tomas. | Corregido | db:check (sin prueba corrida) |
| 176 | Jefe | Media | Seguridad (base): una cuenta desactivada seguía recibiendo, anulando recepciones y dando de baja lotes. | Corregido | db:check (sin prueba corrida) |
| 177 | Vendedor | Baja | Base: `fn_close_cash_session` aceptaba un contado negativo. | Corregido | db:check (sin prueba corrida) |
| 178 | Jefe | Baja | Base: anular una venta en efectivo de una caja ya cerrada devolvía plata del cajón de hoy sin dejar el egreso (pagos mixtos y ventas anteriores a 0019). | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 179 | Bodega | Media | Base: `fn_adjust_stock` aceptaba dejar el stock en negativo o con decimales en productos por unidad. | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 180 | Bodega | Media | Base: `fn_adjust_stock` aceptaba una "merma" que sumaba stock. | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 181 | Jefe | Baja | Base: un ajuste se guardaba como "positivo" aunque restara (el tipo no seguía al signo). | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 182 | Bodega | Media | Base: `fn_apply_stock_count` aceptaba conteos negativos o con decimales. | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 183 | Bodega | Media | Base: `fn_apply_stock_count` aceptaba productos de otro local. | Corregido | db:check (sin prueba corrida) |
| 184 | Bodega | Media | Base: `fn_confirm_receipt` aceptaba cantidad 0 o negativa y costos negativos. | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 185 | Bodega | Media | Base: `fn_confirm_receipt` aceptaba un proveedor de otro local. | Corregido | db:check (sin prueba corrida) |
| 186 | Bodega | Media | Base: recibir un lote que vence HOY se rechazaba de noche ("ya vencido"): se comparaba con la fecha UTC (regla 17). | Corregido | db:check (sin prueba corrida) |
| 187 | Bodega | Media | Base: `v_expiring_lots` decía "vencido" de noche lo que vence hoy, con días −1 (fecha UTC, regla 17). | Corregido | db:check (sin prueba corrida) |
| 188 | Jefe | Baja | Base: Por pagar aceptaba una factura emitida en el futuro. | Corregido | db:check (sin prueba corrida) |
| 189 | Jefe | Baja | Base: Por pagar aceptaba la factura de una recepción ya anulada. | Corregido | db:check (sin prueba corrida) |
| 190 | Jefe | Baja | Usuarios → invitar: el correo no se normalizaba ni validaba (mayúsculas, espacios). | Corregido | typecheck (sin prueba propia) |
| 191 | Jefe | Baja | Configuración → impuesto: un código SII con decimales se redondeaba a otro código. | Corregido | typecheck (sin prueba propia) |
| 192 | Jefe | Baja | Usuarios → invitar: el motivo que daba el servidor se perdía ("problema inesperado"). | Corregido | typecheck (sin prueba propia) |
| 193 | Jefe | Media | Facturación: "Reintentar" una factura que el robot alcanzó a firmar la emitía otra vez sin advertir. | Corregido | typecheck (sin prueba propia) |
| 194 | Jefe | Baja | Facturación: un error al reintentar reemplazaba la lista entera de facturas. | Corregido | typecheck (sin prueba propia) |
| 195 | Jefe | Alta | Importar (actualizar): una planilla sin columna costo dejaba el costo de cada producto en $0. | Corregido | core (vitest): import.test.ts |
| 196 | Bodega | Alta | Importar (actualizar): sin las columnas perecible, categoría, mínimo, descripción o SKU se borraban esos datos (los perecibles quedaban sin FEFO). | Corregido | core (vitest): import.test.ts |
| 197 | Bodega | Media | Importar: aceptaba precio $0 (producto regalado). | Corregido | core (vitest): import.test.ts |
| 198 | Bodega | Baja | Importar: precio o costo con coma decimal se redondeaban sin aviso. | Corregido | core (vitest): import.test.ts |
| 199 | Bodega | Baja | Importar: aceptaba stock mínimo negativo o con decimales. | Corregido | core (vitest): import.test.ts |
| 200 | Bodega | Baja | Importar: el error al cargar decía otra fila (contaba solo las válidas). | Corregido | typecheck (sin prueba propia) |
| 201 | Jefe | Alta | Sesión vencida: las llamadas a /api se redirigían a /login; `fetch` recibía la página con 200 y la pantalla daba por hecho lo que no se hizo ("Cuenta creada", claves del SII guardadas). | Corregido | typecheck (sin prueba propia) |
| 202 | Bodega | Baja | Recibir mercadería: un N° de factura con punto de miles ("12.345") no quedaba en el libro de compras. | Corregido | typecheck (sin prueba propia) |
| 203 | Bodega | Media | Compras: supervisor y bodega editaban o desactivaban un proveedor, la base no guardaba nada (RLS) y la pantalla decía "guardado". Ahora solo el administrador ve "Editar" y el repositorio lo comprueba. | Corregido | typecheck (sin prueba propia) |
| 204 | Jefe | Media | Combos: no se podía desactivar un combo si un producto bajó de precio o se desactivó ("tiene que costar menos"), y seguía aplicándose. | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 205 | Jefe | Baja | Ofertas a varios productos: la confirmación mostraba las fechas como 2026-10-05. | Corregido | typecheck (sin prueba propia) |
| 206 | Bodega | Baja | Importar: corregir la planilla y volver a elegir el mismo archivo no hacía nada (el campo no cambiaba). | Corregido | typecheck (sin prueba propia) |
| 207 | Jefe | Baja | Importar: la vista previa mostraba costo $0 en planillas sin columna costo (se conserva el de hoy). | Corregido | typecheck (sin prueba propia) |
| 208 | Bodega | Baja | Importar: con todas las filas fallidas decía "Carga completada 🎉". | Corregido | typecheck (sin prueba propia) |
| 209 | Vendedor | Media | Ingreso: sin internet decía "Correo o contraseña incorrectos" y además contaba como intento fallido (espera de castigo con la clave bien escrita). | Corregido | typecheck (sin prueba propia) |
| 210 | Vendedor | Media | Recuperar contraseña: sin internet (o con el límite de envíos) decía "Revisa tu correo" sin haber mandado nada. | Corregido | typecheck (sin prueba propia) |
| 211 | Vendedor | Baja | Recuperar contraseña: sin internet al guardar decía "Pide un enlace nuevo" (el enlace seguía sirviendo). | Corregido | typecheck (sin prueba propia) |
| 212 | Vendedor | Baja | Contraseña temporal: si no se podía quitar la marca decía "guardada" y la volvía a pedir, en bucle. | Corregido | typecheck (sin prueba propia) |
| 213 | Vendedor | Media | Pantalla bloqueada: con wifi sin internet decía "Contraseña incorrecta" (y sumaba espera) en vez de revisar contra la huella del celular. | Corregido | typecheck (sin prueba propia) |
| 214 | Jefe | Alta | Seguridad (base): intentos de PIN simultáneos se saltaban el bloqueo de 5 fallos: un PIN de 4 dígitos se adivinaba desde el celular de un vendedor. Ahora se toma la fila del PIN (`for update`). | Corregido | db:check (sin prueba corrida) |
| 215 | Vendedor | Media | Cuenta desactivada: la pantalla no tenía "Salir" y el celular compartido quedaba tomado (/login devuelve a "/" a quien tiene sesión). | Corregido | typecheck (sin prueba propia) |
| 216 | Jefe | Media | Factura manual: cambiar el RUT después de elegir un cliente dejaba su razón social, giro y dirección: factura con el RUT de uno y el nombre de otro. | Corregido | typecheck (sin prueba propia) |
| 217 | Jefe | Baja | Factura manual → agregar del catálogo: un error de búsqueda quedaba pegado. | Corregido | typecheck (sin prueba propia) |
| 218 | Jefe | Media | Facturas recibidas: cambiar el RUT después de elegir un proveedor dejaba su razón social (libro de compras y proveedor nuevo con datos cruzados). | Corregido | typecheck (sin prueba propia) |
| 219 | Jefe | Baja | Facturas recibidas: el IVA propuesto usaba 19 % escrito a mano, no el de Configuración. | Corregido | typecheck (sin prueba propia) |
| 220 | Jefe | Baja | Emisor SII: "Borrar credenciales" borraba al primer toque, sin confirmar, y apagaba la emisión. | Corregido | typecheck (sin prueba propia) |
| 221 | Jefe | Media | Eliminar producto: si la base no lo dejaba borrar (está en un combo o una factura) quedaba vivo y sin sus códigos de barra. | Corregido | typecheck (sin prueba propia) |
| 222 | Jefe | Baja | Borrar algo en uso: "Ocurrió un problema inesperado" en vez de decir que solo se puede desactivar. | Corregido | core (vitest): validaciones.test.ts |
| 223 | Bodega | Media | Proveedores: se podía crear el mismo proveedor (mismo RUT) dos veces; sus facturas por pagar y sus compras quedaban partidas. | Corregido | typecheck (sin prueba propia) |
| 224 | Jefe | Baja | Qué comprar: si el celular no dejaba copiar, la pantalla entera se cambiaba por el error y se perdía el pedido armado. | Corregido | typecheck (sin prueba propia) |
| 225 | Jefe | Baja | Seguridad (base): `fn_cash_session_summary` (security definer) dejaba a cualquier cuenta del local leer lo vendido y lo esperado en la caja de otro cajero. | Corregido | db:check · pg-test revision-0037.test.mjs (escrita, sin correr) |
| 226 | QA | Baja | Worker: los avisos de stock bajo, vencimientos y cajas abiertas ignoraban el error de la consulta y quedaban "ok, 0 avisos". | Corregido | typecheck worker (sin prueba propia) |
| 227 | Bodega | Baja | Worker, revisión semanal: el aviso de lotes descuadrados se repetía cada domingo y no decía qué producto. | Corregido | typecheck worker (sin prueba propia) |
| 228 | Jefe | Media | Worker, limpieza de respaldos: BACKUP_RETENTION_DAYS=0 (o negativo) borraba todos los respaldos, también el de esa madrugada. | Corregido | typecheck worker (sin prueba propia) |
| 229 | Jefe | Baja | Ventas: buscar el folio "1.234" daba "problema inesperado"; con letras se ignoraba el filtro sin aviso. | Corregido | typecheck (sin prueba propia) |
| 230 | QA (maqueta) | Baja | Maqueta: ajustes y tomas aceptaban stock negativo y mermas que suman (la base no, desde 0037). | Corregido | typecheck (sin prueba propia) |
| 231 | Vendedor | Media | Configuración del local: si la primera lectura fallaba (abrir el POS sin red) quedaban los valores de omisión toda la sesión: sin redondeo del efectivo y con otra zona horaria. Ahora usa la última leída y reintenta. | Corregido | typecheck (sin prueba propia) |
| 232 | Jefe | Baja | Bitácora: con error de red decía además "Nada registrado en estas fechas"; con fechas invertidas no avisaba. | Corregido | typecheck (sin prueba propia) |
| 233 | Jefe | Baja | Base: una cuenta nueva nacía con tope de descuento 100/10/0 aunque el local tuviera otro configurado por rol. | Corregido | db:check (sin prueba corrida) |
| 234 | Jefe | Baja | Seguridad: crear o invitar un usuario que fallaba (correo ya registrado) dejaba viva la autorización de ese correo para el local y el rol. | Corregido | typecheck (sin prueba propia) |
| 235 | Bodega | Media | Inventario → Lotes: la fecha de vencimiento salía un día antes (AAAA-MM-DD leído como medianoche UTC, regla 17). | Corregido | typecheck (sin prueba propia) |
| 236 | Jefe | Baja | Inicio → vencimientos "Ver todos": abría Inventario en Stock y no en Lotes. | Corregido | typecheck (sin prueba propia) |
| 237 | Bodega | Media | Productos, Inventario y Etiquetas: una búsqueda anterior (más lenta) llegaba después de la nueva y pisaba la lista. | Corregido | typecheck (sin prueba propia) |
| 238 | Jefe | Baja | Ventas: al escribir un folio o mover las fechas, una consulta anterior dejaba la lista y el resumen de otro filtro. | Corregido | typecheck (sin prueba propia) |
| 239 | Jefe | Media | Reportes: con dos cambios de fecha seguidos el reporte podía mostrar el período anterior. | Corregido | typecheck (sin prueba propia) |
| 240 | Vendedor | Media | Catálogo del celular: un producto eliminado seguía en el POS (se encontraba por nombre y se cobraba; la base rechazaba la venta) hasta una bajada completa. | Corregido | typecheck (sin prueba propia) |
| 241 | Bodega | Media | Devolver a proveedor y Recibir mercadería: un producto escaneado con nombre común ("Pan") podía no agregarse (se buscaba por nombre entre 12) y la cámara se cerraba sin decir nada. | Corregido | typecheck (sin prueba propia) |
| 242 | QA | Baja | Seguridad: el buzón de errores (/api/errores, sin sesión) leía el cuerpo entero a memoria antes de recortarlo. | Corregido | typecheck (sin prueba propia) |
| 243 | QA (maqueta) | Baja | Maqueta: la caja aceptaba apertura, movimiento o contado negativos. | Corregido | typecheck (sin prueba propia) |
| 244 | QA (maqueta) | Baja | Maqueta: Por pagar aceptaba facturas emitidas en el futuro. | Corregido | typecheck (sin prueba propia) |
| 245 | Jefe | Baja | Configuración: "1,5" horas de aviso de caja se guardaba como 2 sin decirlo. | Corregido | typecheck (sin prueba propia) |
| 246 | QA | Baja | Worker: si no se podía anotar el inicio en `job_runs`, el trabajo no quedaba registrado ni con su error. | Corregido | typecheck worker (sin prueba propia) |
| 247 | Jefe | Baja | Fiado → movimientos: con más de 100 se cortaba sin aviso y lo visible no sumaba el saldo. | Corregido | typecheck (sin prueba propia) |
| 248 | Bodega | Media | Recibir mercadería: la fecha de la recepción venía del reloj del celular (adelantado: recepción y libro de compras con fecha de mañana). La pantalla ya no la manda y la base no acepta una futura. | Corregido | db:check (sin prueba corrida) |
| 249 | Jefe | Baja | Compras: la pestaña decía "Recepciones (30)" para siempre aunque hubiera más. | Corregido | typecheck (sin prueba propia) |
| 250 | Jefe | Baja | Ventas → "Ver más": pasadas las 1.000 ventas del período el botón desaparecía y las más antiguas no se podían ver. | Corregido | typecheck (sin prueba propia) |

## Resumen

| | Cantidad |
|---|:-:|
| Alta | 18 |
| Media | 71 |
| Baja | 61 |
| Corregidos | 150 |
| Con prueba propia corrida (✅, core) | 111, 112, 113, 114, 195, 196, 197, 198, 199, 222 |
| Con prueba de base escrita, **sin correr** (🟡) | 168, 169, 170, 171, 172, 178, 179, 180, 181, 182, 184, 204, 225 |
| Solo `db:check` (compila, 🟡) | 173, 174, 175, 176, 177, 183, 185, 186, 187, 188, 189, 214, 233, 248 |

## Lo más grave, en una línea cada uno

- **N° 168 · Cualquiera podía hacerse administrador de un local.**
  `handle_new_user` armaba el perfil con el `tenant_id` y el `role` del
  metadata del registro, que escribe cualquiera con la llave pública
  (registro público de Supabase, encendido por omisión). El id del local viaja
  en el token de cualquier vendedor. 0037 crea `cuentas_autorizadas` (sin
  políticas, solo la llave de servicio) y el disparador lee de ahí.
- **N° 169 · Pagos negativos en una venta** sacaban plata del
  arqueo sin que nadie la cobrara.
- **N° 214 · El PIN de autorización se podía adivinar** mandando los
  intentos a la vez (la cuenta de "5 malos" no estaba bajo candado).
- **N° 158–162 · El celular de la caja bajaba solo 1.000 de cada
  cosa** (códigos, stock, ofertas, lotes) y las páginas de productos podían
  saltarse algunos para siempre: con un catálogo grande, productos que no se
  escanean o que figuran sin stock.
- **N° 105 · Una venta sin red con el token vencido quedaba sin dueño**
  y la enviaba el siguiente cajero: la plata en una caja, la venta en otra.
- **N° 195–196 · Importar para actualizar borraba datos:** sin
  columna costo, el costo quedaba en $0; sin perecible, los perecibles
  perdían el FEFO.
- **N° 201 · Con la sesión vencida, la pantalla decía "Cuenta creada"**
  (y "claves guardadas") sin que nada se hubiera hecho.
- **N° 148 · El respaldo diario no traía boletas, facturas, clientes ni
  fiado** (lista de tablas de 0006).

## Migración nueva: 0037 (sin aplicar en Supabase)

`supabase/migrations/0037_revision_150_errores.sql`. Todas las funciones con
**la misma firma** que su última versión (regla 21: no crea sobrecargas); se
generó copiando la última definición de cada una y aplicando cambios mínimos,
así que el resto del cuerpo es idéntico.

- Tabla `cuentas_autorizadas` (correo en minúsculas, local, tienda, rol,
  nombre). RLS encendido, sin políticas, `revoke all` para `anon` y
  `authenticated`. La escriben `/api/usuarios/crear`, `/api/usuarios/invitar`,
  `tools/crear-admin.mjs` y `tools/crear-cuentas.mjs` **antes** de crear el
  usuario; si la creación falla desde Usuarios, la autorización se retira.
- `handle_new_user`: sin autorización no hay perfil (la persona entra y ve
  "Tu cuenta no está vinculada a ningún local"). El tope de descuento sale de
  `tenants.settings.max_discount_pct` del rol.
- `fn_register_sale`, `fn_open_cash_session`, `fn_add_cash_movement`,
  `fn_close_cash_session`, `fn_void_sale`, `fn_adjust_stock`,
  `fn_apply_stock_count`, `fn_confirm_receipt`, `fn_void_receipt`,
  `fn_write_off_lot`, `fn_registrar_factura_proveedor`, `fn_guardar_combo`,
  `fn_autorizar_descuento`, `fn_cash_session_summary`: las guardias de la
  tabla de arriba (rol, cuenta activa, montos y cantidades, fechas del local,
  candado del PIN).
- `v_expiring_lots`: mismas columnas (regla 22), con el día del local.

**Antes de aplicarla:**
1. Aplicar antes 0029 a 0036 (ver HANDOFF).
2. Desde que está aplicada, **una cuenta creada a mano en el panel de
   Supabase (o invitada desde ahí) no queda vinculada**: hay que crearla desde
   Usuarios o con `tools/crear-cuentas.mjs`. Es el punto.
3. Correr `npm run db:test` (con un usuario que no sea root) y ver pasar
   `revision-0037.test.mjs`; y, por regla 16, verla fallar sin 0037.
4. `db:aplicar` sigue esperando **46 funciones** (0037 no agrega RPC nuevas).

## Encontrados después del 250 (sin corregir)

- **Recuperar contraseña no quita la marca de contraseña temporal.** Quien
  tenía una temporal y la cambia por el correo de recuperación vuelve a
  /clave al entrar. Arreglo propuesto: que /recuperar llame a
  `/api/cuenta/clave` en vez de `updateUser` directo.
- **Worker, revisión semanal:** un perecible con stock pero sin ningún lote
  activo no aparece en `v_stock_by_lot`, así que el descuadre no se detecta.
- **Resumen diario y avisos del worker:** `v_low_stock` y `v_expiring_lots`
  se leen sin paginar (más de 1.000 productos bajo mínimo es raro, pero la
  API cortaría igual).
- Los dos de la maqueta anotados en docs/27 siguen igual.

## Verificación

- `packages/core`: **460 pruebas, 0 fallas** (vitest), con las nuevas de
  `cart`, `validar-monto`, `import` y `validaciones`.
- `apps/web`: `tsc --noEmit` sin errores; `next build` de producción
  (`NEXT_PUBLIC_DEMO=false`) termina bien.
- `apps/worker`: `tsc --noEmit` sin errores; `npm test` 0 fallas (6 omitidas,
  necesitan Supabase).
- `npm run db:check`: **175 cuerpos PL/pgSQL compilan** (0037 incluida).
- **`npm run db:test` no se pudo correr:** en este contenedor PostgreSQL
  embebido corre como root e `initdb` lo rechaza. Las pruebas de 0037 están
  escritas pero **no se vieron pasar ni fallar** (🟡). Es lo primero que hay
  que hacer antes de aplicar la migración.
- No se corrieron los recorridos de la maqueta (`tools/ui`) en esta sesión.
