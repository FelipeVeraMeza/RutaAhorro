# 23 — Requerimientos desde el cuestionario del cliente

**Fecha:** 2026-09-26 · **Fuente:** respuestas del cliente a las preguntas 1–42
del cuestionario (`docs/cliente/Sistema-RutaAhorro.pdf`, 15-09-2026), cruzadas
contra el código, no contra los documentos.

**Cómo leer el estado:**
✅ hecho y recorrido en el navegador contra la base real ·
🟡 existe en parte (se dice qué falta) ·
⬜ no existe ·
🔒 no depende de programar (trámite o decisión)

**Base** = PostgreSQL/Supabase (tablas, funciones, RLS) · **Pantalla** = web.
**La meta es el celular:** toda pantalla nueva se diseña a 360 px de ancho,
con objetivos táctiles de 44 px, y después se estira al computador. Nunca al
revés.

---

## 1. Lo que respondió el cliente, traducido

### A · Local y catálogo

| # | Respuesta | Requerimiento | Estado | Base | Pantalla |
|---|---|---|---|---|---|
| 1 | Más de 200 productos | **RQ-01** El catálogo completo vive en el celular para vender sin internet | ✅ | — | — |
| 2 | Sí, en el ERP **Kame** | **RQ-02** Importar el catálogo desde la exportación de Kame | 🟡 La carga masiva lee Excel y CSV, pero **nunca se probó con un archivo de Kame**. Falta el archivo real para mapear sus columnas | — | Importar |
| 3 | Por unidad, por caja y por mayor | **RQ-03** Vender una **caja o pack** que descuenta N unidades (código de la caja ≠ código de la unidad) | ⬜ | Tabla de presentaciones (código, unidades, precio) | POS, Productos |
| 3 | ″ | **RQ-04** **Precio por mayor por tramos de cantidad** («1 a $1.000, desde 3 a $700», punto 8 de la lista; «1 por $2.000 y si llevas 3, los 3 a $1.400», 2026-09-26) | ✅ 2026-09-26, migración 0018, **junto con T-14**. 14 pruebas contra PostgreSQL, recorrido `ofertas.mjs` 20/20 | `product_price_tiers`; `fn_register_sale` pone y valida el precio del tramo | El POS recalcula la línea, muestra el ahorro y cuántas faltan para la oferta; Productos edita las ofertas; el consultador las muestra |
| 4 | Casi todo tiene código; algunas frutas y verduras congeladas no | **RQ-05** Vender sin código: por nombre, o con etiqueta EAN-13 interna | ✅ búsqueda por nombre y etiquetas imprimibles | — | — |
| 5 | Sí: bebidas con **impuesto específico** | **RQ-06** **Impuesto adicional por producto** (IABA 10 % / 18 %, ILA 20,5 % / 31,5 %), con **tasas editables** y asignación a muchos productos a la vez | ✅ 2026-09-26, migración 0018. La venta congela la tasa; cambiarla no toca ventas hechas. La base y el POS calculan el mismo desglose al peso (150 ventas al azar). 🟡 Falta mostrarlo en Reportes | `impuestos_adicionales`, `sales.impuestos_detalle` | Configuración (admin), formulario de producto, comprobante |
| 6 | Sí, **por cliente y por promoción** | **RQ-07** Precio especial por cliente | ⬜ Depende de RQ-21 (clientes) | Lista de precios por cliente | POS al elegir cliente |
| 6 | ″ | **RQ-08** Promociones con vigencia (fecha desde / hasta) | ✅ 2026-09-26: una oferta con fechas es una promoción ("desde 1 unidad a $1.800 esta semana"). Rige por el día del local | `product_price_tiers.vigente_desde/hasta` | Formulario de producto |
| 7 | Más de 10 proveedores | **RQ-09** Proveedores con RUT validado e historial | ✅ | — | — |
| 8 | Todo tiene vencimiento y hoy **no lo controla** | **RQ-10** Lote y vencimiento en cada recepción de perecibles; **"controla vencimiento" activado por omisión** al crear | 🟡 Lotes, FEFO y baja de vencidos existen; el producto nace sin control y hay que acordarse de activarlo | — | Formulario de producto |
| 9 | No necesita marcas ni formatos | — | — | — | — |
| 10 | **Sí**, aviso cerca del vencimiento | **RQ-11** Alerta de "por vencer" y "vencido" | 🟡 El worker las calcula; **nadie las recibe** hasta desplegar el worker (B-03) y conectar el correo (T-50) | — | Inicio las muestra |

### B · Ventas y atención

| # | Respuesta | Requerimiento | Estado | Base | Pantalla |
|---|---|---|---|---|---|
| 11 | ~200 ventas al día | **RQ-12** Dimensionamiento: sin problema para el plan actual | ✅ | — | — |
| 12 | 5 a 10 productos por venta | **RQ-13** **Lector de códigos físico**: leer, agregar y quedar listo para el siguiente, sin tocar la pantalla | ✅ 2026-09-26. Antes el Enter del lector se ignoraba y había que tocar el resultado cada vez. Recorrido M5 | — | POS y Consultador |
| 13 | **Sí** se vende sin stock registrado | **RQ-14** Vender sin stock registrado **cualquier cajero**, con aviso y alerta al administrador | ✅ 2026-09-26, migración 0017 (`tenants.settings.vender_sin_stock`). Corregido de paso: una venta **sin internet** de un vendedor con el stock desactualizado quedaba en error para siempre al sincronizar; ahora viaja forzada y deja la alerta | Parámetro del local | POS |
| 14 | Descuento por producto, por venta y por cliente | **RQ-15** Descuento **por línea** en el POS | ⬜ **T-16** · la base ya lo valida contra el tope del rol | — | POS |
| 14 | ″ | **RQ-16** Descuento **a la venta completa** | ⬜ La base lo acepta (`p_discount_total`); la pantalla no lo ofrece | — | Cobro |
| 14–15 | Los autorizan **John y Jo** | **RQ-17** **Autorización en el mostrador**: el vendedor pide el descuento, John o Jo lo aprueban con su PIN en el mismo celular, sin cerrar la sesión del vendedor | ⬜ Hoy el vendedor tiene tope 0 % y no hay forma de pedir permiso | PIN por usuario (con hash), función que valida y registra quién autorizó | Diálogo en el POS |
| 16 | Devolución **parcial y completa** | **RQ-18** Devolución parcial: elegir qué líneas y cuántas unidades vuelven | ⬜ Hoy solo se anula la venta entera | Función de devolución, stock vuelve a la sala | Ventas |
| 17 | Cambios **con nota de crédito** | **RQ-19** **Nota de crédito** con correlativo propio que respalda cada devolución | ⬜ **T-56** · registrarla sí se puede; emitirla ante el SII espera B-04/B-05 | Tabla de notas + correlativo | Ventas, comprobante |
| 18 | No vende fiado | — Se descarta cuenta corriente | — | — | — |
| 19 | Sí, sobre todo en facturas | **RQ-20** Guardar al receptor de una factura y **autocompletarlo** la próxima vez por RUT | ⬜ Hoy se escribe cada vez | Tabla `clientes` | Cobro |
| 6 · 19 | ″ | **RQ-21** **Ficha de cliente** (RUT, razón social, giro, dirección, precio especial) | ⬜ | ″ | Nueva pantalla, dentro de "Más" en el celular |
| 20 | **Sí**, pago dividido | **RQ-22** **Pago mixto** (parte efectivo, parte débito…) | ⬜ **T-17** · la base acepta varias filas de pago desde el primer día. Hay que decidir el documento: la parte con tarjeta la cubre el voucher, la parte en efectivo necesita boleta | — | Cobro |

### C · Caja y turnos

| # | Respuesta | Requerimiento | Estado | Base | Pantalla |
|---|---|---|---|---|---|
| 21 | **1 caja** | **RQ-23** Ver RQ-24 | — | — | — |
| 22 | «No sé» (¿caja propia o compartida?) | **RQ-24** **Caja compartida**: con un solo cajón y dos personas (John y Jo), las dos venden sobre la **misma** caja abierta | ⬜ **Hoy la caja es por persona**: si Jo vende mientras la caja la abrió John, Jo tiene que abrir otra y el arqueo del cajón no cuadra con ninguna de las dos. **Es la decisión más urgente de esta lista** | La venta entra a la caja abierta del local, no a la del usuario | Caja |
| 23 | Parte con **$20.000** y monedas | **RQ-25** Efectivo inicial sugerido: $20.000, editable | ✅ 2026-09-26. Botón "Lo habitual: $20.000" bajo el campo; no se escribe solo, porque el cajero tiene que contar | `tenants.settings.efectivo_inicial_sugerido` | Caja |
| 24 · 29 | «No hay» movimientos… pero **sí** registra depósitos y retiros | **RQ-26** Retiros del dueño, depósitos al banco y gastos menores como movimientos de caja con motivo | ✅ ingresos y egresos con motivo | — | — |
| 25 | Retiros los autorizan John y Jo | **RQ-27** Un retiro lo hace o lo autoriza John o Jo (mismo mecanismo que RQ-17) | 🟡 Hoy lo hace quien tenga la caja | — | Caja |
| 26–27 | Si falta o sobra: nada. Nadie revisa | **RQ-28** Toda diferencia al cerrar exige explicación y **le llega al dueño** en el resumen diario | 🟡 El cierre registra la diferencia; el aviso depende del worker (B-03, T-50) | — | — |
| 28 | Si olvidan cerrar: nada | **RQ-29** Aviso de caja abierta hace más de N horas + cierre forzado por John o Jo | ✅ en la pantalla · 🟡 el aviso por correo espera al worker | — | — |
| 30 | **Sí**, resumen diario automático | **RQ-30** Resumen diario por correo al dueño | 🟡 Construido en el worker; **no corre** hasta B-03 y T-50 | — | — |

### D · Inventario y recepción

| # | Respuesta | Requerimiento | Estado | Base | Pantalla |
|---|---|---|---|---|---|
| 31 | Inventario cada vez que sea necesario | **RQ-31** Toma de inventario cuando se quiera, total o de algunos productos | ✅ | — | — |
| 32 | General (sin sectores) | — | — | — | — |
| 33 | **2** lugares | **RQ-32** Sala de ventas + bodega | ✅ desde 0014 · **confirmar** que "2" no significa dos bodegas **además** de la sala | — | — |
| 34 | Mermas y roturas **no se registran** | **RQ-33** Registrar merma, rotura, vencido o pérdida con motivo, en dos toques desde el celular | 🟡 Existe como ajuste; revisar que un bodeguero lo encuentre sin ayuda | — | Inventario |
| 35 | Ajustes: John y Jo | **RQ-34** Ajustes de stock solo por quienes el dueño designe | 🟡 Hoy también bodega. Decidir si bodega pierde el permiso | RLS / guardia de rol | — |
| 36 | **Sí**, devoluciones a proveedores | **RQ-35** **Devolución a proveedor**: sale stock de la bodega, con costo, documento y motivo | ⬜ | Tipo de movimiento nuevo + función | Proveedores |
| 37 | Recibe **boleta y factura** | **RQ-36** Recepción con factura o boleta del proveedor | ✅ | — | — |
| 37 · lista 3 | ″ | **RQ-37** Crear productos nuevos **dentro** de la recepción | ⬜ **T-55** | — | Recepción |
| 38 | No entendió la pregunta | **RQ-38** Aviso cuando el costo recibido cambia más de un 20 % respecto al anterior | ✅ ya existe. **Explicarlo al cliente con un ejemplo**, no preguntarlo de nuevo | — | — |
| 39 | **Sí**, lotes para todos los perecibles | Ver RQ-10 | — | — | — |
| 40 | «No» (¿qué hacer si el stock no coincide?) | **RQ-39** El conteo manda: la toma ajusta el sistema al conteo, con registro de quién y cuánto | ✅ | — | — |

### E · Equipos

| # | Respuesta | Requerimiento | Estado | Base | Pantalla |
|---|---|---|---|---|---|
| 41 | Equipos **nuevos** | **RQ-40** Probar en los celulares reales: cámara (T-49), etiqueta impresa contra el lector (B-07) e impresora | 🔒 Felipe, en el local | — | — |
| 42 | **2** dispositivos a la vez | **RQ-41** Dos equipos vendiendo a la vez sin pisarse | ✅ probado (CP-01, CP-02, CP-08) · se cruza con RQ-24 | — | — |

---

## 2. Lo que no respondió y cómo lo deduzco

Las preguntas 43 a 90 quedaron sin respuesta. Esto es lo que asumo para seguir
trabajando. **Cada supuesto hay que confirmarlo**, pero ninguno detiene el
desarrollo.

| Pregunta | Supuesto | Por qué | Consecuencia |
|---|---|---|---|
| 43 · cortes de internet | Ocasionales | Local urbano con equipos nuevos | El modo sin conexión queda como red de seguridad; ya existe |
| 44 · impresora | Térmica de **80 mm** | Es la estándar de mostrador y el comprobante ya la soporta | Probar con la impresora real |
| 45 · cámara o lector | **Los dos** | 200 ventas/día con 5–10 productos: la cámara sola es lenta | RQ-13 pasa a ser obligatorio |
| 46 · más de un equipo por vendedor | Sí | 2 equipos y 2 personas | Ya soportado |
| 51–54 · certificado, SII, sistema actual | **Hoy emiten con Kame** | Kame es un ERP con facturación electrónica | **Cambia P-27:** quizás no hay que contratar un proveedor de DTE, sino seguir emitiendo con Kame o integrarse con él. Preguntarlo antes de escribir una línea de F6 |
| 55 · facturas a empresas | Sí | Pregunta 37 y punto 9 de la lista | Ya se registra la factura con receptor |
| 56 · notas de crédito | Sí | Pregunta 17 | RQ-19 |
| 57 · quién anula | John y Jo | Patrón de las preguntas 15, 25 y 35 | Anular = admin/supervisor, como hoy |
| 59–60 · contador | Excel mensual | Reportes ya exportan | Confirmar qué pide el contador |
| 61 · tres números | Venta del día, margen, dinero en caja | Lo que muestra Inicio | — |
| 67–68 · alertas | Stock bajo, vencimientos y diferencias de caja, al dueño | Preguntas 10, 26 y 30 | RQ-11, RQ-28, RQ-30 |
| 81 · qué requiere autorización | Descuentos, retiros, ajustes, anulaciones | Preguntas 15, 25 y 35 | RQ-17 y RQ-27 |
| 85, 90 · qué no se borra | Nada de ventas, caja ni inventario | Ya es así por diseño (kardex inmutable, caja cerrada no se modifica) | — |

---

## 3. Lo que hay que volver a preguntar (corto y concreto)

1. **¿John y Jo venden del mismo cajón?** Si la respuesta es sí, hay que hacer
   la caja compartida (RQ-24) antes de que el cliente venda de verdad, porque si
   no los arqueos no van a cuadrar nunca.
2. ~~¿"Jo" es una persona o es "yo"?~~ **Respondida (2026-09-26):** es
   **María José**, que está en el grupo de WhatsApp del proyecto. John y María
   José son los que autorizan: dos cuentas de administrador.
3. **¿Los "2 lugares" son la sala y una bodega, o dos bodegas más la sala?**
4. **¿Con qué emiten hoy boletas y facturas? ¿Kame?** Si es Kame, pedir acceso
   a su API y cambia todo el plan del módulo tributario.
5. **¿Pueden exportar el catálogo de Kame a Excel y mandarlo?** Con eso la
   carga inicial se hace en una tarde.
6. **Bebidas con impuesto: ¿qué productos y qué tasa?** (azucaradas 18 %, sin
   azúcar 10 %, alcoholes 20,5 % / 31,5 %).
7. **Pago mixto con tarjeta:** cuando pagan parte con tarjeta y parte en
   efectivo, ¿qué papel entregan hoy?

---

## 4. Orden de trabajo

Por daño en el mostrador, no por tamaño.

| Orden | Qué | Por qué primero |
|---|---|---|
| 1 | **RQ-13** lector físico · **RQ-14** vender sin stock y la venta offline que se pierde · **RQ-25** $20.000 sugeridos | Pequeñas y se sienten el primer día. La venta offline perdida es un defecto, no una mejora |
| 2 | **RQ-24** caja compartida | Sin esto el arqueo no cuadra con dos personas en un cajón. Espera la respuesta 1 de §3 |
| 3 | **RQ-15, RQ-16, RQ-17** descuentos con autorización · **RQ-22** pago mixto | Lo que el cajero pide todos los días |
| 4 | **RQ-04 + T-14** precio por mayor y precio validado en la base | Sin T-14 los tramos agrandan el agujero del tope de descuento |
| 5 | **RQ-18, RQ-19** devolución parcial y nota de crédito | Cambios y devoluciones |
| 6 | **RQ-20, RQ-21, RQ-07** clientes y precio por cliente | Se apoya en las anteriores |
| 7 | **RQ-06** impuesto adicional | Espera la respuesta 6 de §3 |
| 8 | **RQ-03** cajas y packs · **RQ-08** promociones | |
| 9 | **RQ-35** devolución a proveedor · **RQ-37** productos desde la factura | |
| 10 | **RQ-02** Kame · **RQ-40** equipos reales | Esperan archivos y visitas |

**Bloqueado fuera del código, en paralelo a todo lo anterior:** B-03 (Railway),
T-50 (correo), B-04/B-05 (certificado y SII), B-09 (rotar llaves).

---

## 5. El celular

Hoy la barra inferior tiene Inicio, Vender, Caja, Inventario y "Más". Todo lo
nuevo de esta lista entra así:

- **POS:** descuentos, pago mixto, cliente y autorización se abren en hojas que
  suben desde abajo (`<Modal>`), sin salir de la venta.
- **Clientes:** dentro de "Más".
- **Devoluciones y notas de crédito:** desde el detalle de la venta, en Ventas.
- **Devolución a proveedor:** desde Proveedores.

Cada pantalla nueva se prueba con `tools/ui/movil.mjs` (360 × 740): sin
desplazamiento horizontal y con los botones de al menos 44 px.

**Primera medición, 2026-09-26** (13 pantallas del administrador y 5 del
vendedor, en celular y computador):

- **Productos no cargaba para un vendedor** (error 400 de la base, en celular
  y en computador). La vista sin costos no tenía las columnas de vencimiento
  que pide la pantalla. Corregido en 0017.
- Las filas de Ventas medían 36 px: el relleno estaba en la fila y no en el
  botón. Corregido.
- "Más" se veía con letra más grande que el resto de la barra. Corregido.
- Hoy: **todas las pantallas pasan**, sin desplazamiento horizontal ni
  objetivos bajo 44 px.
