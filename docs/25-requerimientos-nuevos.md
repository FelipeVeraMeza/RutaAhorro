# 25 — Cincuenta requerimientos que faltaban

**Fecha:** 2026-09-30 · **Versión del sistema:** 0.4.0 · **Origen:** revisión de la
aplicación desde tres miradas —el dueño (admin), QA y el vendedor— después de
las rondas 1 y 2.

Estos 50 requerimientos (40 funcionales y 10 no funcionales) **no estaban** en
[03](03-requerimientos-funcionales.md) ni en [04](04-requerimientos-no-funcionales.md).
Salen de lo que se observó usando el sistema como lo usaría cada rol: tareas
que se hacían a mano, errores de tecleo que nada detenía, información que la
base ya tenía y ninguna pantalla mostraba, y huecos técnicos que las pruebas
anteriores no medían.

Cada uno tiene: el enunciado, **por qué falta** (el problema real que resuelve),
**criterios de aceptación** verificables, prioridad MoSCoW y su **estado con
evidencia**. Se agregaron también, en una línea, a 03 y 04, para que la
[matriz](24-matriz-requerimientos.md) los siga como a los demás.

## Resumen

| Estado | Cantidad |
|---|:-:|
| ✅ Hecho y verificado por una prueba o recorrido | 41 |
| 🟡 Hecho en parte, o hecho sin prueba que lo demuestre | 6 |
| ⬜ Pendiente (necesita cambios en la base) | 3 |
| **Total** | **50** |

Los pendientes lo están por una razón concreta: requieren **migraciones** en
Supabase (tablas nuevas o cambios en `fn_register_sale`), y en esta ronda no se
aplican migraciones sin revisar el esquema en vivo. Quedan especificados para
hacerlos en la próxima ronda con base de datos.

### Cómo se verifica

- `npm test -w @rutaahorro/core` — las reglas (redondeo, montos y cantidades
  sospechosas, arqueo, calidad del catálogo, reposición, ABC, ventas por hora)
  en `packages/core/test/operacion.test.ts`.
- `node tools/ui/demo-ronda3.mjs` — recorrido en el navegador que cita cada ID
  (45 comprobaciones, 4 roles).
- `node tools/ui/demo-roles.mjs` — 4 roles × 2 anchos × 22 pantallas: sin
  errores, sin desbordes y sin controles sin nombre (RNF-61).
- `node tools/peso-js.mjs` — peso real del JS por pantalla (RNF-62).

## Índice

| ID | Requerimiento | Prioridad | Estado |
|---|---|:-:|:-:|
| RF-M1-16 | Aviso de Bloq Mayús | Should | ✅ |
| RF-M1-17 | Pausa tras intentos fallidos | Should | ✅ |
| RF-M1-18 | Recordar el correo | Could | ✅ |
| RF-M1-19 | Bloqueo por inactividad | Should | ✅ |
| RF-M1-20 | Contraseña temporal sin cambiar | Should | ✅ |
| RF-M2-16 | Ordenar la lista de productos | Should | ✅ |
| RF-M2-17 | Cambio rápido de precio | Must | ✅ |
| RF-M2-18 | Revisar datos incompletos | Should | ✅ |
| RF-M2-19 | Exportar el catálogo | Should | ✅ |
| RF-M2-20 | Buscar sin tildes | Must | ✅ |
| RF-M2-21 | Aviso de precio sin redondear | Could | ✅ |
| RF-M2-22 | Cartel de precio de góndola | Should | ✅ |
| RF-M3-12 | Pedido por proveedor | Should | ✅ |
| RF-M3-13 | Cuentas por pagar a proveedores | Should | ⬜ |
| RF-M4-21 | Qué reponer en la sala | Must | ✅ |
| RF-M4-22 | Hoja para contar | Should | ✅ |
| RF-M4-23 | Oferta para lo que vence | Should | ✅ |
| RF-M4-24 | Merma del mes | Should | 🟡 |
| RF-M5-23 | Reimprimir comprobante | Must | ✅ |
| RF-M5-24 | Deshacer lo último | Should | ✅ |
| RF-M5-25 | Frecuentes a un toque | Should | ✅ |
| RF-M5-26 | Monto recibido sospechoso | Should | ✅ |
| RF-M5-27 | Cantidad sospechosa | Should | ✅ |
| RF-M5-28 | Redondeo del efectivo (Ley 20.956) | Must | 🟡 |
| RF-M5-29 | Frescura de los precios | Should | ✅ |
| RF-M5-30 | Venta fiada | Could | ⬜ |
| RF-M6-13 | Arqueo por billete | Should | ✅ |
| RF-M6-14 | Resumen del cierre | Should | 🟡 |
| RF-M6-15 | Caja abierta de otro día | Should | 🟡 |
| RF-M7-13 | Ventas por hora | Should | ✅ |
| RF-M7-14 | Clasificación ABC | Should | ✅ |
| RF-M7-15 | Control de anulaciones | Must | ✅ |
| RF-M7-16 | Ventas línea por línea | Should | ✅ |
| RF-M7-17 | Resumen del día por WhatsApp | Could | ✅ |
| RF-M8-07 | Panel "Para revisar" | Should | ✅ |
| RF-M8-08 | Cajas olvidadas | Should | 🟡 |
| RF-M9-11 | Leer la bitácora | Must | ✅ |
| RF-M9-12 | Ayuda por rol | Should | ✅ |
| RF-M9-13 | Pie del comprobante | Could | ⬜ |
| RF-M9-14 | Mi cuenta | Should | ✅ |
| RNF-57 | Cada pantalla dice para qué sirve: título con una bajada de una frase,… | Must | ✅ |
| RNF-58 | Ningún diálogo ni botón queda tapado por la barra inferior del celular… | Must | ✅ |
| RNF-59 | El sistema debe ofrecer letra grande (≈ 19 px de base) por celular, ap… | Must | ✅ |
| RNF-60 | La aplicación debe responder con Strict-Transport-Security (1 año) y C… | Must | ✅ |
| RNF-61 | Todo botón, enlace y campo debe tener un nombre accesible (texto, etiq… | Must | ✅ |
| RNF-62 | El JavaScript de la primera carga de cada pantalla, sumando página y l… | Must | 🟡 |
| RNF-63 | Una venta a medio armar no debe perderse al recargar la página, cerrar… | Must | ✅ |
| RNF-64 | Con letra grande y en un ancho de 320 px (equivalente a 200 % de zoom)… | Must | ✅ |
| RNF-65 | Todas las horas se muestran en formato de 24 horas (09:15, 18:40), igu… | Must | ✅ |
| RNF-66 | Cuando se publica una versión nueva, una pestaña abierta desde antes d… | Must | ✅ |

---

## Requerimientos funcionales

### M1 · Autenticación y cuentas

#### RF-M1-16 · Aviso de Bloq Mayús

**Enunciado.** Al escribir una contraseña (ingreso), el sistema debe avisar si las mayúsculas están activadas.

**Por qué falta.** Es la causa más común de "contraseña incorrecta" en un mostrador, y hacía perder tiempo y bloquear cuentas por intentos.

**Criterios de aceptación.**
- Con Bloq Mayús activo aparece "Las mayúsculas están activadas" bajo el campo.
- El aviso está asociado al campo (aria-describedby) para lectores de pantalla.
- Desaparece al desactivar Bloq Mayús.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M1-17 · Pausa tras intentos fallidos

**Enunciado.** Tras 5 intentos de ingreso fallidos seguidos, el sistema debe exigir una espera creciente (30 s, 60 s… hasta 5 min) antes de permitir otro intento.

**Por qué falta.** Sin límite visible, alguien podía probar contraseñas desde el celular del local sin ninguna fricción (Supabase limita por IP, pero el usuario no lo veía).

**Criterios de aceptación.**
- Al 5.º fallo el botón muestra "Espera N s" y queda deshabilitado.
- La espera se duplica en cada fallo adicional, con un tope de 5 minutos.
- El mensaje nunca revela si el correo existe.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M1-18 · Recordar el correo

**Enunciado.** El sistema debe ofrecer recordar el correo de quien ingresa en ese celular (activado por omisión, se puede desmarcar).

**Por qué falta.** Cada cambio de turno obligaba a escribir el correo completo en el teclado del celular.

**Criterios de aceptación.**
- Tras un ingreso exitoso con la casilla marcada, /login vuelve con el correo puesto.
- Si se desmarca, el correo se borra del celular y no se vuelve a guardar.
- Nunca se guarda la contraseña.

**Prioridad:** Could · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M1-19 · Bloqueo por inactividad

**Enunciado.** El sistema debe poder bloquear la pantalla tras N minutos sin uso (configurable por celular: nunca, 2, 5, 10, 15 o 30), pidiendo la contraseña de quien la estaba usando para seguir.

**Por qué falta.** El celular queda sobre el mostrador con la sesión abierta: cualquiera podía anular una venta o ver reportes a nombre de otro.

**Criterios de aceptación.**
- Pasado el tiempo configurado aparece "Pantalla bloqueada" y tapa todo.
- Recargar la página no quita el bloqueo.
- Con otra contraseña no se desbloquea; con la correcta sí, y la venta en curso sigue ahí.
- "Es otra persona: salir" cierra la sesión (avisando si hay ventas sin enviar).
- Sin internet se puede desbloquear si ese celular ya verificó la contraseña antes (huella PBKDF2, nunca la contraseña).

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M1-20 · Contraseña temporal sin cambiar

**Enunciado.** En Usuarios, el administrador debe ver qué cuentas siguen con la contraseña temporal que él entregó.

**Por qué falta.** El administrador no sabía si el empleado ya había entrado y puesto su propia clave; una clave temporal conocida por dos personas es una clave compartida.

**Criterios de aceptación.**
- La cuenta creada o restablecida por el administrador muestra la insignia "Contraseña temporal sin cambiar".
- La marca desaparece cuando la persona la cambia.
- El dato se lee en el servidor (/api/usuarios/estado), solo para el administrador y solo cuentas de su local.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs (en demo; en producción depende de SUPABASE_SECRET_KEY)

### M2 · Catálogo

#### RF-M2-16 · Ordenar la lista de productos

**Enunciado.** La lista de productos debe poder ordenarse por nombre, precio, stock y últimos modificados.

**Por qué falta.** Con cientos de productos, encontrar "lo más caro" o "lo que se cambió hoy" era imposible sin exportar.

**Criterios de aceptación.**
- Un selector "Ordenar" con las opciones; el orden se aplica al instante.
- El orden no rompe los filtros ni la búsqueda.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M2-17 · Cambio rápido de precio

**Enunciado.** Quien puede editar precios debe poder cambiar el precio de un producto tocándolo en la lista, sin abrir el formulario completo, con aviso si el cambio es de 30 % o más.

**Por qué falta.** Cambiar precios es la tarea más frecuente del catálogo y el formulario completo la hacía lenta y propensa a tocar otros campos.

**Criterios de aceptación.**
- Tocar el precio abre "Precio de <producto>" con el valor actual.
- Un cambio de ±30 % o más pide confirmar.
- Pasa por la misma validación y bitácora que la edición normal.

**Prioridad:** Must · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M2-18 · Revisar datos incompletos

**Enunciado.** Productos debe decir cuántos productos tienen datos incompletos (sin código, sin costo, sin mínimo, sin categoría, precio que no termina en 0) y permitir filtrarlos.

**Por qué falta.** Un producto sin código no se escanea, sin costo no da margen y sin mínimo nunca avisa reposición: el sistema "funcionaba" pero daba números malos.

**Criterios de aceptación.**
- Botón "Revisar datos (N)" o "✓ Datos completos".
- Cada producto muestra qué le falta.
- Quien no ve costos no recibe el aviso de costo.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** packages/core/test/operacion.test.ts · tools/ui/demo-ronda3.mjs

#### RF-M2-19 · Exportar el catálogo

**Enunciado.** El catálogo debe poder exportarse a un archivo que abre Excel (CSV), con lo que la pantalla muestra. No disponible para vendedor.

**Por qué falta.** El dueño revisa precios con el contador o el proveedor en planilla; solo existía importar.

**Criterios de aceptación.**
- "Exportar" descarga un CSV con nombre, código interno, códigos de barra, categoría, unidad, precio, stock (total, sala, bodega), mínimo y estado; el costo solo si quien exporta puede verlo.
- El vendedor no ve el botón.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M2-20 · Buscar sin tildes

**Enunciado.** La búsqueda de productos debe encontrar sin importar tildes ni mayúsculas ("azucar" encuentra "Azúcar").

**Por qué falta.** En el celular casi nadie escribe tildes; `ilike` las distingue y el producto "no existía".

**Criterios de aceptación.**
- "azucar" encuentra "Azúcar" en Productos, Vender y Consultar precio.
- Funciona sin internet contra el catálogo guardado.

**Prioridad:** Must · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M2-21 · Aviso de precio sin redondear

**Enunciado.** Al poner un precio que no termina en 0, el sistema debe advertir que en efectivo habrá que redondear (Ley 20.956).

**Por qué falta.** Sin monedas de $1 ni $5, un precio de $1.995 obliga al cajero a redondear a mano en cada venta en efectivo.

**Criterios de aceptación.**
- El formulario y el cambio rápido muestran el aviso; no se prohíbe (los productos por kilo pueden quedar en cualquier monto).

**Prioridad:** Could · **Estado:** ✅ · **Evidencia:** packages/core/test/operacion.test.ts

#### RF-M2-22 · Cartel de precio de góndola

**Enunciado.** Además de la etiqueta de código de barras, el sistema debe imprimir carteles de precio para la repisa (60 × 35 mm, precio grande, oferta si la hay).

**Por qué falta.** Los precios de la repisa se escribían a mano y quedaban distintos a los del sistema.

**Criterios de aceptación.**
- En Etiquetas se elige "Precio de góndola".
- El cartel muestra nombre, precio grande, unidad y la oferta vigente.
- Se imprime desde el navegador o se guarda en PDF.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

### M3 · Proveedores

#### RF-M3-12 · Pedido por proveedor

**Enunciado.** "Qué comprar" debe poder armarse para un proveedor: el de la última recepción de cada producto.

**Por qué falta.** El pedido sugerido mezclaba productos de todos los proveedores y había que separarlo a mano antes de mandarlo.

**Criterios de aceptación.**
- Selector "Pedido para" con cada proveedor y cuántos productos le tocan, más "Sin proveedor conocido".
- El WhatsApp y el Excel salen solo con ese proveedor.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M3-13 · Cuentas por pagar a proveedores

**Enunciado.** El sistema debe registrar las facturas de proveedores con su fecha de vencimiento y avisar las que vencen en los próximos 7 días, permitiendo marcarlas pagadas.

**Por qué falta.** El almacén compra a crédito (30 días); hoy los vencimientos se llevan en un cuaderno y se pagan tarde o dos veces.

**Criterios de aceptación.**
- Al confirmar una recepción con factura se puede indicar el vencimiento.
- Una lista de facturas por pagar, ordenada por vencimiento, con total adeudado por proveedor.
- Aviso en Inicio de lo que vence esta semana.

**Prioridad:** Should · **Estado:** ⬜ · **Evidencia:** Pendiente: necesita tabla y migración (no se aplican migraciones sin revisar el esquema en Supabase)

### M4 · Inventario

#### RF-M4-21 · Qué reponer en la sala

**Enunciado.** Inventario debe sugerir qué pasar de la bodega a la sala: lo vacío o bajo el mínimo en sala que tiene stock en bodega, hasta el doble del mínimo.

**Por qué falta.** El stock existía en bodega pero la repisa estaba vacía: venta perdida sin que el sistema lo notara.

**Criterios de aceptación.**
- Pestaña "Qué reponer (N)" con cantidad sugerida editable.
- Lo vacío aparece primero.
- "Pasar a la sala" mueve lo marcado en un paso.

**Prioridad:** Must · **Estado:** ✅ · **Evidencia:** packages/core/test/operacion.test.ts · tools/ui/demo-ronda3.mjs

#### RF-M4-22 · Hoja para contar

**Enunciado.** La toma de inventario debe poder imprimirse como hoja para contar a mano, con espacio para anotar.

**Por qué falta.** Contar con el celular en una mano y cajas en la otra no funciona en bodega.

**Criterios de aceptación.**
- "Imprimir hoja para contar" genera una tabla con producto, código y la columna "Contado" en blanco, para la ubicación elegida.
- La hoja no muestra el stock esperado (para no inducir el conteo).

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M4-23 · Oferta para lo que vence

**Enunciado.** Un lote por vencer debe poder ponerse en oferta con un toque desde Inventario (admin y supervisor).

**Por qué falta.** Lo que vence se botaba sin intentar venderlo antes; el camino a la oferta eran cuatro pantallas.

**Criterios de aceptación.**
- En Lotes, cada lote por vencer tiene "Poner en oferta" que abre el producto para editarlo.
- Bodega no ve el enlace.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M4-24 · Merma del mes

**Enunciado.** El Inicio del administrador debe mostrar cuánto se perdió este mes por merma y ajustes, con enlace al detalle.

**Por qué falta.** La merma solo se veía entrando a un reporte que nadie abría.

**Criterios de aceptación.**
- "Pérdidas por merma y ajustes este mes" con monto y cantidad de movimientos.
- Solo lo ve quien ve costos.

**Prioridad:** Should · **Estado:** 🟡 · **Evidencia:** Implementado en PanelControl; sin recorrido propio (los datos de ejemplo no traen ajustes del mes)

### M5 · Punto de venta

#### RF-M5-23 · Reimprimir comprobante

**Enunciado.** Una venta pasada debe poder reimprimirse o compartirse, marcada como COPIA.

**Por qué falta.** El cliente vuelve a pedir la boleta para un cambio o garantía y no había cómo darla.

**Criterios de aceptación.**
- En Ventas, el detalle ofrece "Reimprimir o compartir el comprobante".
- El papel dice COPIA y conserva fecha, cajero y medio de pago originales.

**Prioridad:** Must · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M5-24 · Deshacer lo último

**Enunciado.** Después de agregar o quitar un producto en Vender, el sistema debe ofrecer deshacerlo con un toque.

**Por qué falta.** Un escaneo doble o un toque equivocado obligaba a buscar la línea y restar a mano, con el cliente esperando.

**Criterios de aceptación.**
- El aviso "Agregado: X" trae "Deshacer" durante unos segundos.
- Deshacer deja el carrito exactamente como estaba.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M5-25 · Frecuentes a un toque

**Enunciado.** Con el buscador vacío, Vender debe mostrar los productos que más se venden en ese celular.

**Por qué falta.** El pan, las bebidas y los cigarros se venden sin código de barras y se buscaban por nombre cien veces al día.

**Criterios de aceptación.**
- Hasta 8 accesos "Frecuentes en este celular" con precio.
- Se aprende de las ventas hechas en el aparato; funciona sin internet.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M5-26 · Monto recibido sospechoso

**Enunciado.** Si el monto recibido en efectivo parece un error de tecleo (10 veces el total o más, o sobre $500.000), el sistema debe pedir confirmación antes de cobrar.

**Por qué falta.** Escribir 100.000 en vez de 10.000 descuadra la caja y da un vuelto imposible.

**Criterios de aceptación.**
- El botón pasa a "Sí, recibí $X" y exige un segundo toque.
- Pagar $1.990 con $20.000 no avisa (es normal).

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** packages/core/test/operacion.test.ts

#### RF-M5-27 · Cantidad sospechosa

**Enunciado.** Una cantidad de 100 unidades o más (50 kg o más) en una línea debe pedir confirmación.

**Por qué falta.** Un código de barras escaneado dentro del campo de cantidad ponía 7.802.215 unidades.

**Criterios de aceptación.**
- Se pregunta antes de aplicar; si se cancela, la cantidad anterior queda.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** packages/core/test/operacion.test.ts

#### RF-M5-28 · Redondeo del efectivo (Ley 20.956)

**Enunciado.** Cuando se paga todo en efectivo, el total a cobrar debe redondearse a la decena (1–5 baja, 6–9 sube) y el comprobante debe mostrar el ajuste.

**Por qué falta.** Es obligatorio desde 2017; hoy el sistema registra el monto exacto y el cajero redondea de cabeza, así la caja nunca cuadra por unos pesos.

**Criterios de aceptación.**
- La regla está en core con pruebas.
- Falta: registrar el ajuste en la venta (fn_register_sale y el cuadre de caja) y mostrarlo en el comprobante.

**Prioridad:** Must · **Estado:** 🟡 · **Evidencia:** packages/core/test/operacion.test.ts (la regla); el registro necesita migración

#### RF-M5-29 · Frescura de los precios

**Enunciado.** Vender debe decir de cuándo son los precios que muestra (última actualización del catálogo en ese celular) y advertir si pasó más de un día.

**Por qué falta.** Sin internet se vende con el catálogo guardado; el cajero no sabía si el precio era de hoy o de la semana pasada.

**Criterios de aceptación.**
- "Precios actualizados hace N min".
- Con más de 24 h se destaca y pide conectarse.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M5-30 · Venta fiada

**Enunciado.** El sistema debe permitir registrar una venta "fiada" a un cliente con ficha, llevar su saldo y registrar abonos.

**Por qué falta.** El fiado es habitual en almacenes de barrio y hoy se anota en un cuaderno que no cuadra con la caja.

**Criterios de aceptación.**
- Medio de pago "Fiado" solo con cliente identificado y tope de crédito.
- Ficha del cliente con saldo, compras y abonos.
- El fiado no entra al efectivo esperado de la caja.

**Prioridad:** Could · **Estado:** ⬜ · **Evidencia:** Pendiente: necesita tablas de cuenta corriente y cambio en fn_register_sale

### M6 · Caja

#### RF-M6-13 · Arqueo por billete

**Enunciado.** Al cerrar la caja se debe poder contar por billete y moneda ($20.000 a $10) y que el sistema sume.

**Por qué falta.** Sumar de cabeza el cajón al final del turno es la principal fuente de diferencias falsas.

**Criterios de aceptación.**
- "Contar por billete" muestra las 9 denominaciones vigentes.
- El total contado se calcula solo e ignora negativos y fracciones.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** packages/core/test/operacion.test.ts · tools/ui/demo-ronda3.mjs

#### RF-M6-14 · Resumen del cierre

**Enunciado.** Al cerrar la caja, el sistema debe mostrar un resumen imprimible (esperado, contado, diferencia, medios de pago, nota).

**Por qué falta.** El cajero se iba sin constancia de lo que entregó; si después faltaba plata, era su palabra.

**Criterios de aceptación.**
- Tras cerrar aparece el resumen con "Imprimir".
- Coincide con lo que quedó registrado en la base.

**Prioridad:** Should · **Estado:** 🟡 · **Evidencia:** Implementado; sin recorrido que cierre una caja de ejemplo

#### RF-M6-15 · Caja abierta de otro día

**Enunciado.** Si la caja propia quedó abierta de un día anterior, el sistema debe advertirlo y mostrar la fecha de apertura.

**Por qué falta.** Una caja olvidada abierta mezcla dos días de ventas en un solo cierre y el cuadre deja de tener sentido.

**Criterios de aceptación.**
- "Esta caja quedó abierta de otro día" con la fecha de apertura y qué hacer.

**Prioridad:** Should · **Estado:** 🟡 · **Evidencia:** Implementado; sin recorrido (la caja de ejemplo siempre es de hoy)

### M7 · Reportes

#### RF-M7-13 · Ventas por hora

**Enunciado.** Reportes debe mostrar cuánto se vende en cada hora del día, en la zona horaria del local.

**Por qué falta.** Para decidir turnos y cuándo reponer hay que saber las horas fuertes; no existía.

**Criterios de aceptación.**
- Pestaña "Por hora" con las 24 horas (las sin ventas en cero).
- Usa la hora de Chile, con cambio de horario.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** packages/core/test/operacion.test.ts · tools/ui/demo-ronda3.mjs

#### RF-M7-14 · Clasificación ABC

**Enunciado.** Reportes por producto debe clasificar en A (80 % de lo vendido), B (15 %) y C (5 %).

**Por qué falta.** Dice dónde nunca puede faltar stock (A) y qué se puede dejar de comprar (C).

**Criterios de aceptación.**
- Cada producto trae su insignia A/B/C y un resumen de cuántos hay en cada clase.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** packages/core/test/operacion.test.ts · tools/ui/demo-ronda3.mjs

#### RF-M7-15 · Control de anulaciones

**Enunciado.** Reportes debe mostrar las anulaciones y devoluciones del período por persona, con monto y motivo.

**Por qué falta.** Muchas anulaciones de la misma persona son la primera señal de un problema de caja.

**Criterios de aceptación.**
- Pestaña "Anulaciones" con totales por persona y el detalle.
- Se exporta a Excel.

**Prioridad:** Must · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M7-16 · Ventas línea por línea

**Enunciado.** Reportes debe exportar las ventas del período una fila por producto vendido (fecha, folio, producto, cantidad, precio, neto, IVA, medio de pago, cajero).

**Por qué falta.** Es lo que pide el contador; los reportes agregados no le sirven.

**Criterios de aceptación.**
- "Exportar ventas línea por línea (para el contador)" descarga el archivo del período elegido.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M7-17 · Resumen del día por WhatsApp

**Enunciado.** El Inicio debe permitir enviar el resumen del día (vendido, ventas, ticket, bajo mínimo, en riesgo) por WhatsApp.

**Por qué falta.** El dueño no siempre está en el local; hoy le mandan una foto de la pantalla.

**Criterios de aceptación.**
- "Enviar el resumen de hoy por WhatsApp" abre WhatsApp con el texto listo para elegir contacto.

**Prioridad:** Could · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

### M8 · Alertas

#### RF-M8-07 · Panel "Para revisar"

**Enunciado.** El Inicio debe juntar lo que requiere atención: avisos del sistema sin ver, cajas abiertas hace muchas horas y merma del mes, con acción para cada uno.

**Por qué falta.** Los avisos existían en la base (low_stock) y nadie los veía.

**Criterios de aceptación.**
- Sección "Para revisar" solo si hay algo.
- "Marcar como vistos" limpia los avisos.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M8-08 · Cajas olvidadas

**Enunciado.** El sistema debe avisar al administrador y al supervisor de las cajas que llevan abiertas más horas de las configuradas para el local, con quién y desde cuándo.

**Por qué falta.** Una caja abierta de ayer es plata sin cuadrar y una venta de hoy mezclada con la de ayer.

**Criterios de aceptación.**
- Aparece en "Para revisar" como "Cajas abiertas hace más de N h", con el nombre y la hora de apertura.
- N sale de la configuración del local (horas de aviso de caja).

**Prioridad:** Should · **Estado:** 🟡 · **Evidencia:** Implementado; sin recorrido (los datos de ejemplo no traen cajas viejas)

### M9 · Administración

#### RF-M9-11 · Leer la bitácora

**Enunciado.** El administrador debe poder leer y filtrar la bitácora: quién cambió precios, anuló ventas, ajustó stock o tocó cuentas.

**Por qué falta.** La bitácora se escribía desde el primer día (inmutable) pero no había pantalla para leerla.

**Criterios de aceptación.**
- Pantalla Bitácora (solo admin) con filtro por fecha y tipo de acción.
- Muestra persona, fecha, acción y el producto afectado.

**Prioridad:** Must · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M9-12 · Ayuda por rol

**Enunciado.** El sistema debe incluir guías cortas "¿cómo se hace?" para cada rol, con el botón que lleva a hacerlo.

**Por qué falta.** La capacitación era verbal y se perdía con cada empleado nuevo.

**Criterios de aceptación.**
- Pantalla Ayuda con guías de 1 a 5 pasos.
- Cada rol ve solo lo que puede hacer (el vendedor ve menos que el administrador).

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RF-M9-13 · Pie del comprobante

**Enunciado.** El administrador debe poder configurar el texto del pie del comprobante (despedida, política de cambios, redes).

**Por qué falta.** Cada local tiene su política de cambios y hoy no se puede imprimir.

**Criterios de aceptación.**
- Campo en Configuración con límite de caracteres.
- Aparece en el comprobante y en las copias.

**Prioridad:** Could · **Estado:** ⬜ · **Evidencia:** Pendiente: `tenants.settings` tiene lista blanca de claves en la base; agregar una requiere migración

#### RF-M9-14 · Mi cuenta

**Enunciado.** Cada persona debe tener una pantalla "Mi cuenta" con sus datos, cambio de contraseña y las preferencias de ese celular.

**Por qué falta.** Lo único personal era un ícono de llave; nadie sabía con qué rol ni qué descuento máximo tenía.

**Criterios de aceptación.**
- Nombre, correo, rol y descuento máximo.
- Enlace a cambiar contraseña.
- Tamaño de letra y bloqueo por inactividad del celular.

**Prioridad:** Should · **Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

---

## Requerimientos no funcionales

#### RNF-57

**Enunciado.** Cada pantalla dice para qué sirve: título con una bajada de una frase, y los botones dicen la acción con un verbo (nunca solo un ícono sin nombre).

**Por qué falta.** Los empleados nuevos no sabían qué hacía cada pantalla.

**Cómo se verifica.** Recorrido por rol: todas las pantallas tienen h1 y bajada

**Estado:** ✅ · **Evidencia:** tools/ui/demo-roles.mjs (ronda 2 y 3)

#### RNF-58

**Enunciado.** Ningún diálogo ni botón queda tapado por la barra inferior del celular ni por la cabecera.

**Por qué falta.** Los botones Guardar/Cancelar de los diálogos quedaban bajo la barra de navegación.

**Cómo se verifica.** Recorrido a 360 px con diálogos abiertos

**Estado:** ✅ · **Evidencia:** tools/ui/demo-flujo.mjs · demo-datos.mjs

#### RNF-59

**Enunciado.** El sistema debe ofrecer letra grande (≈ 19 px de base) por celular, aplicada antes de pintar la pantalla y conservada al recargar.

**Por qué falta.** Parte del personal ve poco o usa el celular apoyado lejos.

**Cómo se verifica.** Recorrido: activar en Mi cuenta y recargar

**Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RNF-60

**Enunciado.** La aplicación debe responder con Strict-Transport-Security (1 año) y Cross-Origin-Opener-Policy: same-origin, además de los encabezados ya exigidos.

**Por qué falta.** Sin HSTS, la primera visita por http:// puede ser interceptada en una red WiFi compartida.

**Cómo se verifica.** Recorrido: lee los encabezados de la respuesta

**Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RNF-61

**Enunciado.** Todo botón, enlace y campo debe tener un nombre accesible (texto, etiqueta o aria-label). Cero excepciones.

**Por qué falta.** La primera corrida encontró 228 controles sin nombre (búsquedas y filtros solo con placeholder).

**Cómo se verifica.** tools/ui/demo-roles.mjs: 4 roles × 2 anchos × 22 pantallas; falla si encuentra uno

**Estado:** ✅ · **Evidencia:** tools/ui/demo-roles.mjs (0 de 176 pantallas)

#### RNF-62

**Enunciado.** El JavaScript de la primera carga de cada pantalla, sumando página y layouts, comprimido, no debe superar 270 kB (límite) y debe tender a 250 kB (meta).

**Por qué falta.** La columna de `next build` no cuenta el layout de la app y subestimaba ~135 kB: el celular de gama baja pagaba más de lo que se creía.

**Cómo se verifica.** node tools/peso-js.mjs después de compilar

**Estado:** 🟡 · **Evidencia:** tools/peso-js.mjs: 26/26 bajo 270 kB; 10/26 en la meta de 250 kB

#### RNF-63

**Enunciado.** Una venta a medio armar no debe perderse al recargar la página, cerrar la pestaña por error o bloquearse la pantalla.

**Por qué falta.** Una recarga accidental con el cliente esperando obligaba a escanear todo de nuevo.

**Cómo se verifica.** Recorrido: agregar, recargar, sigue

**Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RNF-64

**Enunciado.** Con letra grande y en un ancho de 320 px (equivalente a 200 % de zoom), ninguna pantalla debe desbordarse horizontalmente.

**Por qué falta.** WCAG 1.4.10 (reflow). La primera corrida encontró Productos desbordado por el selector de orden.

**Cómo se verifica.** Recorrido a 320 px con letra grande

**Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RNF-65

**Enunciado.** Todas las horas se muestran en formato de 24 horas (09:15, 18:40), igual en servidor y navegador.

**Por qué falta.** El formato de 12 h con "a. m." causaba errores de hidratación y confusión en los cierres de caja nocturnos.

**Cómo se verifica.** Recorrido: sin "a. m."/"p. m."

**Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

#### RNF-66

**Enunciado.** Cuando se publica una versión nueva, una pestaña abierta desde antes debe ofrecer "Actualizar" en menos de 5 minutos (o al volver a la aplicación).

**Por qué falta.** El celular del mostrador pasa días con la misma pestaña; seguía con el código viejo.

**Cómo se verifica.** Recorrido: /api/version con otro commit

**Estado:** ✅ · **Evidencia:** tools/ui/demo-ronda3.mjs

---

## Lo que queda para la próxima ronda (con base de datos)

1. **RF-M5-28 · Redondeo del efectivo.** La regla ya está probada en core. Falta
   que `fn_register_sale` guarde el ajuste, que el cuadre de caja lo considere
   y que el comprobante lo muestre.
2. **RF-M3-13 · Cuentas por pagar.** Tabla de facturas de proveedor con
   vencimiento y estado de pago; aviso en Inicio.
3. **RF-M5-30 · Fiado.** Cuenta corriente por cliente, medio de pago "Fiado"
   con tope, abonos.
4. **RF-M9-13 · Pie del comprobante.** Agregar la clave a la lista blanca de
   `tenants.settings`.
5. **RNF-62 · Meta de 250 kB.** 16 pantallas están entre 250 y 265 kB. Lo que
   más pesa es el layout de la app (cliente de Supabase + IndexedDB para
   vender sin red): candidato a cargarse después de pintar.
6. Recorridos para **RF-M4-24**, **RF-M6-14**, **RF-M6-15** y **RF-M8-08** con datos de
   ejemplo que los provoquen (caja de ayer, cierre completo).
