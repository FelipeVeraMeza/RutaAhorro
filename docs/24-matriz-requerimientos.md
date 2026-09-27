# 24 — Matriz de requerimientos con evidencia

**Generado por `node tools/matriz.mjs` el 2026-09-27.** No se edita a mano:
se regenera. Cruza [03](03-requerimientos-funcionales.md) y [04](04-requerimientos-no-funcionales.md)
con el [inventario](17-inventario-alcance.md) y con las pruebas.

**Qué significa cada estado**

| | |
|:--:|---|
| ✅ | **Verificado**: al menos una prueba automática o un recorrido en el navegador lo cita, y en la última corrida pasó |
| ❌ | Una prueba que lo cita falla |
| ⚠️ | El inventario lo marca hecho, pero **ninguna prueba lo demuestra**. No se da por hecho (regla 20) |
| 🔵 🟡 ⬜ | Lo que dice el inventario, sin evidencia automática: en la base sin pantalla, parcial, no empezado |

## Resumen

| | ✅ | ❌ | ⚠️ | 🔵 | 🟡 | ⬜ | Total |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Funcionales | 62 | 0 | 39 | 4 | 12 | 17 | 134 |
| No funcionales | 4 | 0 | 0 | 0 | 0 | 52 | 56 |


## Módulo M1

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ✅ | RF-M1-01 | El sistema debe permitir iniciar sesión con correo electrónico y contraseña. | ✅ | recorrido m1 |
| ✅ | RF-M1-02 | Cada trabajador debe tener una **sesión independiente**; toda acción queda atribuida a su usuario. | ✅ | recorrido m1 |
| ✅ | RF-M1-03 | El administrador debe poder crear, editar y **desactivar** usuarios (nunca eliminar, para no romper el historial). | ✅ | recorrido m1 |
| ✅ | RF-M1-04 | El sistema debe asignar a cada usuario exactamente un rol: `admin`, `supervisor`, `vendedor` o `bodega`. | ✅ | recorrido m1 |
| ✅ | RF-M1-05 | El sistema debe permitir recuperar la contraseña mediante enlace enviado al correo. | ✅ | recorrido m1 |
| ✅ | RF-M1-06 | La sesión debe mantenerse activa entre visitas ("recordarme") para no reingresar la clave en cada turno. | ✅ | recorrido m1 |
| ⚠️ | RF-M1-07 | El sistema debe permitir cerrar sesión explícitamente, incluso con ventas pendientes de sincronizar (advirtiendo al usuario). | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M1-08 | Una contraseña debe tener mínimo 8 caracteres; el sistema debe rechazar contraseñas de uso común. | ✅ | recorrido m1 |
| ⬜ | RF-M1-09 | El administrador debe poder forzar el cierre de sesión de un usuario en todos sus dispositivos. | ⬜ |  |
| ⬜ | RF-M1-10 | El sistema debe soportar segundo factor (TOTP) para el rol `admin`. | ⬜ |  |
| 🟡 | RF-M1-11 | El sistema debe bloquear temporalmente la cuenta tras 5 intentos fallidos consecutivos. | 🟡 |  |
| ✅ | RF-M1-12 | El administrador debe poder **invitar a un empleado por correo**; el empleado define su propia contraseña desde el enlace recibido. El admin | ✅ | recorrido m1 |
| ✅ | RF-M1-13 | Un mismo usuario debe poder tener sesión abierta en **más de un dispositivo** a la vez (celular y computador). | ✅ | recorrido m1 |
| ✅ | RF-M1-14 | El administrador debe poder ver **qué usuarios están conectados** y cuándo fue su última actividad. | ✅ | recorrido m1 |
| ⬜ | RF-M1-15 | El sistema debe registrar cada inicio y cierre de sesión en la bitácora de auditoría. | ⬜ |  |

## Módulo M2

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ⚠️ | RF-M2-01 | El sistema debe permitir crear un producto con: nombre, categoría, precio de venta, costo, unidad de medida, stock mínimo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M2-02 | Un producto debe poder tener **uno o más códigos de barra** asociados (el mismo artículo puede venir con distinto código según lote o format | ✅ | codigos.test.ts |
| ⚠️ | RF-M2-03 | El sistema debe validar que un código de barras no esté asignado a dos productos distintos dentro del mismo local. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| 🟡 | RF-M2-04 | El sistema debe permitir crear un producto **escaneando su código**, precargando el código en el formulario. | 🟡 |  |
| ⚠️ | RF-M2-05 | El sistema debe permitir buscar productos por nombre, código de barras o código interno (SKU), con resultados incrementales mientras se escr | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M2-06 | El sistema debe permitir organizar productos en **categorías** (un nivel). | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⬜ | RF-M2-07 | El sistema debe permitir adjuntar una **imagen** al producto, tomada con la cámara. | ⬜ |  |
| ⚠️ | RF-M2-08 | El sistema debe permitir **desactivar** un producto sin borrarlo, conservando su historial. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| 🔵 | RF-M2-09 | El sistema debe registrar el **historial de cambios de precio** con fecha y usuario. | 🔵 |  |
| ⚠️ | RF-M2-10 | El sistema debe calcular y mostrar el **margen** (precio − costo) y el porcentaje de margen, visible solo para `admin`. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M2-11 | El sistema debe permitir **carga masiva** de productos desde archivo CSV/Excel con plantilla predefinida. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M2-12 | La carga masiva debe validar el archivo antes de aplicar y mostrar un informe de errores por fila, sin cargar parcialmente. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M2-13 | El sistema debe permitir generar e imprimir **etiquetas con código de barras** para productos sin código de fábrica. | ✅ | etiqueta.test.ts |
| 🟡 | RF-M2-14 | El sistema debe permitir definir productos vendidos por **peso o fracción** (unidad de medida decimal). | 🟡 |  |
| ⬜ | RF-M2-15 | El sistema debe permitir duplicar un producto para crear variantes rápidamente. | ⬜ |  |

## Módulo M3

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ⚠️ | RF-M3-01 | El sistema debe permitir registrar proveedores con: nombre/razón social, RUT, contacto, teléfono, correo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M3-02 | El sistema debe validar el formato y dígito verificador del **RUT** chileno. | ✅ | validaciones.test.ts |
| ⚠️ | RF-M3-03 | El sistema debe permitir asociar uno o más proveedores a un producto. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M3-04 | El sistema debe permitir registrar una **recepción de mercadería**: proveedor, documento, fecha, líneas con producto, cantidad y costo unita | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M3-05 | Al confirmar una recepción, el sistema debe **aumentar el stock** de cada producto y registrar el movimiento en el kardex. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M3-06 | Al confirmar una recepción, el sistema debe **recalcular el costo promedio ponderado** de cada producto recibido. | ✅ | concurrencia.test.mjs, cost.test.ts |
| ⬜ | RF-M3-07 | El sistema debe permitir cargar las líneas de una recepción **escaneando** cada producto. | ⬜ |  |
| ✅ | RF-M3-08 | El sistema debe advertir cuando el costo de recepción difiere en más de un % configurable respecto del costo anterior. | ✅ | cost.test.ts |
| ✅ | RF-M3-09 | El sistema debe permitir anular una recepción, revirtiendo stock y costo, dejando ambos movimientos en el kardex. | ✅ | concurrencia.test.mjs |
| ⬜ | RF-M3-10 | El sistema debe mostrar el historial de compras por proveedor y por producto. | ⬜ |  |
| ⬜ | RF-M3-11 | El sistema debe permitir generar una **orden de compra sugerida** con los productos bajo stock mínimo. | ⬜ |  |

## Módulo M4

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ✅ | RF-M4-01 | El sistema debe mantener el stock de cada producto **en tiempo real**, reflejando ventas, recepciones y ajustes. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M4-02 | Todo cambio de stock debe generar un registro inmutable en el **kardex**, con: fecha, producto, tipo de movimiento, cantidad, saldo resultan | ✅ | concurrencia.test.mjs |
| ⚠️ | RF-M4-03 | Los tipos de movimiento deben ser: `venta`, `anulacion_venta`, `recepcion`, `anulacion_recepcion`, `ajuste_positivo`, `ajuste_negativo`, `me | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M4-04 | El sistema debe permitir **ajustar el stock** indicando obligatoriamente un motivo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M4-05 | El sistema debe permitir realizar una **toma de inventario**: registrar el conteo físico y generar automáticamente el ajuste por la diferenc | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| 🟡 | RF-M4-06 | La toma de inventario debe poder hacerse por categoría o parcialmente, sin exigir contar todo el local de una vez. | 🟡 |  |
| ⚠️ | RF-M4-07 | El sistema debe permitir definir un **stock mínimo** por producto y marcar visualmente los productos bajo ese nivel. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M4-08 | El sistema debe mostrar el **inventario valorizado** (stock × costo promedio) total y por categoría. | ✅ | cost.test.ts |
| ✅ | RF-M4-09 | El sistema debe advertir al vender un producto con stock insuficiente, permitiendo continuar solo a `admin` y `supervisor`. | ✅ | recorrido m5 |
| 🔵 | RF-M4-10 | El sistema debe registrar la **merma** como un tipo de ajuste diferenciado, para poder reportarla por separado. | 🔵 |  |
| ✅ | RF-M4-11 | El kardex debe ser **inmutable**: no se puede editar ni eliminar un movimiento, solo emitir uno compensatorio. | ✅ | seguridad.test.mjs |
| 🟡 | RF-M4-12 | El sistema debe permitir consultar el kardex de un producto filtrando por rango de fechas y tipo de movimiento. | 🟡 |  |
| ✅ | RF-M4-13 | El sistema debe soportar stock por **ubicación/bodega** dentro del mismo local. | ✅ | recorrido m5 |
| ⚠️ | RF-M4-14 | El sistema debe permitir marcar un producto como **perecible** (`tracks_expiry`), habilitando el control por lote solo en esos productos. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M4-15 | Al recepcionar un producto perecible, el sistema debe **exigir la fecha de vencimiento** y rechazar lotes ya vencidos. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M4-16 | El sistema debe mantener el stock de productos perecibles **por lote**, con su fecha de vencimiento y costo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M4-17 | Al vender un producto perecible, el sistema debe descontar automáticamente del lote que **vence primero (FEFO)**, sin intervención del cajer | ✅ | expiry.test.ts |
| ✅ | RF-M4-18 | El sistema debe alertar los lotes **por vencer** (según días configurables por producto) y los **ya vencidos**, indicando el valor en riesgo | ✅ | expiry.test.ts |
| ✅ | RF-M4-19 | El sistema debe permitir dar de baja un lote vencido como **merma**, con motivo obligatorio. | ✅ | concurrencia.test.mjs |
| ⚠️ | RF-M4-20 | Al anular una venta, las unidades deben volver **al lote exacto** del que salieron. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |

## Módulo M5

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ⚠️ | RF-M5-01 | El sistema debe permitir agregar un producto al carrito **escaneando su código de barras con la cámara del celular**. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M5-02 | El escaneo debe funcionar de forma continua: escanear varios productos seguidos sin reabrir la cámara. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M5-03 | El sistema debe emitir **retroalimentación sonora y vibración** al reconocer un código. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| 🟡 | RF-M5-04 | Si el código escaneado no existe en el catálogo, el sistema debe ofrecer crear el producto en ese momento. | 🟡 |  |
| ✅ | RF-M5-05 | El sistema debe permitir agregar productos **buscando por nombre**, para artículos sin código. | ✅ | recorrido m5 |
| ✅ | RF-M5-06 | El sistema debe permitir modificar la cantidad de una línea del carrito y eliminar líneas. | ✅ | recorrido m5 |
| ✅ | RF-M5-07 | El sistema debe calcular el total en tiempo real, en pesos chilenos **sin decimales**. | ✅ | recorrido m5 |
| 🔵 | RF-M5-08 | El sistema debe permitir aplicar un **descuento** por línea o al total, en monto o porcentaje, según el permiso del rol. | 🔵 |  |
| ⚠️ | RF-M5-09 | El sistema debe permitir registrar el **medio de pago**: efectivo, débito, crédito, transferencia. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| 🔵 | RF-M5-10 | El sistema debe permitir **pago mixto** (más de un medio en la misma venta). | 🔵 |  |
| ✅ | RF-M5-11 | Para pagos en efectivo, el sistema debe calcular el **vuelto** a partir del monto recibido. | ✅ | recorrido m5 |
| ✅ | RF-M5-12 | Al confirmar la venta, el sistema debe descontar el stock, registrar el kardex y afectar la caja **en una sola transacción atómica**. | ✅ | recorrido m5 |
| ✅ | RF-M5-13 | El sistema debe asignar a cada venta un **folio correlativo** por local. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M5-14 | El sistema debe mostrar un comprobante en pantalla, compartible por WhatsApp o correo. | ⬜ | recorrido m5 |
| ✅ | RF-M5-15 | El sistema debe permitir **anular** una venta según los permisos del rol, revirtiendo stock y caja, dejando traza de ambos movimientos. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M5-16 | El sistema debe impedir vender si el usuario **no tiene caja abierta**. | ✅ | recorrido m5 |
| ✅ | RF-M5-17 | El POS debe **operar sin conexión a internet**: permitir registrar ventas y encolarlas localmente. | ✅ | recorrido m5 |
| ✅ | RF-M5-18 | Al recuperar la conexión, el sistema debe **sincronizar automáticamente** las ventas en cola, en orden, sin duplicar. | ✅ | recorrido m5 |
| ✅ | RF-M5-19 | El sistema debe mostrar de forma permanente y visible el **estado de conexión** y la cantidad de ventas pendientes de sincronizar. | ✅ | recorrido m5 |
| ✅ | RF-M5-20 | El sistema debe permitir dejar una venta **en espera** y retomarla (cliente que va a buscar otro producto). | ⬜ | recorrido documento |
| ✅ | RF-M5-21 | La pantalla del POS debe ser operable **con una sola mano** en un celular de 5 pulgadas. | 🟡 | recorrido documento |
| ✅ | RF-M5-22 | El sistema debe permitir ingresar un producto genérico "venta varia" con monto libre. | ⬜ | recorrido documento |

## Módulo M6

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ✅ | RF-M6-01 | El sistema debe exigir la **apertura de caja** declarando el monto inicial en efectivo. | ✅ | recorrido m5, recorrido m6 |
| ⚠️ | RF-M6-02 | Cada usuario debe tener **su propia sesión de caja**; dos usuarios pueden tener cajas abiertas en simultáneo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M6-03 | El sistema debe permitir registrar **movimientos de caja** distintos de ventas: ingresos y egresos, con motivo obligatorio. | ✅ | recorrido m6 |
| ✅ | RF-M6-04 | El sistema debe calcular el **efectivo esperado** = monto inicial + ventas en efectivo + ingresos − egresos. | ✅ | recorrido m6 |
| ✅ | RF-M6-05 | Al cerrar la caja, el sistema debe solicitar el **conteo físico** y mostrar la diferencia (sobrante o faltante). | ✅ | recorrido m6 |
| ✅ | RF-M6-06 | Si existe diferencia, el sistema debe exigir un comentario antes de permitir el cierre. | ✅ | recorrido m6, cash.test.ts |
| ✅ | RF-M6-07 | El cierre de caja debe generar un **resumen**: ventas por medio de pago, cantidad de transacciones, ticket promedio, diferencia. | ✅ | recorrido m6 |
| ✅ | RF-M6-08 | Una caja cerrada debe ser **inmutable**: no se pueden agregar ni modificar movimientos posteriores. | ✅ | recorrido m6 |
| ✅ | RF-M6-09 | El sistema debe impedir abrir una segunda caja al usuario que ya tiene una abierta. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M6-10 | El `admin` debe poder **forzar el cierre** de una caja olvidada, quedando registrado quién la cerró. | ✅ | recorrido m6 |
| ✅ | RF-M6-11 | El sistema debe alertar si una caja lleva más de X horas abierta (configurable). | 🟡 | cash.test.ts |
| ✅ | RF-M6-12 | El sistema debe permitir consultar el historial de cierres con sus diferencias. | ✅ | recorrido m6 |

## Módulo M7

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ⚠️ | RF-M7-01 | El sistema debe ofrecer un **dashboard** con: ventas de hoy, cantidad de transacciones, ticket promedio, productos bajo stock mínimo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M7-02 | El sistema debe ofrecer un reporte de **ventas por período** con filtro de fechas. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M7-03 | El sistema debe ofrecer ventas **por usuario**, para comparar desempeño y auditar. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M7-04 | El sistema debe ofrecer ventas **por producto y por categoría**, ordenables por unidades o por monto. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M7-05 | El sistema debe ofrecer el reporte de **inventario valorizado** al costo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M7-06 | El sistema debe ofrecer el reporte de **margen y utilidad bruta** por producto y período (solo `admin`). | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M7-07 | El sistema debe ofrecer el reporte de **productos sin movimiento** en N días (capital inmovilizado). | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M7-08 | El sistema debe ofrecer el reporte de **mermas y ajustes** por período y motivo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M7-09 | El sistema debe permitir **exportar cualquier reporte a Excel/CSV**. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⬜ | RF-M7-10 | El sistema debe mostrar un gráfico de evolución de ventas de los últimos 30 días. | ⬜ |  |
| ⬜ | RF-M7-11 | El sistema debe ofrecer comparación de ventas contra el mismo período anterior. | ⬜ |  |
| ⚠️ | RF-M7-12 | Los reportes deben respetar la matriz de permisos: un `vendedor` solo ve lo propio y nunca ve costos. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |

## Módulo M8

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ⚠️ | RF-M8-01 | El sistema debe alertar dentro de la aplicación cuando un producto queda bajo su stock mínimo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| 🟡 | RF-M8-02 | El sistema debe enviar un **resumen diario** por correo al administrador: ventas, diferencias de caja, productos bajo mínimo. | 🟡 |  |
| 🟡 | RF-M8-03 | El sistema debe alertar al administrador si al cierre del día quedó una caja sin cerrar. | 🟡 |  |
| ⬜ | RF-M8-04 | El sistema debe alertar al administrador ante una diferencia de arqueo mayor a un monto configurable. | ⬜ |  |
| ⬜ | RF-M8-05 | El sistema debe permitir configurar el correo destinatario y activar/desactivar cada tipo de alerta. | ⬜ |  |
| ⬜ | RF-M8-06 | El sistema debe soportar notificaciones push en el navegador. | ⬜ |  |

## Módulo M9

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| 🟡 | RF-M9-01 | El sistema debe realizar un **respaldo automático diario** de la base de datos. | 🟡 |  |
| 🟡 | RF-M9-02 | Los respaldos deben conservarse al menos **30 días**. | 🟡 |  |
| ⬜ | RF-M9-03 | El `admin` debe poder **descargar** un respaldo de sus datos en formato abierto (CSV/JSON). | ⬜ |  |
| ⬜ | RF-M9-04 | El procedimiento de **restauración** debe estar documentado y probado al menos una vez antes de la puesta en producción. | ⬜ |  |
| ⚠️ | RF-M9-05 | El sistema debe mantener una **bitácora de auditoría** de acciones sensibles: cambio de precio, ajuste de stock, anulación de venta, cierre  | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ⚠️ | RF-M9-06 | Cada registro de auditoría debe incluir: fecha/hora, usuario, acción, entidad afectada, valor anterior, valor nuevo. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |
| ✅ | RF-M9-07 | La bitácora debe ser **inapelable**: no editable ni eliminable desde la aplicación, ni siquiera por `admin`. | ✅ | seguridad.test.mjs |
| 🟡 | RF-M9-08 | El sistema debe permitir configurar datos del local: nombre, logo, moneda, zona horaria, % de descuento máximo por rol. | 🟡 |  |
| ⬜ | RF-M9-09 | El sistema debe mostrar la **versión** desplegada y un historial de cambios (changelog) accesible al usuario. | ⬜ |  |
| ⚠️ | RF-M9-10 | Las actualizaciones deben aplicarse **sin intervención del cliente** y sin pérdida de datos. | ✅ | el inventario dice hecho, pero ninguna prueba lo cita |

## Módulo M10

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ✅ | RF-M10-01 | Varios usuarios deben poder **vender simultáneamente** desde dispositivos distintos, cada uno con su caja y su sesión, sin interferirse. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M10-02 | Cuando dos cajeros venden el mismo producto a la vez, el descuento de stock debe ser **atómico**: el saldo final debe reflejar ambas ventas, | ✅ | concurrencia.test.mjs |
| ✅ | RF-M10-03 | Si dos usuarios editan el mismo producto a la vez, el segundo en guardar debe ser **advertido de que el dato cambió** y ver el valor actual  | ⬜ | concurrencia.test.mjs |
| ✅ | RF-M10-04 | El folio de venta debe ser **único y sin saltos** aunque varias ventas se registren en el mismo instante. | ✅ | concurrencia.test.mjs |
| 🟡 | RF-M10-05 | Un supervisor no debe poder cerrar la caja de un cajero que tiene una venta en curso sin una **advertencia explícita**. | 🟡 |  |
| ⬜ | RF-M10-06 | El stock mostrado debe **actualizarse en las demás pantallas** cuando otro usuario vende, sin necesidad de recargar. | ⬜ |  |
| ✅ | RF-M10-07 | Un vendedor debe ver **solo sus propias ventas**; el administrador y el supervisor ven las de todos. Esto debe cumplirse en la base de datos | ✅ | seguridad.test.mjs |
| ✅ | RF-M10-08 | Dos usuarios no deben poder aplicar la **misma toma de inventario** dos veces: la segunda debe ser rechazada. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M10-09 | Cuando dos dispositivos sincronizan ventas offline al mismo tiempo, **ninguna venta debe duplicarse ni perderse**. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M10-10 | Si un producto perecible es vendido a la vez por dos cajeros, el consumo FEFO no debe descontar **dos veces del mismo lote**. | ✅ | concurrencia.test.mjs |
| ✅ | RF-M10-11 | El sistema debe mostrar al usuario **quién y cuándo** modificó por última vez un producto, para resolver discrepancias entre turnos. | ⬜ | concurrencia.test.mjs |

## No funcionales

| | ID | Requerimiento | Inventario | Evidencia |
|:-:|---|---|:-:|---|
| ⬜ | RNF-01 | El POS debe cargar y estar operativo en **menos de 3 s** en una conexión 4G, y en **menos de 1 s** en cargas posteriores (caché del service  | — |  |
| ⬜ | RNF-02 | La búsqueda de productos debe devolver resultados en **menos de 300 ms** con 3.000 SKU, incluso sin conexión. | — |  |
| ⬜ | RNF-03 | El reconocimiento de un código de barras debe ocurrir en **menos de 1,5 s** desde que el código entra en cuadro, con luz de local comercial. | — |  |
| ⬜ | RNF-04 | Confirmar una venta debe tomar **menos de 800 ms** con conexión, y ser **instantáneo** sin conexión (encolado optimista). | — |  |
| ⬜ | RNF-05 | Un reporte de 12 meses de ventas debe generarse en **menos de 5 s**. | — |  |
| ⬜ | RNF-06 | El paquete inicial de JavaScript no debe superar **250 KB** comprimidos. | — |  |
| ⬜ | RNF-07 | Disponibilidad objetivo del **99,0 % mensual** en horario comercial (≈ 7 h de indisponibilidad al mes como máximo). | — |  |
| ⬜ | RNF-08 | **El local debe poder seguir vendiendo aunque el sistema central esté caído.** El POS opera offline y sincroniza al restablecerse. | — |  |
| ⬜ | RNF-09 | RPO (pérdida máxima de datos tolerable): **24 h** vía respaldo diario, y **0** para las ventas ya sincronizadas. | — |  |
| ⬜ | RNF-10 | RTO (tiempo máximo de recuperación): **4 h** en horario hábil. | — |  |
| ⬜ | RNF-11 | Debe funcionar en **Chrome/Edge 110+**, **Safari iOS 15+** y **Chrome Android 10+**. | — |  |
| ⬜ | RNF-12 | La interfaz debe ser **responsiva** de 360 px a 1920 px de ancho, sin scroll horizontal. | — |  |
| ⬜ | RNF-13 | Debe instalarse como **PWA** en la pantalla de inicio del celular, con ícono y pantalla de arranque propios. | — |  |
| ⬜ | RNF-14 | No debe requerir instalación de software ni drivers en el local. | — |  |
| ⬜ | RNF-15 | El escaneo por cámara debe degradar con elegancia: si el navegador no soporta `BarcodeDetector`, debe usar la librería de respaldo sin que e | — |  |
| ✅ | RNF-16 | Todo objetivo táctil debe medir al menos **44 × 44 px**. | — | recorrido clientes, recorrido combos, recorrido documento |
| ⬜ | RNF-17 | Las acciones principales del POS deben estar en el **tercio inferior** de la pantalla, alcanzables con el pulgar. | — |  |
| ⬜ | RNF-18 | Un usuario nuevo debe completar su primera venta en **menos de 15 min** de capacitación, sin ayuda escrita. | — |  |
| ✅ | RNF-19 | Toda operación destructiva o irreversible (anular venta, ajustar stock, cerrar caja) debe requerir **confirmación explícita**. | — | recorrido m5 |
| ✅ | RNF-20 | Los mensajes de error deben estar en **lenguaje del negocio**, no técnico: "No hay stock de este producto", no "constraint violation". | — | validaciones.test.ts |
| ⬜ | RNF-21 | Los montos deben mostrarse siempre formateados como CLP, con separador de miles y **sin decimales** ($12.990). | — |  |
| ⬜ | RNF-22 | La aplicación debe estar íntegramente en **español de Chile**. | — |  |
| ⬜ | RNF-23 | Todo el tráfico debe ir por **HTTPS/TLS 1.2+**. Sin excepción (además, la cámara no funciona sin HTTPS). | — |  |
| ⬜ | RNF-24 | **Toda** tabla de la base de datos debe tener **RLS habilitado** con políticas explícitas. Ninguna tabla accesible sin política. | — |  |
| ⬜ | RNF-25 | Las llaves `service_role` / `sb_secret_` deben existir **solo** en variables de entorno de servidor, nunca en el bundle del navegador. | — |  |
| ⬜ | RNF-26 | Las contraseñas deben almacenarse con hash fuerte. Se delega en Supabase Auth (bcrypt); **el sistema nunca implementa su propia criptografía | — |  |
| ⬜ | RNF-27 | Un usuario de un local **jamás** debe poder leer datos de otro local, ni siquiera manipulando peticiones. | — |  |
| ⬜ | RNF-28 | Las acciones sensibles deben quedar en bitácora inmutable con usuario, fecha e IP. | — |  |
| ⬜ | RNF-29 | El sistema debe aplicar limitación de tasa en autenticación y en endpoints del worker. | — |  |
| ⬜ | RNF-30 | Las dependencias deben auditarse automáticamente; ninguna vulnerabilidad **crítica** puede llegar a producción. | — |  |
| ⬜ | RNF-31 | Las fechas se almacenan en **UTC** (`timestamptz`) y se presentan en `America/Santiago`. | — |  |
| ⬜ | RNF-32 | Los montos se almacenan como **enteros en CLP**. Prohibido usar punto flotante para dinero. | — |  |
| ⬜ | RNF-33 | Las cantidades de inventario se almacenan como `numeric(14,3)` para soportar fracciones y peso. | — |  |
| ⬜ | RNF-34 | La configuración de IVA (19 %) debe ser un parámetro, no un número escrito en el código. | — |  |
| ⬜ | RNF-35 | Todo el código en **TypeScript en modo estricto**. Sin `any` implícito. | — |  |
| ⬜ | RNF-36 | Cobertura de pruebas **≥ 70 %** en la lógica de negocio (cálculo de totales, costo promedio, arqueo, sincronización offline). | — |  |
| ⬜ | RNF-37 | Debe existir una **suite de pruebas end-to-end** que cubra: venta completa, cierre de caja y recepción de mercadería. | — |  |
| ⬜ | RNF-38 | Los cambios de esquema se aplican solo mediante **migraciones versionadas** en el repositorio. Prohibido editar la base a mano en producción | — |  |
| ⬜ | RNF-39 | **La documentación de `docs/` debe actualizarse en el mismo PR que cambia el comportamiento del sistema.** Un PR que altera una regla de neg | — |  |
| ⬜ | RNF-40 | Todo error en producción debe reportarse automáticamente con su traza y contexto. | — |  |
| ⬜ | RNF-41 | La arquitectura debe soportar **múltiples locales (tenants)** sin cambios de esquema. | — |  |
| ⬜ | RNF-42 | El sistema debe soportar **20 usuarios concurrentes** por local y 50.000 ventas anuales sin degradación perceptible. | — |  |
| ⬜ | RNF-51 | Ninguna operación concurrente puede producir **stock incorrecto**: tras N ventas simultáneas del mismo producto, el saldo debe ser exactamen | — |  |
| ⬜ | RNF-52 | El sistema no debe presentar **interbloqueos** (deadlocks) bajo carga concurrente normal. | — |  |
| ⬜ | RNF-53 | Un mismo usuario debe poder operar en **hasta 3 dispositivos** simultáneos sin que se invaliden las sesiones entre sí. | — |  |
| ⬜ | RNF-43 | Agregar un local nuevo debe tomar **menos de 1 hora** de configuración, sin desplegar código. | — |  |
| ⬜ | RNF-50 | Con **5 cajeros vendiendo en paralelo**, el tiempo de confirmación de venta no debe superar 1,5 s en el percentil 95. | — |  |
| ⬜ | RNF-54 | Toda operación que modifique stock, caja o folios debe ejecutarse **dentro de una transacción de base de datos**, nunca orquestada desde el  | — |  |
| ⬜ | RNF-55 | El sistema debe tolerar que **dos dispositivos sincronicen la misma venta** (reintento tras corte de red) sin duplicarla. | — |  |
| ⬜ | RNF-56 | Los conflictos de edición deben resolverse **avisando al usuario**, nunca descartando silenciosamente el cambio de otro. | — |  |
| ⬜ | RNF-44 | Contraste mínimo **4,5:1** en texto normal (WCAG 2.1 AA). | — |  |
| ✅ | RNF-45 | La aplicación debe ser operable con teclado en escritorio. | — | recorrido documentos, recorrido m5 |
| ⬜ | RNF-46 | El estado de la aplicación nunca debe comunicarse **solo** por color (importa para el estado de conexión y el stock bajo). | — |  |
| ⬜ | RNF-47 | El tratamiento de datos personales debe cumplir la normativa chilena vigente (Ley 19.628 y Ley 21.719 según su entrada en vigencia). | — |  |
| ⬜ | RNF-48 | El cliente debe poder **exportar todos sus datos** en formato abierto y solicitar su eliminación al término del servicio. | — |  |
| ⬜ | RNF-49 | Debe informarse al cliente que sus datos residen en **Canadá (`ca-central-1`)** y obtener su conformidad. | — |  |
