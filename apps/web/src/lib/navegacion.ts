/**
 * Navegación por rol — una sola fuente de verdad para la barra lateral
 * (escritorio) y la navegación inferior (celular).
 *
 * El principio, tomado de la matriz de permisos del doc 02: NO hay una
 * interfaz única para todos. Cada rol entra a resolver un problema distinto y
 * la navegación refleja eso.
 *
 *   admin      → "quiero saber cómo está el negocio"
 *   supervisor → "quiero operar y autorizar"
 *   vendedor   → "quiero vender rápido"
 *   bodega     → "quiero controlar productos"
 *
 * Solo se listan rutas que existen. Un menú con enlaces muertos se siente peor
 * que un menú corto.
 */

export type Rol = 'admin' | 'supervisor' | 'vendedor' | 'bodega';

export interface ItemNav {
  href: string;
  label: string;
  /** Etiqueta corta para la barra inferior del celular. */
  labelCorto: string;
  icono: string;
  roles: Rol[];
  /** Si es true, aparece también en la barra inferior del celular. */
  enMovil: boolean;
}

export const NAVEGACION: ItemNav[] = [
  {
    href: '/', label: 'Inicio', labelCorto: 'Inicio', icono: '🏠',
    roles: ['admin', 'supervisor'], enMovil: true,
  },
  {
    href: '/pos', label: 'Vender', labelCorto: 'Vender', icono: '🛒',
    roles: ['admin', 'supervisor', 'vendedor'], enMovil: true,
  },
  {
    href: '/caja', label: 'Caja', labelCorto: 'Caja', icono: '💰',
    roles: ['admin', 'supervisor', 'vendedor'], enMovil: true,
  },
  {
    href: '/productos', label: 'Productos', labelCorto: 'Productos', icono: '📦',
    roles: ['admin', 'supervisor', 'vendedor', 'bodega'], enMovil: true,
  },
  {
    href: '/inventario', label: 'Inventario', labelCorto: 'Stock', icono: '📋',
    roles: ['admin', 'supervisor', 'bodega'], enMovil: true,
  },
  {
    href: '/proveedores', label: 'Proveedores', labelCorto: 'Prov.', icono: '🚚',
    roles: ['admin', 'supervisor', 'bodega'], enMovil: false,
  },
  // Pendientes: /reportes y /alertas. No se listan hasta que existan —
  // un menú con enlaces muertos se siente peor que un menú corto.
  {
    href: '/usuarios', label: 'Usuarios', labelCorto: 'Usuarios', icono: '👥',
    roles: ['admin'], enMovil: false,
  },
];

export function navPara(rol: Rol): ItemNav[] {
  return NAVEGACION.filter((i) => i.roles.includes(rol));
}

/**
 * La barra inferior del celular admite 5 elementos como máximo: más que eso
 * reduce cada objetivo táctil por debajo de los 44 px exigidos por RNF-16.
 */
export function navMovil(rol: Rol): ItemNav[] {
  return navPara(rol).filter((i) => i.enMovil).slice(0, 5);
}

/** Qué resuelve cada rol al entrar. Se muestra bajo su nombre en la lateral. */
export const LEMA_ROL: Record<Rol, string> = {
  admin: 'Cómo está el negocio',
  supervisor: 'Operar y autorizar',
  vendedor: 'Vender rápido',
  bodega: 'Controlar inventario',
};

export const NOMBRE_ROL: Record<Rol, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  vendedor: 'Vendedor',
  bodega: 'Bodega',
};
