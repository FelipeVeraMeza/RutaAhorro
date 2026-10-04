# 28 — Revisión por módulo (ronda 7, del 101 al 181)

**Fecha:** 2026-10-04 · **Versión:** 0.7.0 · **Pedido:** "Revisa el sistema
como lo usaría cada rol (jefe, QA, vendedor), busca errores en flujos, botones
e información, corrige, verifica con las pruebas y los recorridos, documenta
con honestidad… Encuentra 100 falencias en cada módulo".

## Lo primero, con honestidad: no son 100 por módulo

Se pidieron 100 falencias **por módulo** (unas 1.000). Se encontraron
**81 reales**, y no se rellenó la lista: después de seis rondas
anteriores (docs/26 y 27, 100 errores ya corregidos), inventar o partir en
pedazos defectos para llegar a la cifra habría sido mentir en el documento que
se usa para decidir. Lo que sí se hizo fue ir más hondo que las rondas
anteriores: además de recorrer cada pantalla por rol, se leyó **cada consulta
a la base** buscando lo que la pantalla no muestra, y las funciones de la base
que mueven plata y permisos. De ahí salieron los más graves:

- **Dos agujeros de seguridad críticos en la base** (N° 156 y 168): cualquiera
  con la llave pública podía crearse una cuenta de administrador de un local
  conociendo su id, y desactivar a un usuario no le cortaba el acceso por la
  API. Los corrige la migración **0037**.
- **Una familia de defectos silenciosos** (N° 120 a 126, 140, 146, 147, 152,
  153, 166, 167): la API de Supabase entrega como máximo **1.000 filas** y corta
  sin avisar, y la lista de productos pedía 200. Con un catálogo o un mes más
  grande que eso, el escáner no encontraba productos, Productos filtraba
  "Agotados" sobre los 200 primeros, Reportes daba utilidad corta, el respaldo
  salía incompleto y el Inicio dejaba de avisar facturas por pagar. Ninguna
  prueba lo veía porque la maqueta tiene 15 productos.
- **Ventas que se podían perder o duplicar** con la red intermitente (N° 101 a
  103, 111, 172).
- **Importar una planilla de precios borraba costos, mínimos y categorías** de
  los productos existentes (N° 179).

| Módulo | Hallazgos |
|---|---:|
| M1 · Usuarios, ingreso y sesiones | 7 |
| M2 · Catálogo de productos | 10 |
| M3 · Compras y proveedores | 12 |
| M4 · Inventario y stock | 9 |
| M5 · Punto de venta (y fiado, clientes) | 23 |
| M6 · Caja | 8 |
| M7 · Reportes | 2 |
| M8 · Alertas (Inicio) | 2 |
| M9 · Administración, respaldo y ayuda | 5 |
| M10 · Trabajo simultáneo | 1 |
| QA · Maqueta y herramientas | 2 |
| **Total** | **81** |

Por gravedad: 2 críticas, 17 altas,
34 medias, 28 bajas. Corregidos: 80; una es
pregunta de negocio (N° 170).

M7, M8 y M10 tienen pocos hallazgos propios porque varios de sus defectos se
anotaron en el módulo donde se corrigieron (los cortes de 1.000 filas de
Reportes, la carrera de la cola de ventas, la marca de edición de Etiquetas).

## Cómo leer la tabla

Igual que docs/26 y 27. *Crítica*: un tercero o un ex empleado entra donde no
debe. *Alta*: plata, stock o documentos que quedan mal, o el usuario no puede
terminar lo que hace. *Media*: información engañosa o un paso que confunde.
*Baja*: formato o texto. **"typecheck" o "sin prueba propia" quiere decir que
se corrigió y nada se rompió, pero que no hay una prueba que lo demuestre por
sí misma** (🟡, regla de docs/17). "pg (…, sin correr acá)" quiere decir que
la prueba contra PostgreSQL está escrita pero **no se pudo correr** en esta
sesión (ver abajo).

| N° | Módulo | Lo ve | Gravedad | Qué pasaba | Estado | Verificado con |
|---:|---|---|---|---|---|---|
| 101 | M5 | Vendedor | Alta | Cola sin conexión: una venta que quedaba en estado "enviando" (pestaña cerrada, celular apagado o pantalla recargada a mitad del envío) no se volvía a enviar nunca ni se contaba como pendiente: la plata en el cajón y la venta en ninguna parte. | Corregido | demo-ronda7 |
| 102 | M5 | Vendedor | Alta | Cobrar justo mientras corría la sincronización automática (cada 60 s): la venta no se enviaba, el comprobante se entregaba sin esperar a la base (regla 19) y salía un minuto después, cuando ya podía ser rechazada. Ahora el cobro espera la pasada en curso y hace otra. | Corregido | typecheck (sin prueba propia: es una carrera) |
| 103 | M5 | Vendedor | Alta | Un corte de red durante el envío se trataba como rechazo: la venta salía de la cola y el cajero cobraba de nuevo; si sí había llegado a la base, quedaba dos veces. Ahora queda pendiente (sin conexión) y se reenvía con el mismo identificador, que la base deduplica. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 104 | M5 | Vendedor | Alta | Un descuento mayor que la línea (p. ej. después de bajar la cantidad) se restaba de las otras líneas en pantalla, pero la base deja la línea en $0: la pantalla cobraba menos que la base y la venta fallaba con "el pago no cuadra". | Corregido | core: cart.test.ts |
| 105 | M5 | Vendedor | Media | El descuento de una línea quedaba fijo en pesos al cambiar la cantidad: $3.000 de descuento a 3 bebidas de $1.000, bajando a 1, regalaba la bebida. Ahora sigue a la cantidad en la misma proporción. | Corregido | core: cart.test.ts |
| 106 | M5 | Vendedor | Baja | Buscador con lector físico: Enter podía agregar el producto de la búsqueda anterior (la lista se actualiza aparte y llegaba después del Enter). | Corregido | typecheck (sin prueba propia) |
| 107 | M5 | Vendedor | Baja | Línea del carrito: "· stock -3" con el número crudo; ahora "en bodega 0", como el resto de la pantalla. | Corregido | typecheck |
| 108 | M5 | Vendedor/Jefe | Media | Comprobante (venta y copia): era un diálogo escrito a mano (regla 10): Escape no lo cerraba, el foco no quedaba adentro (Tab llevaba a los botones de Vender, detrás) y no volvía al salir. | Corregido | demo-ronda7 |
| 109 | M5 | Vendedor | Baja | Cobrar: Enter ("Listo" del teclado del celular) en "¿Con cuánto paga?" no hacía nada; había que bajar al botón. | Corregido | demo-ronda7 |
| 110 | M5 | Vendedor | Baja | Pedir autorización: con un solo supervisor con PIN, quedaba elegido aunque su tope no alcanzara (botón desactivado y marcado) y el PIN fallaba sin explicar. Ahora dice que nadie alcanza. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 111 | M6 | Vendedor | Alta | Cerrar caja con ventas sin conexión todavía en el celular: llegaban después a una caja cerrada (CAJA_NO_ABIERTA), la plata ya contada como sobrante y la venta rechazada. Ahora el cierre envía la cola primero y no deja cerrar con ventas pendientes. | Corregido | typecheck (la maqueta no cierra contra la base) |
| 112 | M6 | Jefe | Media | Resumen de cierre impreso: no traía ventas en efectivo, ingresos ni egresos; el papel no sumaba el "debía haber" que decía. El redondeo aparecía como si se sumara aparte. | Corregido | demo-ronda7 |
| 113 | M6 | Jefe | Baja | Resumen de cierre: la hora de "Cerrada" era la de cada vez que se dibujaba la pantalla (cambiaba al imprimir más tarde). | Corregido | typecheck |
| 114 | M6 | Jefe | Baja | Cerrar la caja de otro: no mostraba cuánto falta o sobra antes de confirmar, como el cierre propio. | Corregido | typecheck (la maqueta no lleva cajas ajenas) |
| 115 | M6 | QA | Baja | Caja calculaba "hoy" en la zona del celular para algo que solo servía de bandera (regla 17); quedaba como trampa para el siguiente. | Corregido | typecheck |
| 116 | M5 | Jefe | Media | Copia del comprobante (Ventas): el descuento salía al doble (la base ya suma el de las líneas en el total de descuentos y la copia lo volvía a sumar): subtotal − descuento no daba el total. | Corregido | typecheck (sin prueba propia: la maqueta no guarda descuentos totales) |
| 117 | M5 | Jefe | Media | Copia del comprobante: el neto era total − IVA, con el impuesto adicional (IABA, ILA) adentro, y la línea del impuesto no salía. Ahora usa el neto y el detalle que guardó la base. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 118 | M5 | Jefe | Baja | Copia del comprobante: no traía cuánto pagó el cliente ni el vuelto. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 119 | M5 | Jefe | Baja | Devolver productos: la cantidad abría el teclado con coma decimal, aunque desde 0032 todo es por unidad. | Corregido | typecheck |
| 120 | M5 | Vendedor | Alta | Catálogo del celular: el stock, los lotes, las ofertas y los CÓDIGOS DE BARRAS se bajaban en una sola consulta, que la API corta en 1.000 filas sin avisar. Con más de 1.000 códigos, escanear los demás decía "no está en el catálogo" y el stock quedaba viejo. Ahora se bajan por páginas. | Corregido | typecheck (sin prueba propia: necesita Supabase con más de 1.000 productos) |
| 121 | M5 | Vendedor | Media | Catálogo del celular: lo que cambió se pedía "desde la hora del celular": un celular con la hora adelantada se saltaba para siempre los cambios de precio de esos minutos. Ahora parte del último cambio que mandó la base. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 122 | M2 | Jefe/Bodega | Alta | Productos: la lista traía los 200 primeros por nombre y SOBRE ESOS filtraba "Agotados"/"Bajo mínimo", ordenaba por precio, contaba "Revisar datos" y exportaba la planilla. Con 3.000 productos, un agotado que empieza con "S" no aparecía nunca y la planilla exportada venía corta. Ahora trae todos (por páginas) y dibuja de a 200 con "Ver más". | Corregido | demo-ronda7 (el "Ver más" en la maqueta; el corte de la API necesita Supabase) |
| 123 | M3 | Jefe | Alta | Qué comprar, Ofertas masivas, Combos y la copia de respaldo de Configuración pedían 5.000 productos y recibían 1.000 (la API corta ahí): lo que pasaba del mil no se sugería comprar ni se podía elegir. | Corregido | typecheck (sin prueba propia: necesita Supabase con más de 1.000 productos) |
| 124 | M4 | Bodega | Alta | Inventario: la lista (y la hoja para contar a mano) traía 200 productos; Etiquetas calculaba el "siguiente código interno" sobre 200: con más productos, el código nuevo podía chocar con uno existente. Mismo arreglo que 122. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 125 | M7 | Jefe | Alta | Reportes: más vendidos y utilidad (una fila por producto y día), ventas por vendedor, inventario valorizado, productos sin movimiento y ajustes se cortaban en 1.000 filas sin avisar: en un mes normal el ranking y la utilidad salían cortos, y el inventario valorizado de un local con más de mil productos, también. | Corregido | typecheck (sin prueba propia: necesita Supabase con más de 1.000 filas) |
| 126 | M4 | Bodega | Media | Vencimientos (lotes) y el conteo de productos por impuesto adicional: mismo corte de 1.000 filas. | Corregido | typecheck (sin prueba propia) |
| 127 | M4 | Bodega | Media | Toma de inventario: lo contado con otro filtro de búsqueda aparecía en la revisión como "Producto · 0 → 5 (+5)": la pantalla mostraba una diferencia y la base aplicaba otra. Ahora recuerda cada producto que pasó por la lista. | Corregido | typecheck (sin prueba propia) |
| 128 | M4 | Bodega | Media | Ajuste de stock: "Registrar como merma" con una cantidad MAYOR que la del sistema dejaba una "merma" que sumaba stock. La base lo aceptaba también (ver 0037). | Corregido | typecheck · pg (0037, sin correr acá) |
| 129 | M4 | Bodega | Media | Movimientos (kardex): decía "historial completo" y mostraba los últimos 80, sin forma de ver los anteriores. Ahora "Ver movimientos anteriores". | Corregido | typecheck |
| 130 | M4 | Bodega | Baja | Inventario: un error de carga (sin red) quedaba pegado arriba aunque la carga siguiente funcionara. | Corregido | typecheck |
| 131 | M4 | Jefe | Baja | Inventario: "Valor al costo" y "Bajo mínimo" se calculaban sobre lo buscado sin decirlo: con "coca" escrito, el valor del inventario era el de las Coca-Cola. | Corregido | typecheck |
| 132 | M4 | Bodega | Baja | Hoja para contar: con algo escrito en el filtro salía parcial sin decirlo; y el saldo del kardex salía sin formato. | Corregido | typecheck |
| 133 | M2 | Jefe | Media | Nuevo producto: si el producto se creaba pero fallaban sus ofertas o su impuesto, tocar "Guardar" otra vez creaba OTRO producto igual (el mismo defecto que el N° 74 en Clientes). Ahora reintenta solo lo que faltó. | Corregido | typecheck (sin prueba propia: la maqueta no falla al guardar ofertas) |
| 134 | M2 | Jefe | Baja | Nuevo producto con categoría nueva: si algo fallaba después, reintentar creaba la categoría otra vez. Ahora queda elegida en la lista. | Corregido | typecheck |
| 135 | M2 | Bodega | Baja | Formulario de producto: "Agregar" un código sin red no hacía nada ni decía nada (la revisión de "¿ya existe?" lanzaba). Ahora lo agrega y la base lo revisa al guardar. | Corregido | typecheck |
| 136 | M10 | Bodega | Media | Etiquetas → "Asignar código": mandaba el producto completo sin la marca de edición (0020): si alguien había cambiado el precio desde que se abrió la pantalla, lo volvía a escribir con el precio viejo. Ahora la base lo rechaza con "otra persona lo cambió". | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 137 | M2 | Bodega | Baja | Etiquetas: un error de carga quedaba pegado aunque la carga siguiente funcionara. | Corregido | typecheck |
| 138 | M2 | Jefe | Media | Importar: corregir la planilla y elegir el MISMO archivo otra vez no hacía nada (el campo no cambiaba de valor). Había que recargar la página. | Corregido | demo-ronda7 |
| 139 | M2 | Jefe | Baja | Ofertas (del producto y a varios), stock mínimo, combos y Qué comprar aceptaban o pedían cantidades con coma ("desde 2,5"), aunque desde 0032 todo es por unidad. Ahora enteras y con teclado numérico. | Corregido | typecheck · demo-ronda7 |
| 140 | M2 | Jefe | Media | Ofertas a varios productos: la lista de "qué productos ya tienen oferta" se cortaba en 1.000 ofertas. | Corregido | typecheck (sin prueba propia) |
| 141 | M5 | Vendedor | Baja | Consultar precio con lector físico: Enter podía elegir el producto de la búsqueda anterior (mismo defecto que el 106). | Corregido | typecheck |
| 142 | M5 | Vendedor | Media | Escanear un producto DESACTIVADO decía "no está en el catálogo" y al admin le ofrecía crearlo con ese código, que la base rechazaba por repetido. Ahora dice que está desactivado. | Corregido | demo-ronda7 |
| 143 | M3 | Jefe | Media | Recibir mercadería: la factura quedaba en el libro de compras con la fecha de HOY, no la del papel: una factura del 30 recibida el 2 caía en el IVA crédito del mes siguiente. Ahora se anota la fecha de la factura (en blanco, hoy). | Corregido | demo-ronda7 |
| 144 | M3 | Bodega/Jefe | Media | Recibir mercadería: se podía confirmar con líneas a costo $0 sin ninguna pregunta (el aviso de cada línea se pierde en una recepción larga): el costo promedio se diluía. Ahora pregunta si es mercadería sin costo. | Corregido | demo-ronda7 |
| 145 | M3 | Bodega | Baja | Recibir mercadería: escanear un producto desactivado ofrecía "crear producto con este código" (la base lo rechazaba por repetido). | Corregido | typecheck |
| 146 | M3 | Jefe | Alta | Por pagar: la lista (y el aviso del Inicio) traía todas las facturas ordenadas por vencimiento, pagadas incluidas, y la API corta en 1.000: con el historial, las pendientes de vencimiento más lejano dejaban de aparecer y de avisarse. | Corregido | typecheck (sin prueba propia: necesita Supabase con más de 1.000 facturas) |
| 147 | M3 | Jefe | Media | Qué comprar → "Último proveedor": se calculaba sobre 1.000 líneas de recepción cualquiera (sin orden, la API corta ahí): con historial, el proveedor sugerido era uno viejo o ninguno. | Corregido | typecheck (sin prueba propia) |
| 148 | M3 | Jefe | Baja | Qué comprar: si no se podía copiar el pedido, la pantalla entera se reemplazaba por el error y el pedido armado se perdía. | Corregido | typecheck |
| 149 | M3 | Jefe | Baja | Qué comprar: "costo estimado" era neto sin decirlo; se leía como lo que se iba a pagar. Ahora "+ IVA". | Corregido | typecheck |
| 150 | M3 | Jefe/Bodega | Media | Compras → Recepciones: decía "Recepciones (30)" como si fueran todas y no había forma de ver (ni anular) una recepción más antigua. Ahora "últimas 30" y "Ver recepciones más antiguas". | Corregido | typecheck (la maqueta no tiene 30 recepciones; el recorrido solo mira la pestaña) |
| 151 | M3 | Jefe | Baja | Compras: un error de carga quedaba pegado aunque la carga siguiente funcionara. | Corregido | typecheck |
| 152 | M5 | Vendedor | Alta | Cobrar con fiado: la cuenta del cliente se buscaba en la lista de TODOS los clientes, que la API corta en 1.000: pasado ese número, a un cliente con crédito no le aparecía "Fiado". Ahora se pide la cuenta de ese cliente. | Corregido | typecheck (sin prueba propia: necesita Supabase con más de 1.000 clientes) |
| 153 | M5 | Vendedor | Media | Clientes del celular (para elegir en Vender sin conexión) y la pantalla Clientes: cortados en 1.000. | Corregido | typecheck (sin prueba propia) |
| 154 | M5 | Jefe | Baja | Fiado → "Dar crédito a un cliente": lista sin buscador; con cientos de clientes no se podía usar. | Corregido | typecheck |
| 155 | QA | QA (maqueta) | Baja | Fiado en la maqueta: se guardaban solo los últimos 500 movimientos y el saldo se calcula sumándolos: pasado eso, lo que debía cada cliente cambiaba solo. | Corregido | typecheck |
| 156 | M1 | Jefe | CRÍTICA | Seguridad (base): el disparador que crea el perfil de una cuenta nueva tomaba el local y el ROL de `user_metadata`, que cualquiera escribe con el registro público de Supabase y la llave pública de la página. Un vendedor (que ve el id de su local en su perfil) podía crearse otra cuenta como administrador de su local. 0037: el local y el rol salen solo de `app_metadata`, que escribe únicamente el servidor; las rutas de crear e invitar y los scripts lo mandan ahí. | Corregido | pg (seguridad.test.mjs S-37, escrita, sin correr acá) |
| 157 | M1 | Jefe | Media | Usuarios: cambiar el rol, desactivar o reactivar no revisaba que la base de verdad hubiera cambiado algo (un update que RLS no deja pasar no da error): la pantalla podía decir "listo" sin cambio. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 158 | M3 | Jefe | Alta | Seguridad (base): la política de proveedores dejaba CREAR proveedores a cualquier usuario del local (un vendedor desde la consola): el rol estaba solo en la condición que Postgres no usa al insertar. 0037 la separa: crear, admin/supervisor/bodega (como al recibir mercadería); cambiar y borrar, solo admin. | Corregido | pg (seguridad.test.mjs, escrita, sin correr acá) |
| 159 | M3 | Supervisor/Bodega | Media | Compras → Proveedores: supervisor y bodega veían "Editar"; al guardar, la base no cambiaba nada (solo el admin puede) y la pantalla decía "guardado". Ahora el botón es del admin y el repositorio avisa si nada cambió. | Corregido | demo-roles |
| 160 | M4 | Bodega | Media | Ajuste de stock (base): el tipo (positivo/negativo) lo elegía la pantalla con el stock de cuando abrió el diálogo; con una venta entremedio quedaba un "ajuste positivo" que restaba. Ahora lo decide la base con el stock bloqueado, y una merma que suma se rechaza (0037). | Corregido | pg (seguridad.test.mjs, escrita, sin correr acá) |
| 161 | M7 | Jefe | Media | Reportes: cambiar rápido de fechas o de pestaña dejaba dos consultas en vuelo y la que llegaba última (a veces la vieja) pisaba a la nueva: se veía el reporte de otro período con las fechas nuevas arriba. | Corregido | typecheck (sin prueba propia: es una carrera) |
| 162 | M8 | Jefe | Baja | Inicio → Bajo stock mínimo: el mínimo salía sin formato ("10.000" se veía 10000). | Corregido | typecheck |
| 163 | M1 | Todos | Alta | Bloqueo por inactividad: vivía solo en la pestaña (sessionStorage). Cerrar la app del celular y volver a abrirla, o abrir otra pestaña, lo saltaba sin contraseña; tampoco bloqueaba al volver a abrir después del plazo. Ahora queda en el celular (por cuenta) y se bloquea al abrir si pasó el plazo; entrar con la contraseña lo reinicia. | Corregido | demo-ronda7 |
| 164 | M1 | Todos | Media | Pantalla bloqueada: con señal mala, un corte de red al revisar la contraseña contaba como "contraseña incorrecta" y terminaba en la pausa de 30 s. Ahora un corte usa la huella guardada (como sin red). | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 165 | M1 | Todos | Media | Ingreso: con señal mala, un corte de red decía "Correo o contraseña incorrectos" y sumaba un intento fallido (pausa tras 5). Ahora dice que no hay conexión. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 166 | M9 | Jefe | Alta | "Descargar mis datos" (respaldo): no traía lo que deben los clientes (fiado), las facturas por pagar a proveedores, las devoluciones a proveedor ni las autorizaciones de descuento: tablas nuevas de 0029 a 0036 que nadie agregó a la lista. | Corregido | typecheck (sin prueba propia: necesita Supabase) |
| 167 | M9 | Jefe | Media | Respaldo: paginaba sin ordenar; con ventas entrando mientras se arma, Postgres puede repetir o saltarse filas entre páginas y el respaldo quedaba incompleto sin decirlo. Ahora ordena por la llave de cada tabla. | Corregido | typecheck (sin prueba propia) |
| 168 | M1 | Jefe | CRÍTICA | Seguridad (base): desactivar a un usuario solo lo frenaba en la pantalla. Su sesión sigue viva (el token se renueva solo) y todas las políticas preguntan por el local con `current_tenant_id()`, que no miraba si la cuenta estaba activa: un ex empleado podía seguir leyendo ventas, clientes y proveedores por la API y escribir donde su rol lo dejaba. 0037: las funciones de identidad devuelven nulo para una cuenta desactivada; su propio perfil lo sigue viendo para que la app le diga que está desactivada. | Corregido | pg (seguridad.test.mjs, escrita, sin correr acá) |
| 169 | M6 | Vendedor | Media | Cierre de caja (base): aceptaba un monto contado nulo o negativo; con nulo no pedía motivo y la caja quedaba cerrada "sin contar". Y cerrar o registrar ingresos/egresos no revisaba que la cuenta siguiera activa. 0037. | Corregido | db:check (sin prueba propia corrida) |
| 170 | M6 | Jefe | Media | Anular una venta en efectivo de OTRO día (solo el admin puede) no registra la salida de la plata en la caja de hoy: el cajón de hoy queda con faltante. Las devoluciones sí lo hacen. | Pregunta de negocio | — (ver "Decisiones") |
| 171 | M1 | Todos | Media | Cambiar la contraseña no borraba la huella guardada para desbloquear sin red: quien supiera la contraseña VIEJA seguía desbloqueando ese celular sin internet. | Corregido | typecheck |
| 172 | M5 | Vendedor | Media | Sin internet, Vender abre la última copia guardada de la pantalla, que era de cuando la caja estaba abierta: cerrar la caja y quedarse sin red dejaba seguir vendiendo en una caja cerrada, y la base rechazaba esas ventas después. Cerrar la caja ahora borra esa copia. | Corregido | typecheck (el service worker solo corre en producción) |
| 173 | M8 | Jefe | Baja | Inicio → "Avisos del sistema (20)": se traen los 20 más nuevos y el número se leía como el total. Ahora "20 o más". | Corregido | typecheck |
| 174 | M5 | Vendedor | Alta | Sin internet, Vender usaba la configuración por omisión, no la del local: un local que vende sin stock dejaba de poder hacerlo justo sin red, y el efectivo no se redondeaba. Ahora se guarda en el celular la última configuración leída (y se borra si entra otro local). Era un pendiente conocido. | Corregido | typecheck (sin prueba propia: necesita Supabase y cortar la red) |
| 175 | QA | QA (maqueta) | Baja | Maqueta: la caja de ejemplo se "abría" a las 09:15 del día en que arrancó el servidor: antes de las 09:15 quedaba abierta en el futuro (el resumen decía "Abierta 09:15, Cerrada 05:02") y pasada la medianoche aparecía como caja de otro día. | Corregido | demo-ronda7 (visto en su salida) |
| 176 | M9 | Vendedor/Jefe | Media | Ayuda: no explicaba el descuento con autorización por PIN (0036) ni cómo crear el PIN; y decía "si se cae internet, sigue vendiendo" sin aclarar que fiar y pedir autorización necesitan internet. | Corregido | demo-roles (la pantalla) |
| 177 | M9 | Jefe | Baja | Facturación → nota de crédito: decía que lo devuelto vuelve "a la sala" (desde 0032 hay una sola bodega). | Corregido | typecheck |
| 178 | M6 | Vendedor | Media | Caja: un abono de fiado pagado con débito, crédito o transferencia no quedaba en ninguna caja: el cierre mostraba "Cobrado por medio de pago" solo con las ventas y lo de la máquina de tarjetas no cuadraba. 0037 lo deja en la caja de quien lo recibe y la Caja lo muestra aparte. | Corregido | pg (redondeo-fiado.test.mjs, ampliada, sin correr acá) |
| 179 | M2 | Jefe/Bodega | Alta | Importar: una planilla para ACTUALIZAR precios (sin columnas de costo, mínimo, categoría o descripción) dejaba a los productos que ya existían con costo promedio $0, mínimo 0 y sin categoría: lo vacío se escribía encima. Ahora lo que viene en blanco no se toca. | Corregido | core: import.test.ts |
| 180 | M2 | Jefe/Bodega | Media | Importar: el stock inicial de productos que ya existían se ignoraba sin decirlo; quien cargaba la planilla creía que el stock había entrado. Ahora el resultado lo avisa y dice dónde se cambia. | Corregido | typecheck |
| 181 | M9 | Jefe | Baja | Facturación → Recibidas: el IVA propuesto era el 19 % escrito en el código, no el IVA del local (regla 13). | Corregido | typecheck |

## Decisiones de negocio que tomé y hay que confirmar

1. **Proveedores (N° 158/159):** crear uno lo pueden admin, supervisor y bodega
   (al recibir mercadería, como pidió Felipe en T-55); **cambiarlo o borrarlo,
   solo el administrador** (matriz del doc 02). Si el supervisor debe poder
   editar proveedores, es una línea en la política de 0037.
2. **Descuento a mano y cantidad (N° 105):** al cambiar la cantidad, el
   descuento se mantiene **en la misma proporción**. La alternativa era
   mantener el monto en pesos, que con menos unidades regalaba el producto.
3. **Importar (N° 179):** una celda en blanco al actualizar un producto
   existente significa "no tocar". Para poner algo en 0 hay que escribir 0.
4. **Bloqueo (N° 163):** queda en el celular por cuenta, no por pestaña. Si
   otra persona entra en ese celular con su contraseña, a ella no se le bloquea.

## Pregunta de negocio abierta (N° 170)

**Anular una venta en efectivo de otro día.** Solo el administrador puede, y
la base la saca de la caja de ese día (ya cerrada): la plata que se le
devuelve al cliente sale del cajón de hoy y el cierre de hoy queda con
faltante. Las devoluciones sí registran el egreso en la caja abierta. ¿Anular
una venta antigua tiene que dejar también el egreso en la caja de quien
anula? (Es un cambio chico en `fn_void_sale` una vez decidido.)

## Lo que NO se pudo verificar en esta sesión

- **`npm run db:test` no corrió.** Necesita un usuario sin privilegios (initdb
  no corre como root) y el entorno no permitió crearlo. La migración 0037 pasa
  `db:check` (compila), y sus pruebas están **escritas pero no ejecutadas**:
  `seguridad.test.mjs` (S-37 cuentas, desactivado sin acceso, proveedores,
  merma), `redondeo-fiado.test.mjs` (abonos por medio). También se ajustaron
  `banco.mjs` y `concurrencia.test.mjs` para crear los usuarios de prueba como
  lo hace el servidor (con `raw_app_meta_data`). **Hay que correr `db:test`
  antes de aplicar 0037.**
- Nada se corrió contra Supabase ni Railway: los cortes de 1.000 filas, las
  rutas de crear e invitar cuentas y el corte de red durante el envío solo se
  comprobaron leyendo el código y con typecheck.

## Verificado

core **463** (+11) · typecheck · `db:check` (169 cuerpos) · build de
producción (maqueta) · recorridos de la maqueta: **demo-ronda7 15/15 (nuevo)**
—y con el código anterior **3/15**: 12 comprobaciones se vieron fallar antes
del arreglo (regla 16)— · ronda6 14/14 · ronda5 22/22 · ronda4 44/44 (se
cambió un selector por posición que el N° 143 corrió) · ronda3 45/45 · ronda2
15/15 · flujo 19/19 · datos 11/11 · descuento 11/11 · devolución 12/12 ·
bodega-unidad 26/26 · demo-roles 192 pantallas sin errores, desbordes ni
controles sin nombre · sin-red 5/5 · `peso-js` 28/28 bajo 270 kB y 12/28 en la
meta de 250 (Recibir mercadería llegó a 275 kB con los arreglos y volvió a
264 cargando el alta de producto y de proveedor recién al abrirlas).

## Hallazgo abierto, sin corregir

- **Error de React #418 (el HTML del servidor no coincide con el del
  navegador), intermitente.** Se vio una vez en `/pos` como administrador con
  el navegador en hora de Chile, en la primera pasada de esta sesión; después
  no se repitió en 8 pasadas por las 24 pantallas y los 4 roles
  (`tools/ui/barrido-errores.mjs`, nuevo). Ya se había visto una vez en la
  ronda 6. No se encontró la causa.
