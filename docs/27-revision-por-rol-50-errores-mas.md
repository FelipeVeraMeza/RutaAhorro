# 27 — Revisión por rol: 50 errores más (ronda 6, del 51 al 100)

**Fecha:** 2026-10-01 · **Versión:** 0.5.2 · **Pedido:** "Sigamos buscando 50
errores más y cuando termines sube las actualizaciones".

Se siguió la numeración de [docs/26](26-revision-por-rol-50-errores.md). Esta
vez se fue primero a lo que la ronda 5 dejó "revisado por encima" (Nueva
factura, Etiquetas, Importar, Mi cuenta y el bloqueo) y después a Compras,
Fiado, Clientes, Caja, Inventario, Ventas, Reportes, Bitácora, Configuración y
las rutas del servidor; además un barrido de tamaños táctiles (RNF-16) por rol
y una búsqueda de fechas calculadas en la zona del celular (regla 17).
**Se paró al llegar al error 100.** Dos errores encontrados después quedaron
anotados abajo, sin corregir.

## Cómo leer la tabla

Igual que docs/26. *Alta*: plata, stock o documentos que quedan mal, o el
usuario no puede terminar lo que hace. *Media*: información engañosa o un paso
que confunde. *Baja*: formato o texto. "Typecheck y recorridos existentes"
quiere decir que se corrigió y nada se rompió, pero **no hay una prueba que lo
demuestre por sí misma** (🟡, regla de docs/17).

| N° | Lo ve | Gravedad | Qué pasaba | Estado | Verificado con |
|---:|---|---|---|---|---|
| 51 | Jefe | Alta | Seguridad: las rutas del servidor que usan la llave de servicio (crear cuenta, invitar, restablecer contraseña, estado de cuentas, claves del SII, PDF de facturas) no revisaban que quien pide siguiera activo: un administrador desactivado con la sesión abierta podía seguir creando cuentas. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 52 | Todos | Alta | Mi contraseña: sin la llave de servicio en el servidor, cambiar la contraseña temporal la cambiaba pero dejaba la marca, y la persona volvía a la pantalla de cambio para siempre. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 53 | Jefe | Alta | Factura manual: el identificador anti-duplicado no se guardaba con el borrador; si la emisión se cortaba y se recargaba la pantalla, la misma factura podía emitirse dos veces. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 54 | Jefe | Baja | Factura manual: la línea del impuesto adicional decía "Imp. adicional 20.5%" (punto decimal). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 55 | Bodega | Media | Etiquetas: el código interno nuevo se calculaba sobre la lista filtrada por la búsqueda (y sin los desactivados): con algo escrito en el buscador, el código "siguiente" chocaba con uno ya usado. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 56 | Bodega | Baja | Etiquetas: los botones + y − de cada producto medían 36 px (RNF-16 pide 44). | Corregido | medido con un barrido táctil puntual (script no versionado: sin prueba propia) |
| 57 | Todos | Media | Botones "chicos" (btn-chico) de 36 px en los encabezados (Nuevo producto, Crear cuenta, Nuevo cliente, Exportar, Recibir mercadería, Dar crédito…) y en los "Ir a…" de Ayuda: bajo los 44 px de RNF-16. | Corregido | medido con un barrido táctil puntual (script no versionado: sin prueba propia) |
| 58 | Todos | Baja | Mi cuenta: los enlaces a Ayuda y Novedades medían 16 px de alto. | Corregido | medido con un barrido táctil puntual (script no versionado: sin prueba propia) |
| 59 | Todos | Baja | Mi cuenta: el selector de bloqueo medía 39 px; Ayuda: el enlace a Novedades, 16 px. | Corregido | medido con un barrido táctil puntual (script no versionado: sin prueba propia) |
| 60 | Bodega | Baja | Importar: "El archivo pesa 5.2 MB" con punto decimal. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 61 | Bodega | Media | Importar: una planilla sin SKU con productos que ya existen (identificados por su código de barras) no los actualizaba: cada fila fallaba con "ese código ya está en otro producto". | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 62 | Todos | Alta | Pantalla bloqueada: permitía probar contraseñas sin límite (el ingreso pausa tras 5 fallos, RF-M1-17); sin red, contra la huella guardada en el celular. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 63 | Vendedor | Media | Pantalla bloqueada: "Es otra persona: salir" no hacía nada visible con la caja abierta; el aviso de caja (ronda 5) quedaba debajo del bloqueo. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 64 | Bodega/Jefe | Alta | Compras (base): anular una recepción sacaba el stock pero dejaba el lote con la cantidad recibida: Vencimientos seguía mostrando mercadería que ya no existía. | Corregido | pg-test: anular-recepcion.test.mjs |
| 65 | Jefe | Alta | Compras (base): anular una recepción dejaba su factura por pagar pendiente: el Inicio seguía avisando "por pagar" una deuda de una compra anulada. | Corregido | pg-test: anular-recepcion.test.mjs · demo-ronda6 |
| 66 | Jefe | Alta | Compras (base): anular una recepción (p. ej. por un costo mal escrito, 8000 en vez de 800) no devolvía el costo promedio: el margen quedaba mal para siempre. | Corregido | pg-test: anular-recepcion.test.mjs |
| 67 | Bodega | Alta | CRÍTICO (base): recibir cualquier producto con vencimiento fallaba con "REGISTRO_INMUTABLE": fn_confirm_receipt le anota el lote al movimiento del kardex y el disparador de inmutabilidad rechazaba también eso. Se permite solo anotar el lote una vez; todo otro cambio sigue rechazado. | Corregido | pg-test: anular-recepcion.test.mjs |
| 68 | QA (maqueta) | Media | Compras (maqueta): anular una recepción solo la marcaba anulada: no sacaba el stock ni devolvía el costo; y el texto del diálogo decía "se devolverá el stock al valor anterior" (no se entendía qué pasaba con la factura). | Corregido | demo-ronda6 (el aviso; el stock de la maqueta no, ver "Después del 100") |
| 69 | Bodega | Media | Recibir mercadería: el vencimiento de la factura por pagar no se guardaba con la recepción a medio cargar; al volver de crear un producto, la factura se confirmaba sin quedar por pagar. | Corregido | demo-ronda6 |
| 70 | Bodega | Media | Recibir mercadería: quitar una línea (o "Vaciar") y volver a agregar el producto mostraba la cantidad y el costo escritos antes, pero contaba 1 y el costo anterior. | Corregido | demo-ronda6 |
| 71 | Jefe | Media | Ofertas: crear una oferta "desde 1 unidad" sin fechas mostraba "Ocurrió un problema inesperado": el traductor de errores cortaba el código en el dígito ("OFERTA_SIN_FECHAS_DESDE_") y no encontraba el mensaje que sí existía. | Corregido | core: validaciones.test.ts |
| 72 | Jefe | Baja | Facturación: el error FACTURA_NO_EN_EMISION (dos personas confirmando la misma emisión) no tenía mensaje: salía el genérico. | Corregido | core: validaciones.test.ts |
| 73 | Jefe | Baja | Fiado: "Dar crédito a un cliente" quedaba desactivado sin explicación cuando no había clientes sin crédito, y el mensaje de la lista vacía mandaba justo a ese botón. Ahora abre y dice que primero se agrega el cliente en Clientes (con el enlace). | Corregido | demo-ronda6 |
| 74 | Jefe | Media | Clientes: si al crear un cliente nuevo fallaban sus precios especiales (p. ej. sin red a medio guardar), tocar "Guardar" de nuevo creaba otro cliente igual. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 75 | Jefe | Media | Clientes: el correo se guardaba sin revisar ("juan.gmail.com"), y es a donde se manda la factura. | Corregido | demo-ronda6 |
| 76 | Vendedor | Alta | Caja: "Cerrar caja" comparaba lo contado contra el "debería haber" de cuando se abrió la pantalla; con ventas hechas después, decía "Faltante" aunque cuadrara (la base guarda el correcto). Ahora se actualiza al entrar al cierre. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 77 | Vendedor | Media | Caja: al pasar a "Contar por billete" con un total ya escrito, el "Total contado" mostraba ese total sin ningún billete contado. | Corregido | demo-ronda6 |
| 78 | Vendedor | Media | Caja: un egreso mayor que el efectivo que debería haber se registraba sin ningún aviso (un cero de más). | Corregido | demo-ronda6 |
| 79 | Bodega | Baja | Inventario: la fecha de la hoja de conteo impresa salía en la zona del celular y con el formato del navegador ("1/10/2026"), no el día del local (regla 17). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 80 | Jefe | Media | Devolver productos: una cantidad mal escrita ("2x") se ignoraba en silencio y se devolvía solo lo de las otras líneas, sin aviso. | Corregido | typecheck y recorridos existentes (sin prueba propia) · la maqueta no lleva devoluciones |
| 81 | Jefe | Baja | Devolver productos, Anular venta y Dar de baja un lote: el motivo era obligatorio (el botón no se activaba sin él) pero el campo no lo marcaba: no se entendía por qué no se podía devolver. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 82 | Jefe | Media | Reportes: en las planillas exportadas (Ventas detalladas, Anulaciones y devoluciones) la fecha iba como "30-09 22:50", sin año: el contador no podía ordenar ni filtrar un rango que cruzara de año. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 83 | Jefe | Baja | Bitácora: un error de carga (p. ej. sin red) quedaba pegado arriba aunque la consulta siguiente funcionara. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 84 | QA (maqueta) | Baja | Bitácora (maqueta): la fila de ejemplo (un cambio de precio) aparecía con cualquier filtro, también con "Anulaciones". | Corregido | demo-ronda6 |
| 85 | Jefe | Baja | Configuración: con 0 horas o 0 % en los avisos, "Guardar" quedaba desactivado sin ningún mensaje que dijera por qué. | Corregido | demo-ronda6 |
| 86 | Jefe | Media | Configuración → Boletas y facturas: el código de actividad escrito como lo muestra el SII ("47.11.00") hacía fallar el guardado con "Ocurrió un problema inesperado". | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 87 | Jefe | Baja | Configuración → Mis datos: el archivo del respaldo se nombraba con el día de UTC; de noche decía la fecha de mañana (regla 17). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 88 | QA (maqueta) | Baja | Reportes → Ajustes (maqueta): el impacto de cada ajuste se calculaba con el costo del primer producto que hubiera, no con el del ajustado; y salían ajustes de cualquier fecha, sin mirar el rango. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 89 | Vendedor | Media | Comprobante: la fecha y hora impresas (y las del texto para WhatsApp) salían en la zona del celular; un equipo con otra zona imprimía otra hora, y de noche otro día (regla 17). | Corregido | core: comprobante.test.ts |
| 90 | Bodega | Baja | Etiquetas: la fecha del cartel de góndola salía en la zona y el formato del celular ("1/10/2026"), no el día del local (regla 17). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 91 | Vendedor | Media | Ventas sin registrar: cada venta rechazada mostraba solo la hora (en la zona del celular); una de ayer no se distinguía de una de hoy. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 92 | QA (maqueta) | Baja | Facturación (maqueta): la fecha de emisión de una factura se tomaba del celular, no del local (regla 17). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 93 | Jefe | Media | Facturas recibidas: si la factura se registraba pero no alcanzaba a quedar en Por pagar, el botón seguía diciendo "Registrar" y tocarlo otra vez la volvía a registrar. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 94 | Vendedor | Media | Consultar precio y Ofertas de varios productos: una oferta desde una cantidad con decimales se escribía con punto ("Desde 1.5", que en Chile se lee mil quinientos), y en granel decía "c/u" en vez de "el kg". | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 95 | Jefe | Media | Facturación → Resumen por mes: "Exportar" revocaba el archivo en la misma vuelta del clic; en Safari de iPhone la descarga se cancelaba (el arreglo de Reportes e Importar no había llegado acá). | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 96 | Jefe | Baja | Ventas → documento: "Descargar XML" tenía el mismo problema en Safari de iPhone. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 97 | Jefe | Baja | Por pagar: el "adeudado por proveedor" agrupaba por nombre: dos proveedores distintos con el mismo nombre salían sumados en una fila. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 98 | Jefe | Baja | Por pagar: "Ver pagadas (30)" mostraba solo las 30 últimas y decía 30 aunque hubiera más pagadas. | Corregido | typecheck y recorridos existentes (sin prueba propia) |
| 99 | Jefe | Media | Configuración: al marcar o desmarcar un interruptor (vender sin stock, tarjeta emite documento, ofertas), la casilla se volvía a crear y quien usa teclado o lector de pantalla perdía el foco. | Corregido | demo-ronda6 |
| 100 | Jefe | Media | Por pagar → Registrar factura: aceptaba una fecha de emisión futura (un año mal tecleado), y el vencimiento sugerido "30 días" se calculaba desde esa fecha. | Corregido | demo-ronda6 |

## Resumen

| | Cantidad |
|---|:-:|
| Alta | 9 |
| Media | 22 |
| Baja | 19 |
| Corregidos | 50 |
| Con prueba propia (✅) | core, pg-test o demo-ronda6: 64–67, 69–73, 75, 77, 78, 84, 85, 89, 99, 100 y el aviso de 68 |

## Lo más grave, en una línea cada uno

- **N° 67 · Recibir cualquier producto con vencimiento fallaba en la base.**
  `fn_confirm_receipt` (0006/0012) le anota el lote al movimiento del kardex
  con un UPDATE, y el disparador de inmutabilidad (0003) lo rechazaba. Nunca
  se vio porque las pruebas recibían productos sin vencimiento. La 0031 deja
  pasar SOLO ese cambio (lot_id de null a un valor, nada más); todo otro
  UPDATE y todo DELETE siguen rechazados, y la prueba lo comprueba.
- **N° 64 a 66 · Anular una recepción dejaba el lote, el costo promedio y la
  factura por pagar como si no se hubiera anulado.** 0031 redefine
  `fn_void_receipt` (misma firma): rebaja el lote, devuelve el costo
  promedio, anula la factura pendiente y avisa si ya estaba pagada.
- **N° 51 · Un administrador desactivado con la sesión abierta seguía
  pudiendo crear cuentas** y cambiar claves por las rutas del servidor.
- **N° 53 · La factura manual podía emitirse dos veces** si se cortaba y se
  recargaba (el identificador anti-duplicado no se guardaba con el borrador).
- **N° 62 · La pantalla bloqueada dejaba probar contraseñas sin límite.**
- **N° 76 · El cierre de caja comparaba contra un "debería haber" viejo.**

## Migración nueva: 0031 (sin aplicar en Supabase)

`supabase/migrations/0031_anular_recepcion_completa.sql`:
- `fn_void_receipt(uuid, text)`: misma firma (no crea sobrecarga, regla 21).
  Bloquea stock y producto (regla 15), recalcula `avg_cost`
  (`(avg·stock − cant·costo)/(stock − cant)` si queda stock y no da negativo),
  rebaja el lote (`greatest(cantidad − recibida, 0)`), anula la factura de
  proveedor de esa recepción si no está pagada y responde `factura_ya_pagada`.
- `fn_kardex_inmutable()` reemplaza a `fn_block_modify` SOLO en
  `inventory_movements` (la bitácora y el historial de precios siguen con la
  de siempre). `revoke execute … from public, anon, authenticated` (regla 12).

**Antes de aplicarla:** revisar el esquema en vivo (que `fn_void_receipt` y el
disparador sean los de 0012/0003) y que 0029 y 0030 ya estén aplicadas.

## Después del 100 (encontrados, sin corregir)

- **Maqueta · el catálogo se vuelve a sembrar en cada carga de página.**
  `SyncCatalogo` llama a `sembrarCatalogoDemo()` al montar, y esa función
  borra y recarga los productos con el stock de ejemplo. Todo lo que mueve
  stock en la maqueta (recibir, ajustar, vender, anular) se pierde al
  recargar o entrar desde un enlace. Arreglo propuesto: sembrar solo si el
  catálogo está vacío o si cambió la versión de los datos de ejemplo.
- **Maqueta · "Devolver productos" abre vacío.** La maqueta no lleva
  devoluciones (`devolver()` responde NO_DISPONIBLE_EN_DEMO) y sus ventas no
  traen el id de cada línea, así que el diálogo no muestra nada que devolver
  y tampoco dice por qué. Arreglo propuesto: en la maqueta, esconder el botón
  o decir que ahí no se puede.

## Verificación

Ver la sección de la 6ª ronda en HANDOFF.md.
