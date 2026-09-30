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
