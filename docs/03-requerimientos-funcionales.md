# 03 — Requerimientos funcionales

**Nomenclatura:** `RF-Mx-nn` donde `Mx` es el módulo.
**Prioridad (MoSCoW):** `M` Must (obligatorio v1.0) · `S` Should (v1.0 si alcanza) ·
`C` Could (v1.1+) · `W` Won't (registrado, fuera de alcance).

**Total v1.0:** 101 requerimientos — 76 Must, 16 Should, 9 Could.

> Actualizado el 2026-09-14: +7 requerimientos de control de vencimiento
> (RF-M4-14 a RF-M4-20) tras responderse P-07. Ver [ADR-007](adr/ADR-007-lotes-vencimiento.md).
>
> Actualizado el 2026-09-14: +4 requerimientos de gestión de empleados
> (RF-M1-12 a RF-M1-15) y **+11 de trabajo simultáneo (módulo M10)**, tras
> confirmarse que varios empleados operan a la vez desde sus propios equipos.

---

## M1 · Autenticación, usuarios y sesiones

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M1-01 | El sistema debe permitir iniciar sesión con correo electrónico y contraseña. | M |
| RF-M1-02 | Cada trabajador debe tener una **sesión independiente**; toda acción queda atribuida a su usuario. | M |
| RF-M1-03 | El administrador debe poder crear, editar y **desactivar** usuarios (nunca eliminar, para no romper el historial). | M |
| RF-M1-04 | El sistema debe asignar a cada usuario exactamente un rol: `admin`, `supervisor`, `vendedor` o `bodega`. | M |
| RF-M1-05 | El sistema debe permitir recuperar la contraseña mediante enlace enviado al correo. | M |
| RF-M1-06 | La sesión debe mantenerse activa entre visitas ("recordarme") para no reingresar la clave en cada turno. | M |
| RF-M1-07 | El sistema debe permitir cerrar sesión explícitamente, incluso con ventas pendientes de sincronizar (advirtiendo al usuario). | M |
| RF-M1-08 | Una contraseña debe tener mínimo 8 caracteres; el sistema debe rechazar contraseñas de uso común. | M |
| RF-M1-09 | El administrador debe poder forzar el cierre de sesión de un usuario en todos sus dispositivos. | S |
| RF-M1-10 | El sistema debe soportar segundo factor (TOTP) para el rol `admin`. | C |
| RF-M1-11 | El sistema debe bloquear temporalmente la cuenta tras 5 intentos fallidos consecutivos. | S |
| RF-M1-12 | El administrador debe poder **invitar a un empleado por correo**; el empleado define su propia contraseña desde el enlace recibido. El administrador nunca conoce la contraseña de sus empleados. | M |
| RF-M1-13 | Un mismo usuario debe poder tener sesión abierta en **más de un dispositivo** a la vez (celular y computador). | M |
| RF-M1-14 | El administrador debe poder ver **qué usuarios están conectados** y cuándo fue su última actividad. | S |
| RF-M1-15 | El sistema debe registrar cada inicio y cierre de sesión en la bitácora de auditoría. | S |

**Criterios de aceptación clave**

- Dos usuarios en dos celulares distintos pueden vender simultáneamente sin interferirse.
- Al desactivar un usuario, sus ventas históricas siguen visibles y atribuidas a él.

---

## M2 · Catálogo de productos

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M2-01 | El sistema debe permitir crear un producto con: nombre, categoría, precio de venta, costo, unidad de medida, stock mínimo. | M |
| RF-M2-02 | Un producto debe poder tener **uno o más códigos de barra** asociados (el mismo artículo puede venir con distinto código según lote o formato). | M |
| RF-M2-03 | El sistema debe validar que un código de barras no esté asignado a dos productos distintos dentro del mismo local. | M |
| RF-M2-04 | El sistema debe permitir crear un producto **escaneando su código**, precargando el código en el formulario. | M |
| RF-M2-05 | El sistema debe permitir buscar productos por nombre, código de barras o código interno (SKU), con resultados incrementales mientras se escribe. | M |
| RF-M2-06 | El sistema debe permitir organizar productos en **categorías** (un nivel). | M |
| RF-M2-07 | El sistema debe permitir adjuntar una **imagen** al producto, tomada con la cámara. | S |
| RF-M2-08 | El sistema debe permitir **desactivar** un producto sin borrarlo, conservando su historial. | M |
| RF-M2-09 | El sistema debe registrar el **historial de cambios de precio** con fecha y usuario. | M |
| RF-M2-10 | El sistema debe calcular y mostrar el **margen** (precio − costo) y el porcentaje de margen, visible solo para `admin`. | M |
| RF-M2-11 | El sistema debe permitir **carga masiva** de productos desde archivo CSV/Excel con plantilla predefinida. | M |
| RF-M2-12 | La carga masiva debe validar el archivo antes de aplicar y mostrar un informe de errores por fila, sin cargar parcialmente. | M |
| RF-M2-13 | El sistema debe permitir generar e imprimir **etiquetas con código de barras** para productos sin código de fábrica. | S |
| RF-M2-14 | El sistema debe permitir definir productos vendidos por **peso o fracción** (unidad de medida decimal). | C |
| RF-M2-15 | El sistema debe permitir duplicar un producto para crear variantes rápidamente. | C |

---

## M3 · Proveedores y recepción de mercadería

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M3-01 | El sistema debe permitir registrar proveedores con: nombre/razón social, RUT, contacto, teléfono, correo. | M |
| RF-M3-02 | El sistema debe validar el formato y dígito verificador del **RUT** chileno. | M |
| RF-M3-03 | El sistema debe permitir asociar uno o más proveedores a un producto. | S |
| RF-M3-04 | El sistema debe permitir registrar una **recepción de mercadería**: proveedor, documento, fecha, líneas con producto, cantidad y costo unitario. | M |
| RF-M3-05 | Al confirmar una recepción, el sistema debe **aumentar el stock** de cada producto y registrar el movimiento en el kardex. | M |
| RF-M3-06 | Al confirmar una recepción, el sistema debe **recalcular el costo promedio ponderado** de cada producto recibido. | M |
| RF-M3-07 | El sistema debe permitir cargar las líneas de una recepción **escaneando** cada producto. | M |
| RF-M3-08 | El sistema debe advertir cuando el costo de recepción difiere en más de un % configurable respecto del costo anterior. | S |
| RF-M3-09 | El sistema debe permitir anular una recepción, revirtiendo stock y costo, dejando ambos movimientos en el kardex. | M |
| RF-M3-10 | El sistema debe mostrar el historial de compras por proveedor y por producto. | S |
| RF-M3-11 | El sistema debe permitir generar una **orden de compra sugerida** con los productos bajo stock mínimo. | C |

---

## M4 · Inventario y control de stock

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M4-01 | El sistema debe mantener el stock de cada producto **en tiempo real**, reflejando ventas, recepciones y ajustes. | M |
| RF-M4-02 | Todo cambio de stock debe generar un registro inmutable en el **kardex**, con: fecha, producto, tipo de movimiento, cantidad, saldo resultante, usuario y referencia al documento origen. | M |
| RF-M4-03 | Los tipos de movimiento deben ser: `venta`, `anulacion_venta`, `recepcion`, `anulacion_recepcion`, `ajuste_positivo`, `ajuste_negativo`, `merma`, `inventario_inicial`, `toma_inventario`. | M |
| RF-M4-04 | El sistema debe permitir **ajustar el stock** indicando obligatoriamente un motivo. | M |
| RF-M4-05 | El sistema debe permitir realizar una **toma de inventario**: registrar el conteo físico y generar automáticamente el ajuste por la diferencia. | M |
| RF-M4-06 | La toma de inventario debe poder hacerse por categoría o parcialmente, sin exigir contar todo el local de una vez. | M |
| RF-M4-07 | El sistema debe permitir definir un **stock mínimo** por producto y marcar visualmente los productos bajo ese nivel. | M |
| RF-M4-08 | El sistema debe mostrar el **inventario valorizado** (stock × costo promedio) total y por categoría. | M |
| RF-M4-09 | El sistema debe advertir al vender un producto con stock insuficiente, permitiendo continuar solo a `admin` y `supervisor`. | M |
| RF-M4-10 | El sistema debe registrar la **merma** como un tipo de ajuste diferenciado, para poder reportarla por separado. | M |
| RF-M4-11 | El kardex debe ser **inmutable**: no se puede editar ni eliminar un movimiento, solo emitir uno compensatorio. | M |
| RF-M4-12 | El sistema debe permitir consultar el kardex de un producto filtrando por rango de fechas y tipo de movimiento. | M |
| RF-M4-13 | El sistema debe soportar stock por **ubicación/bodega** dentro del mismo local. | C |
| RF-M4-14 | El sistema debe permitir marcar un producto como **perecible** (`tracks_expiry`), habilitando el control por lote solo en esos productos. | M |
| RF-M4-15 | Al recepcionar un producto perecible, el sistema debe **exigir la fecha de vencimiento** y rechazar lotes ya vencidos. | M |
| RF-M4-16 | El sistema debe mantener el stock de productos perecibles **por lote**, con su fecha de vencimiento y costo. | M |
| RF-M4-17 | Al vender un producto perecible, el sistema debe descontar automáticamente del lote que **vence primero (FEFO)**, sin intervención del cajero. | M |
| RF-M4-18 | El sistema debe alertar los lotes **por vencer** (según días configurables por producto) y los **ya vencidos**, indicando el valor en riesgo. | M |
| RF-M4-19 | El sistema debe permitir dar de baja un lote vencido como **merma**, con motivo obligatorio. | M |
| RF-M4-20 | Al anular una venta, las unidades deben volver **al lote exacto** del que salieron. | M |

---

## M5 · Punto de venta (POS)

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M5-01 | El sistema debe permitir agregar un producto al carrito **escaneando su código de barras con la cámara del celular**. | M |
| RF-M5-02 | El escaneo debe funcionar de forma continua: escanear varios productos seguidos sin reabrir la cámara. | M |
| RF-M5-03 | El sistema debe emitir **retroalimentación sonora y vibración** al reconocer un código. | M |
| RF-M5-04 | Si el código escaneado no existe en el catálogo, el sistema debe ofrecer crear el producto en ese momento. | M |
| RF-M5-05 | El sistema debe permitir agregar productos **buscando por nombre**, para artículos sin código. | M |
| RF-M5-06 | El sistema debe permitir modificar la cantidad de una línea del carrito y eliminar líneas. | M |
| RF-M5-07 | El sistema debe calcular el total en tiempo real, en pesos chilenos **sin decimales**. | M |
| RF-M5-08 | El sistema debe permitir aplicar un **descuento** por línea o al total, en monto o porcentaje, según el permiso del rol. | M |
| RF-M5-09 | El sistema debe permitir registrar el **medio de pago**: efectivo, débito, crédito, transferencia. | M |
| RF-M5-10 | El sistema debe permitir **pago mixto** (más de un medio en la misma venta). | S |
| RF-M5-11 | Para pagos en efectivo, el sistema debe calcular el **vuelto** a partir del monto recibido. | M |
| RF-M5-12 | Al confirmar la venta, el sistema debe descontar el stock, registrar el kardex y afectar la caja **en una sola transacción atómica**. | M |
| RF-M5-13 | El sistema debe asignar a cada venta un **folio correlativo** por local. | M |
| RF-M5-14 | El sistema debe mostrar un comprobante en pantalla, compartible por WhatsApp o correo. | S |
| RF-M5-15 | El sistema debe permitir **anular** una venta según los permisos del rol, revirtiendo stock y caja, dejando traza de ambos movimientos. | M |
| RF-M5-16 | El sistema debe impedir vender si el usuario **no tiene caja abierta**. | M |
| RF-M5-17 | El POS debe **operar sin conexión a internet**: permitir registrar ventas y encolarlas localmente. | M |
| RF-M5-18 | Al recuperar la conexión, el sistema debe **sincronizar automáticamente** las ventas en cola, en orden, sin duplicar. | M |
| RF-M5-19 | El sistema debe mostrar de forma permanente y visible el **estado de conexión** y la cantidad de ventas pendientes de sincronizar. | M |
| RF-M5-20 | El sistema debe permitir dejar una venta **en espera** y retomarla (cliente que va a buscar otro producto). | S |
| RF-M5-21 | La pantalla del POS debe ser operable **con una sola mano** en un celular de 5 pulgadas. | M |
| RF-M5-22 | El sistema debe permitir ingresar un producto genérico "venta varia" con monto libre. | C |

---

## M6 · Control de caja

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M6-01 | El sistema debe exigir la **apertura de caja** declarando el monto inicial en efectivo. | M |
| RF-M6-02 | Cada usuario debe tener **su propia sesión de caja**; dos usuarios pueden tener cajas abiertas en simultáneo. | M |
| RF-M6-03 | El sistema debe permitir registrar **movimientos de caja** distintos de ventas: ingresos y egresos, con motivo obligatorio. | M |
| RF-M6-04 | El sistema debe calcular el **efectivo esperado** = monto inicial + ventas en efectivo + ingresos − egresos. | M |
| RF-M6-05 | Al cerrar la caja, el sistema debe solicitar el **conteo físico** y mostrar la diferencia (sobrante o faltante). | M |
| RF-M6-06 | Si existe diferencia, el sistema debe exigir un comentario antes de permitir el cierre. | M |
| RF-M6-07 | El cierre de caja debe generar un **resumen**: ventas por medio de pago, cantidad de transacciones, ticket promedio, diferencia. | M |
| RF-M6-08 | Una caja cerrada debe ser **inmutable**: no se pueden agregar ni modificar movimientos posteriores. | M |
| RF-M6-09 | El sistema debe impedir abrir una segunda caja al usuario que ya tiene una abierta. | M |
| RF-M6-10 | El `admin` debe poder **forzar el cierre** de una caja olvidada, quedando registrado quién la cerró. | M |
| RF-M6-11 | El sistema debe alertar si una caja lleva más de X horas abierta (configurable). | S |
| RF-M6-12 | El sistema debe permitir consultar el historial de cierres con sus diferencias. | M |

---

## M7 · Reportes y dashboard

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M7-01 | El sistema debe ofrecer un **dashboard** con: ventas de hoy, cantidad de transacciones, ticket promedio, productos bajo stock mínimo. | M |
| RF-M7-02 | El sistema debe ofrecer un reporte de **ventas por período** con filtro de fechas. | M |
| RF-M7-03 | El sistema debe ofrecer ventas **por usuario**, para comparar desempeño y auditar. | M |
| RF-M7-04 | El sistema debe ofrecer ventas **por producto y por categoría**, ordenables por unidades o por monto. | M |
| RF-M7-05 | El sistema debe ofrecer el reporte de **inventario valorizado** al costo. | M |
| RF-M7-06 | El sistema debe ofrecer el reporte de **margen y utilidad bruta** por producto y período (solo `admin`). | M |
| RF-M7-07 | El sistema debe ofrecer el reporte de **productos sin movimiento** en N días (capital inmovilizado). | M |
| RF-M7-08 | El sistema debe ofrecer el reporte de **mermas y ajustes** por período y motivo. | M |
| RF-M7-09 | El sistema debe permitir **exportar cualquier reporte a Excel/CSV**. | M |
| RF-M7-10 | El sistema debe mostrar un gráfico de evolución de ventas de los últimos 30 días. | S |
| RF-M7-11 | El sistema debe ofrecer comparación de ventas contra el mismo período anterior. | C |
| RF-M7-12 | Los reportes deben respetar la matriz de permisos: un `vendedor` solo ve lo propio y nunca ve costos. | M |

---

## M8 · Alertas y notificaciones

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M8-01 | El sistema debe alertar dentro de la aplicación cuando un producto queda bajo su stock mínimo. | M |
| RF-M8-02 | El sistema debe enviar un **resumen diario** por correo al administrador: ventas, diferencias de caja, productos bajo mínimo. | M |
| RF-M8-03 | El sistema debe alertar al administrador si al cierre del día quedó una caja sin cerrar. | M |
| RF-M8-04 | El sistema debe alertar al administrador ante una diferencia de arqueo mayor a un monto configurable. | S |
| RF-M8-05 | El sistema debe permitir configurar el correo destinatario y activar/desactivar cada tipo de alerta. | M |
| RF-M8-06 | El sistema debe soportar notificaciones push en el navegador. | C |

---

## M9 · Administración, respaldo y auditoría

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M9-01 | El sistema debe realizar un **respaldo automático diario** de la base de datos. | M |
| RF-M9-02 | Los respaldos deben conservarse al menos **30 días**. | M |
| RF-M9-03 | El `admin` debe poder **descargar** un respaldo de sus datos en formato abierto (CSV/JSON). | M |
| RF-M9-04 | El procedimiento de **restauración** debe estar documentado y probado al menos una vez antes de la puesta en producción. | M |
| RF-M9-05 | El sistema debe mantener una **bitácora de auditoría** de acciones sensibles: cambio de precio, ajuste de stock, anulación de venta, cierre forzado de caja, alta/baja de usuario, cambio de rol. | M |
| RF-M9-06 | Cada registro de auditoría debe incluir: fecha/hora, usuario, acción, entidad afectada, valor anterior, valor nuevo. | M |
| RF-M9-07 | La bitácora debe ser **inapelable**: no editable ni eliminable desde la aplicación, ni siquiera por `admin`. | M |
| RF-M9-08 | El sistema debe permitir configurar datos del local: nombre, logo, moneda, zona horaria, % de descuento máximo por rol. | M |
| RF-M9-09 | El sistema debe mostrar la **versión** desplegada y un historial de cambios (changelog) accesible al usuario. | M |
| RF-M9-10 | Las actualizaciones deben aplicarse **sin intervención del cliente** y sin pérdida de datos. | M |

---

## M10 · Trabajo simultáneo y concurrencia

> **Por qué existe este módulo.** El local lo administra una persona y lo operan
> varios empleados **al mismo tiempo, desde sus propios celulares**. Eso no es
> solo "varios usuarios": son varias personas escribiendo sobre los mismos datos
> en el mismo segundo. Los requerimientos de abajo cubren lo que pasa cuando dos
> acciones chocan — el escenario que más silenciosamente corrompe un inventario.

| ID | Requerimiento | Prio. |
|---|---|:--:|
| RF-M10-01 | Varios usuarios deben poder **vender simultáneamente** desde dispositivos distintos, cada uno con su caja y su sesión, sin interferirse. | M |
| RF-M10-02 | Cuando dos cajeros venden el mismo producto a la vez, el descuento de stock debe ser **atómico**: el saldo final debe reflejar ambas ventas, nunca solo una. | M |
| RF-M10-03 | Si dos usuarios editan el mismo producto a la vez, el segundo en guardar debe ser **advertido de que el dato cambió** y ver el valor actual antes de sobrescribir. No se permite la sobreescritura silenciosa. | M |
| RF-M10-04 | El folio de venta debe ser **único y sin saltos** aunque varias ventas se registren en el mismo instante. | M |
| RF-M10-05 | Un supervisor no debe poder cerrar la caja de un cajero que tiene una venta en curso sin una **advertencia explícita**. | S |
| RF-M10-06 | El stock mostrado debe **actualizarse en las demás pantallas** cuando otro usuario vende, sin necesidad de recargar. | S |
| RF-M10-07 | Un vendedor debe ver **solo sus propias ventas**; el administrador y el supervisor ven las de todos. Esto debe cumplirse en la base de datos, no solo en la interfaz. | M |
| RF-M10-08 | Dos usuarios no deben poder aplicar la **misma toma de inventario** dos veces: la segunda debe ser rechazada. | M |
| RF-M10-09 | Cuando dos dispositivos sincronizan ventas offline al mismo tiempo, **ninguna venta debe duplicarse ni perderse**. | M |
| RF-M10-10 | Si un producto perecible es vendido a la vez por dos cajeros, el consumo FEFO no debe descontar **dos veces del mismo lote**. | M |
| RF-M10-11 | El sistema debe mostrar al usuario **quién y cuándo** modificó por última vez un producto, para resolver discrepancias entre turnos. | C |

### Cómo se cumple cada uno

| Requerimiento | Mecanismo |
|---|---|
| RF-M10-02 | `fn_post_movement` hace `INSERT … ON CONFLICT DO UPDATE … RETURNING` en una sola sentencia: PostgreSQL bloquea la fila y serializa a los dos cajeros |
| RF-M10-04 | `fn_next_folio` usa un contador con `ON CONFLICT DO UPDATE`, atómico por tenant |
| RF-M10-07 | Política RLS `sales_read` filtra por `sold_by = auth.uid()` para el rol `vendedor` |
| RF-M10-08 | `fn_apply_stock_count` verifica `status = 'en_progreso'` dentro de la transacción |
| RF-M10-09 | `UNIQUE (tenant_id, client_uuid)` + la función devuelve `already_existed: true` en vez de fallar |
| RF-M10-10 | `fn_consume_lots` usa `SELECT … FOR UPDATE` sobre los lotes: el segundo cajero espera y ve el saldo ya descontado |
| RF-M10-03 | **Pendiente de implementar**: requiere bloqueo optimista por `updated_at`. Ver P-24 |
| RF-M10-06 | **Pendiente de implementar**: requiere suscripción Realtime de Supabase |

---

## Trazabilidad con la propuesta comercial

Verificación de que todo lo ofertado tiene un requerimiento que lo respalda:

| Ítem ofertado en la propuesta | Requerimientos que lo cubren |
|---|---|
| Inventario en tiempo real | RF-M4-01, RF-M4-02 |
| Registro e historial de ventas | RF-M5-12, RF-M5-13, RF-M7-02 |
| Lectura de códigos de barras con la cámara | RF-M5-01 a RF-M5-04, RF-M2-04, RF-M3-07 |
| Gestión de precios, costos y cantidades | RF-M2-01, RF-M2-09, RF-M2-10, RF-M3-06 |
| Control de stock y alertas | RF-M4-07, RF-M8-01, RF-M8-02 |
| Gestión de productos y proveedores | Módulos M2 y M3 completos |
| Usuarios con sesiones independientes | RF-M1-02, RF-M1-04, RF-M1-12 a RF-M1-15, RF-M6-02, **módulo M10 completo** |
| Control de caja | Módulo M6 completo |
| Reportes de ventas e inventario | Módulo M7 completo |
| Acceso desde celular, tablet y computador | RNF-11 a RNF-14 ([04](04-requerimientos-no-funcionales.md)) |
| Respaldo de información | RF-M9-01 a RF-M9-04 |
| Actualizaciones del sistema | RF-M9-09, RF-M9-10 |
| Soporte | [12 — Modelo de servicio](12-costos-modelo-servicio.md) |

> **Sin cobertura:** el ítem "control contable" de la propuesta escrita no tiene
> requerimiento asociado. Ver FA-2 en [01 §5.2](01-vision-alcance.md) y la
> pregunta P-03 en [15](15-preguntas-abiertas.md). **Es el principal riesgo de
> expectativa del proyecto.**
