/**
 * Versión y novedades (RF-M9-09), escritas para quien usa el sistema.
 *
 * La primera entrada es la versión instalada. Cada cambio que mueve un botón
 * o cambia cómo se hace algo se anota acá en palabras del local, no en las de
 * un commit: el cajero tiene que poder leerlo en el mostrador.
 */

export interface Novedad {
  version: string;
  fecha: string; // AAAA-MM-DD
  titulo: string;
  /** Qué cambia y a quién le importa. */
  cambios: Array<{ para: 'todos' | 'admin' | 'supervisor' | 'vendedor' | 'bodega'; texto: string }>;
}

export const NOVEDADES: Novedad[] = [
  {
    version: '0.6.3',
    fecha: '2026-10-02',
    titulo: 'Tercera revisión por rol: 150 arreglos',
    cambios: [
      { para: 'vendedor', texto: 'Vender sin internet es más seguro: una venta que se cortaba a medio enviar ya no se pierde, y sin internet (o con la sesión vencida) queda "por enviar" en vez de "rechazada". Las ventas hechas sin red quedan siempre a tu nombre.' },
      { para: 'vendedor', texto: 'Ingresar y la pantalla bloqueada: sin internet dicen "No hay conexión" y ya no cuentan como clave mal escrita. Una cuenta desactivada ahora puede salir y dejar entrar a otra persona.' },
      { para: 'todos', texto: 'Con más de 1.000 productos, clientes o códigos, ya no falta nada: el celular baja todo el catálogo, el stock, las ofertas y los lotes, y las listas y reportes ya no se cortan.' },
      { para: 'bodega', texto: 'Importar para actualizar: si la planilla no trae la columna costo, perecible, categoría o mínimo, se conserva lo que había (antes se borraba o quedaba en $0). Precio $0 y decimales con coma se avisan.' },
      { para: 'bodega', texto: 'Ajustes: no se puede dejar stock negativo y una merma no puede sumar. Inventario → Lotes muestra la fecha de vencimiento correcta (salía un día antes).' },
      { para: 'admin', texto: 'Facturas: cambiar el RUT después de elegir un cliente o proveedor limpia sus datos (antes quedaban los del anterior). Borrar las claves del SII pide confirmar.' },
      { para: 'admin', texto: 'Un combo se puede desactivar aunque ya no salga más barato. No se puede crear dos veces el mismo proveedor (mismo RUT).' },
      { para: 'admin', texto: 'Las cuentas del personal se crean solo desde Usuarios: registrarse por fuera ya no da acceso al local.' },
    ],
  },
  {
    version: '0.6.2',
    fecha: '2026-10-01',
    titulo: 'Descuentos con autorización',
    cambios: [
      { para: 'admin', texto: 'Mi cuenta → "PIN para autorizar descuentos": con ese PIN autorizas descuentos en el celular de un vendedor, hasta tu propio tope. Nadie puede ver el PIN.' },
      { para: 'vendedor', texto: 'Vender: cada producto tiene "Descuento" (en pesos o %). Si pasa tu tope, "Pedir autorización y cobrar": el administrador o un supervisor escribe su PIN en tu celular. Sirve para esa venta y necesita internet.' },
      { para: 'supervisor', texto: 'Cinco PIN incorrectos seguidos bloquean al que autoriza por 15 minutos. La venta guarda quién autorizó el descuento.' },
    ],
  },
  {
    version: '0.6.1',
    fecha: '2026-10-01',
    titulo: 'Devolver al proveedor y utilidad sin IVA',
    cambios: [
      { para: 'bodega', texto: 'Compras → "Devolver": lo vencido, dañado o mal despachado vuelve al proveedor con su motivo y documento, y sale de la bodega. Si es perecible, eliges el lote.' },
      { para: 'admin', texto: 'Reportes: la utilidad y el margen se calculan sin IVA ni impuestos de bebidas, contra el costo neto. Los márgenes se ven más bajos porque ahora son los reales.' },
      { para: 'admin', texto: 'Anular una recepción también saca su factura del libro de compras.' },
    ],
  },
  {
    version: '0.6.0',
    fecha: '2026-10-01',
    titulo: 'Una sola bodega, todo por unidad y el precio por mayor en el producto',
    cambios: [
      { para: 'todos', texto: 'Ya no hay "sala" y "bodega": todo el stock está en un solo lugar y no hay que reponer. Lo que estaba en la bodega pasó solo.' },
      { para: 'todos', texto: 'Todo se vende y se cuenta por unidad. No hay kilos, litros ni medias unidades.' },
      { para: 'vendedor', texto: 'El precio por mayor es del producto: Vender muestra "Precio por mayor (desde 3)" y, si faltan, "Por mayor desde 3: llevando 1 más". Los clientes ya no tienen precio propio.' },
      { para: 'admin', texto: 'Producto perecible: si cargas stock, la fecha de vencimiento es obligatoria y se muestra cuántos días le quedan. Ya no se pregunta "cuántos días antes avisar".' },
      { para: 'admin', texto: 'El costo es neto (sin IVA), como en la factura del proveedor, y el margen se calcula sobre el precio sin IVA.' },
      { para: 'bodega', texto: 'Recibir mercadería: crea el producto o el proveedor nuevo ahí mismo, elige si los costos vienen netos o con IVA y anota el total del papel para ver si cuadra.' },
      { para: 'admin', texto: 'Recibir mercadería: "Efectivo de la caja" saca el pago de tu caja abierta; "A crédito" deja la factura en Por pagar por su total con IVA; la factura queda sola en el libro de compras.' },
    ],
  },
  {
    version: '0.5.2',
    fecha: '2026-10-01',
    titulo: 'Segunda revisión por rol: 50 arreglos más',
    cambios: [
      { para: 'bodega', texto: 'Recibir mercadería: recuerda el vencimiento de la factura si sales a medio cargar; quitar un producto y volver a agregarlo parte en 1. Recibir productos con vencimiento ya no falla al guardar.' },
      { para: 'admin', texto: 'Anular una recepción saca el stock, deja el lote y el costo promedio como antes y anula su factura por pagar (si ya estaba pagada, lo avisa).' },
      { para: 'admin', texto: 'Por pagar: no acepta una fecha de emisión futura; el total por proveedor ya no junta a dos con el mismo nombre. Facturas recibidas: no se registra dos veces si falló lo de Por pagar.' },
      { para: 'admin', texto: 'Clientes: revisa el correo y no duplica al cliente si hay que guardar de nuevo. Fiado: "Dar crédito" explica que primero se agrega el cliente.' },
      { para: 'admin', texto: 'Reportes: las planillas llevan la fecha con año. Configuración: dice por qué no se puede guardar con 0 horas o 0 %; el código de actividad se acepta con puntos ("47.11.00").' },
      { para: 'vendedor', texto: 'Caja: el cierre se compara con lo que debería haber ahora (no cuando abriste la pantalla); avisa un egreso mayor que lo que hay; contar por billete parte en $0.' },
      { para: 'vendedor', texto: 'El comprobante y las ventas sin registrar muestran el día y la hora del local, aunque el celular tenga otra zona.' },
      { para: 'todos', texto: 'La pantalla bloqueada pausa después de 5 contraseñas malas, y "Es otra persona: salir" sale de inmediato. Botones chicos más grandes para el dedo (44 px).' },
      { para: 'todos', texto: 'Devolver, anular y dar de baja un lote marcan el motivo como obligatorio; una cantidad mal escrita al devolver se avisa.' },
    ],
  },
  {
    version: '0.5.1',
    fecha: '2026-10-01',
    titulo: 'Revisión por rol: 49 arreglos',
    cambios: [
      { para: 'vendedor', texto: 'Vender: "Quitar" ofrece "Deshacer"; "Vaciar" también quita al cliente; avisa al agregar o subir con "+" lo que no se podrá cobrar por stock.' },
      { para: 'vendedor', texto: 'Vender y Consultar precio avisan si el producto tiene un lote vencido. La búsqueda muestra el precio del cliente elegido.' },
      { para: 'vendedor', texto: 'Si la venta no se puede registrar, el motivo aparece dentro de "Cobrar". Un monto con coma ("20000,5") ya no se lee como $200.005.' },
      { para: 'vendedor', texto: 'Sin internet: si una venta no se pudo registrar al volver la conexión, la barra de arriba dice cuál y por qué.' },
      { para: 'vendedor', texto: 'Al salir con la caja abierta, el sistema lo recuerda y ofrece ir a cerrarla.' },
      { para: 'todos', texto: 'Las búsquedas de clientes, fiado, combos y facturas encuentran sin tildes. Fechas, porcentajes y cantidades se escriben igual en todos los celulares.' },
      { para: 'todos', texto: 'El menú dice "Compras" (antes "Proveedores"), como la pantalla.' },
      { para: 'admin', texto: 'Inicio: la comparación con la semana pasada es "a esta hora", ya no contra el día completo. La Bitácora dice qué se cambió en configuración, clientes, combos, fiado y facturas.' },
      { para: 'admin', texto: 'Usuarios: cambiar el rol o desactivar pide confirmar. Facturación → Recibidas: "vence el" deja la factura también en Por pagar.' },
      { para: 'supervisor', texto: 'El Inicio y el resumen por WhatsApp ya no muestran el valor al costo de lo que vence. "Anular" solo aparece en ventas del día.' },
      { para: 'bodega', texto: 'Inventario y recepción no aceptan medias unidades ("2,5 botellas"); un costo mal escrito se avisa en vez de guardarse. Con la bodega vacía el botón dice "Mover".' },
    ],
  },
  {
    version: '0.5.0',
    fecha: '2026-10-01',
    titulo: 'Redondeo del efectivo, fiado y facturas por pagar',
    cambios: [
      { para: 'vendedor', texto: 'Cobrar en efectivo redondea a la decena (Ley 20.956): $1.463 se cobra $1.460. El comprobante muestra el total, el redondeo y lo cobrado; la caja cuadra sola.' },
      { para: 'vendedor', texto: 'Fiado: con un cliente que tiene crédito aparece "Fiado" al cobrar, con cuánto debe y cuánto le queda. Lo fiado no entra a la caja.' },
      { para: 'vendedor', texto: 'Nueva sección "Fiado": lo que debe cada cliente y "Abonar" cuando paga. Un abono en efectivo entra a tu caja.' },
      { para: 'todos', texto: 'El comprobante puede llevar al pie el texto del local (política de cambios, redes).' },
      { para: 'admin', texto: 'Fiado: "Dar crédito a un cliente" con su tope. Configuración: texto al pie del comprobante.' },
      { para: 'admin', texto: 'Compras → "Por pagar": facturas de proveedores con su vencimiento; al recibir con factura se indica cuándo vence. El Inicio avisa lo que vence esta semana.' },
      { para: 'admin', texto: 'Pagar una factura "con efectivo de la caja" la registra como egreso de tu caja.' },
      { para: 'bodega', texto: 'Al recibir mercadería con factura a crédito, indica cuándo vence (30 o 60 días). Bodega ya no puede cambiar precios, tampoco por atrás.' },
    ],
  },
  {
    version: '0.4.0',
    fecha: '2026-09-30',
    titulo: 'Menos errores de tecleo, más control para el dueño',
    cambios: [
      { para: 'todos', texto: 'Nueva sección "Mi cuenta": tus datos, tu contraseña, letra más grande y bloqueo de pantalla en este celular.' },
      { para: 'todos', texto: 'Nueva sección "Ayuda": cómo se hace cada cosa, paso a paso, solo lo que te toca.' },
      { para: 'todos', texto: 'Al entrar: aviso de mayúsculas activadas y el celular recuerda tu correo.' },
      { para: 'todos', texto: 'La búsqueda encuentra sin tildes: "azucar" encuentra "Azúcar".' },
      { para: 'todos', texto: 'Si se publica una versión nueva, aparece "Actualizar".' },
      { para: 'vendedor', texto: 'Vender: "Deshacer" después de agregar o quitar, productos frecuentes a un toque y de cuándo son los precios.' },
      { para: 'vendedor', texto: 'Vender pregunta antes de cobrar un monto recibido o una cantidad que parecen error de tecleo.' },
      { para: 'vendedor', texto: 'Caja: contar por billete al cerrar y un resumen del cierre para imprimir.' },
      { para: 'vendedor', texto: 'Mis ventas: reimprimir o compartir el comprobante de una venta (sale como COPIA).' },
      { para: 'admin', texto: 'Productos: ordenar, cambiar el precio tocándolo, "Revisar datos" incompletos y exportar a Excel.' },
      { para: 'admin', texto: 'Reportes: ventas por hora, productos A-B-C, anulaciones por persona y ventas línea por línea para el contador.' },
      { para: 'admin', texto: 'Inicio: "Para revisar" (avisos, cajas olvidadas, merma del mes) y el resumen del día por WhatsApp.' },
      { para: 'admin', texto: 'Nueva sección "Bitácora": quién cambió precios, anuló ventas o ajustó stock.' },
      { para: 'admin', texto: 'Usuarios marca a quien todavía no cambia la contraseña temporal.' },
      { para: 'bodega', texto: 'Inventario: "Qué reponer" de la bodega a la sala, hoja para contar en papel y oferta para lo que vence.' },
      { para: 'bodega', texto: 'Etiquetas: cartel de precio para la góndola. Qué comprar: pedido por proveedor.' },
    ],
  },
  {
    version: '0.3.0',
    fecha: '2026-09-30',
    titulo: 'Más claro, más legible y funciona mejor sin internet',
    cambios: [
      { para: 'todos', texto: 'Menú con íconos propios y, en "Más", una frase que dice para qué sirve cada sección.' },
      { para: 'todos', texto: 'Cada pantalla explica arriba qué se hace en ella. Botones con el mismo estilo en todas partes.' },
      { para: 'todos', texto: 'Colores con mejor contraste: se lee mejor al sol y con poca luz.' },
      { para: 'todos', texto: 'Si sales con ventas hechas sin internet que no se han enviado, el sistema te avisa y ofrece enviarlas.' },
      { para: 'todos', texto: 'Vender y Consultar precio abren aunque se haya caído internet, si ya se abrieron antes en este celular.' },
      { para: 'admin', texto: 'Inicio con el gráfico de los últimos 30 días y la comparación con la semana anterior.' },
      { para: 'admin', texto: 'Reportes de ventas comparan con el período anterior.' },
      { para: 'admin', texto: 'Configuración → "Descargar mis datos": todo el local en un archivo.' },
      { para: 'admin', texto: 'Productos: "Duplicar" para crear variantes (otro tamaño, otro sabor) sin escribir todo de nuevo.' },
      { para: 'bodega', texto: 'Compras → "Qué comprar": lo que está bajo el mínimo y cuánto pedir, listo para mandar al proveedor.' },
      { para: 'vendedor', texto: 'Si escaneas un código que no existe, quien puede crear productos lo crea desde ahí con el código puesto.' },
    ],
  },
  {
    version: '0.2.0',
    fecha: '2026-09-30',
    titulo: 'Cuentas para cada persona y permisos ordenados',
    cambios: [
      { para: 'admin', texto: 'Usuarios → "Crear cuenta" con contraseña temporal, sin depender del correo.' },
      { para: 'todos', texto: 'Cada persona entra a su pantalla: el vendedor a Vender, bodega a Inventario.' },
      { para: 'vendedor', texto: 'Nueva sección "Mis ventas".' },
      { para: 'admin', texto: 'Ventas y Caja muestran lo cobrado por medio de pago.' },
      { para: 'bodega', texto: 'Recepción: la mercadería a medio cargar se recupera si sales de la pantalla.' },
    ],
  },
  {
    version: '0.1.0',
    fecha: '2026-09-29',
    titulo: 'Facturación y robot del SII listos para enchufar',
    cambios: [
      { para: 'admin', texto: 'Facturación: factura manual, recibidas y resumen mensual de IVA.' },
    ],
  },
];

export const VERSION = NOVEDADES[0].version;

/** "0.3.0 · 72b4b9f": la versión y el commit con que se compiló. */
export function versionCompleta(): string {
  const commit = process.env.NEXT_PUBLIC_COMMIT;
  return commit ? `${VERSION} · ${commit}` : VERSION;
}
