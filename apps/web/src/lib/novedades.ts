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
