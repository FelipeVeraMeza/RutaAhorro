# 26 — Revisión por rol: 50 errores (ronda 5)

**Fecha:** 2026-10-01 · **Versión:** 0.5.1 · **Pedido:** "revisa el sistema como lo
usaría cada rol (jefe, QA, vendedor), busca errores en flujos, botones e
información, corrige… cuando encuentres 50 errores paras".

Se revisó el sistema en modo demo, a 360 px y por rol (admin, supervisor,
vendedor, bodega), leyendo además el código de cada pantalla y las funciones
de la base. **Se paró al llegar al error 50.** No es una auditoría completa:
quedaron pantallas revisadas por encima (Facturación → Nueva factura,
Etiquetas, Importar, Mi cuenta) y la conexión real con Supabase no se probó.

## Cómo leer la tabla

- **Gravedad.** *Alta*: plata, stock o documentos que quedan mal, o el usuario
  no puede terminar lo que hace. *Media*: información engañosa o un paso que
  confunde. *Baja*: formato o texto.
- **Verificado con.** El archivo que lo demuestra corregido. "Typecheck y
  recorridos existentes" quiere decir que se corrigió y que nada se rompió,
  pero **no hay una prueba que lo demuestre por sí mismo** (regla de docs/17:
  eso es 🟡, no ✅).

| N° | Lo ve | Gravedad | Qué pasaba | Estado | Verificado con |
|---:|---|---|---|---|---|
| 1 | Vendedor | Media | Caja: "quedó abierta de otro día" compara días en la zona del navegador, no la del local (regla 17). | Corregido | demo-ronda5 (celular en UTC) |
| 2 | Vendedor | Baja | Caja: egresos se muestran "$-5.000" (en Movimientos dice "−$5.000"). | Corregido | demo-ronda5 |
| 3 | Vendedor | Baja | Caja: medio fiado decía "Fiado (no entra a la caja) · no entra al cajón" (repetido). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 4 | QA (maqueta) | Baja | Caja demo: el cierre con diferencia no guarda ni exige la nota (la base sí la exige). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 5 | Vendedor | Media | Vender: "Quitar" (o "−" hasta cero) sacaba la línea sin "Deshacer", aunque Ayuda y RF-M5-24 dicen que se recupera. | Corregido | demo-ronda5 |
| 6 | Vendedor | Alta | Vender: "Vaciar" dejaba elegido al cliente; la venta siguiente salía a su precio mayorista. | Corregido | demo-ronda5 |
| 7 | Vendedor | Baja | Vender: frescura de precios decía "hace 1 días". | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 8 | Vendedor | Alta | Vender: agregar un producto sin stock (sin permiso para forzar) decía ✓; recién fallaba al cobrar. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 9 | Vendedor | Media | Vender: el aviso y la búsqueda mostraban el precio normal aunque el cliente elegido pagara menos. | Corregido | demo-ronda5 |
| 10 | Jefe | Alta | Inicio: "vs el miércoles pasado (hoy)" comparaba lo que va de hoy con el día completo de la semana pasada (−84 % todos los días antes de cerrar). | Corregido | core: tendencia.test.ts |
| 11 | Todos | Media | Fechas con hora: "30/9, 22:50" en Chrome y "30-09, 22:50" en el servidor; el mismo dato se veía distinto según el equipo. | Corregido | demo-ronda5 |
| 12 | Jefe | Media | Productos/Recepción: porcentajes con punto decimal ("25.7%"); en Chile el punto separa miles. | Corregido | core: money.test.ts · demo-ronda5 |
| 13 | Jefe | Alta | Margen: se calcula contra el precio CON IVA y en ninguna parte se dice si el costo es neto o con IVA (si es neto, el margen mostrado incluye el IVA). Decisión de negocio: pregunta abierta. | Pregunta de negocio | — |
| 14 | Bodega | Media | Inventario: con la bodega vacía el botón decía "Reponer" y abría pasar de la sala A la bodega (al revés). | Corregido | demo-ronda5 · demo-datos |
| 15 | Vendedor | Alta | Vender: un producto con un lote vencido (yogurt "venció hace 2 días" en el Inicio) se vendía sin ningún aviso, y la base descuenta la venta del lote vencido primero. | Corregido | demo-ronda5 |
| 16 | Jefe | Baja | Ventas (detalle): la cantidad salía cruda ("0.35 ×"), con punto, en vez de "0,35". | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 17 | Jefe | Media | Ventas (detalle): una venta redondeada decía "Total $1.463 · Pagado con Efectivo $1.460" sin explicar la diferencia. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 18 | Supervisor | Media | Ventas: el supervisor veía "Anular" en ventas de otros días, que la base no le deja anular (error al confirmar). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 19 | Jefe | Media | Bitácora: las entradas de configuración, clientes, combos, devoluciones, fiado y facturas salían como "editar"/"crear"/"pagar" a secas, sin decir qué ni detalle, y no se podían filtrar. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 20 | QA (maqueta) | Baja | Reportes (maqueta): Productos sumaba $1.011.800 y Ventas $4.799.869 para el mismo período. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 21 | Jefe | Baja | Reportes · Productos: "1 vendidas" y cantidades por kilo con punto decimal. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 22 | Todos | Media | Búsquedas sin tildes (RF-M2-20) solo en Productos y Vender: en Clientes, elegir cliente en Vender, Fiado, combos, ofertas masivas, configuración y facturas "jose" no encontraba a "José". | Corregido | core: money.test.ts · demo-ronda5 |
| 23 | Vendedor | Alta | Cobrar: cuando la venta no se registraba (falta stock o la base la rechaza) el aviso quedaba DETRÁS del diálogo de cobro; el cajero tocaba "Confirmar" y no veía nada. | Corregido | demo-ronda5 |
| 24 | Vendedor | Media | Vender: subir la cantidad con "+" por sobre el stock no avisaba (solo al escanear); se descubría al cobrar. | Corregido | demo-ronda5 |
| 25 | Supervisor | Alta | Inicio del supervisor: mostraba el valor al costo de lo que vence ("$120.710 en riesgo" y cada lote), y el supervisor no debe ver costos. | Corregido | demo-ronda5 |
| 26 | Jefe | Media | Inicio: "$X en riesgo" sumaba solo los lotes mostrados en el panel, sin decirlo, cuando había más. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 27 | Jefe | Media | Fiado: "Dar crédito a un cliente" ofrecía clientes desactivados. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 28 | Vendedor | Baja | Consultar precio: "a la vista" mostraba la cantidad cruda (0.35) y no avisaba de lotes vencidos. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 29 | Vendedor/Jefe | Alta | Sin internet: una venta que la base rechazaba al sincronizar quedaba como "por sincronizar" para siempre; nadie veía el motivo y el arqueo no cuadraba. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 30 | Todos | Baja | Cantidades por kilo con punto y sin formato ("0.35") en Inventario, Movimientos, Devolución, Recepción y la búsqueda de Vender. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 31 | QA (maqueta) | Baja | Maqueta: el comprobante decía "N° pendiente de sincronizar" en ventas registradas al instante (la maqueta no devolvía el folio). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 32 | Jefe | Media | Usuarios: cambiar el rol o desactivar a alguien se aplicaba al primer toque, sin confirmar. | Corregido | demo-ronda5 |
| 33 | Jefe | Alta | Facturas de proveedor: la misma factura se escribía dos veces, en Facturación → Recibidas (IVA) y en Compras → Por pagar (vencimiento). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 34 | Todos | Media | Menú: decía "Proveedores" y la pantalla a la que lleva se titula "Compras". | Corregido | demo-ronda5 |
| 35 | Todos | Media | Ayuda: nombraba botones que no existen ("Proveedores → Recepción", "Nueva cuenta"; los reales son "Recibir mercadería" y "Crear cuenta"). | Corregido | demo-ronda5 |
| 36 | QA (maqueta) | Baja | Maqueta: "vence mañana" mostraba la fecha de pasado mañana desde las 21:00 (fechas de lotes calculadas en UTC, regla 17). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 37 | Vendedor | Media | Salir: no avisaba que la caja propia quedaba abierta (así nacen las cajas olvidadas de RF-M8-08). | Corregido | demo-flujo |
| 38 | Bodega | Media | Recibir mercadería: con factura a crédito pero sin proveedor o sin N°, confirmaba la recepción y recién después avisaba que la factura no quedó por pagar. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 39 | Jefe | Alta | Devolución en efectivo de una venta redondeada: devolvía el monto exacto ($1.463 por una venta cobrada $1.460), más de lo pagado y con pesos que no existen en monedas. | Corregido | pg-test: redondeo-fiado.test.mjs |
| 40 | Jefe | Baja | Productos → Exportar: el archivo se llamaba con la fecha de UTC (desde las 21:00, la de mañana). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 41 | Supervisor | Media | Resumen por WhatsApp: el del supervisor llevaba el valor al costo de lo que vence (y solo de los lotes del panel), sin el nombre del local, y decía "1 productos". | Corregido | demo-ronda5 |
| 42 | Jefe | Media | Combos: aceptaba "1,5" de un producto que se vende por unidad. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 43 | Bodega | Alta | Inventario (ajuste, toma, reponer) y stock inicial del producto: aceptaba "2,5" en productos que se cuentan por unidad; el stock quedaba con medias botellas. | Corregido | core: money.test.ts (validarCantidadStock) |
| 44 | Bodega | Media | Recibir mercadería: una cantidad mal escrita quedaba en 0 sin decir nada (el botón Confirmar se apagaba sin explicación) y aceptaba "2,5" en productos por unidad. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 45 | Bodega/Jefe | Alta | Recibir mercadería: el costo se leía con parseCLP (regla 9): "1990,5" quedaba en $19.905 y movía el costo promedio sin aviso. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 46 | Vendedor | Alta | Cobrar: el monto recibido se leía con parseCLP (regla 9): "20000,5" quedaba en $200.005 y "-5000" no se rechazaba. | Corregido | demo-ronda5 · core |
| 47 | Todos | Alta | Causa de fondo de 45 y 46: validarMonto (core) aceptaba "20000,5" como $200.005 y "1.5" como $15 en TODOS los campos de dinero (caja, precios, abonos, facturas). La regla 9 confiaba en él. | Corregido | core: money.test.ts |
| 48 | Vendedor | Media | Comprobante de una venta hecha sin internet: decía "Venta registrada" aunque todavía no llegaba al sistema. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 49 | Jefe/Bodega | Alta | Qué comprar: con la cantidad en 0, vacía o mal escrita, el pedido por WhatsApp llevaba igual la cantidad sugerida. | Corregido | demo-ronda5 |
| 50 | Jefe | Media | Ventas y Caja: lo fiado aparecía como un medio más en "Cobrado por medio de pago", aunque no se cobró. | Corregido | typecheck y recorridos existentes (sin prueba propia) |

## Resumen

| | Cantidad |
|---|:-:|
| Alta | 15 |
| Media | 23 |
| Baja | 12 |
| Corregidos | 49 |
| Pregunta de negocio (sin corregir) | 1 (N° 13) |

## Lo más grave, en una línea cada uno

- **N° 47 · `validarMonto` aceptaba "20000,5" como $200.005.** La regla 9
  descansaba en él: cualquier campo de dinero (caja, precios, abonos, costos,
  facturas) leía mal una coma. Ahora rechaza la coma y los puntos que no
  separan miles.
- **N° 29 · Una venta sin internet rechazada al sincronizar quedaba "por
  sincronizar" para siempre.** La plata en el cajón y la venta en ninguna
  parte. Ahora la barra dice cuántas no se registraron y por qué.
- **N° 39 · Devolver en efectivo una venta redondeada devolvía el exacto.**
  Corregido en 0029 (todavía no aplicada en Supabase).
- **N° 15 · Se vendía un producto con lote vencido sin aviso.** Ahora Vender y
  Consultar precio lo dicen; el celular recibe el vencimiento más próximo con
  el catálogo.
- **N° 25 y 41 · El supervisor veía costos** (valor en riesgo de lo que
  vence) en el Inicio y en el resumen de WhatsApp.

## La pregunta de negocio (N° 13)

El margen de Productos, del formulario y de Reportes se calcula como
`(precio − costo) / precio`, con el precio **con IVA**. Si el costo que se
escribe al recibir es **neto** (como en la factura del proveedor), el margen
que ve el dueño incluye el 19 % del IVA, que no es suyo: un producto de $2.490
con costo neto $1.850 muestra 25,7 % y en realidad deja 11,6 %. **Hay que
decidir**: ¿el costo se ingresa con o sin IVA? Según la respuesta, se rotula el
campo y se ajusta el cálculo.
