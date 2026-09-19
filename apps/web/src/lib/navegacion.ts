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
    // Va antes que Productos porque la pregunta "¿cuánto vale esto?" se
    // responde de pie y con el cliente esperando, y Productos no.
    href: '/precio', label: 'Consultar precio', labelCorto: 'Precio', icono: '🏷️',
    roles: ['admin', 'supervisor', 'vendedor', 'bodega'], enMovil: true,
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
  {
    href: '/ventas', label: 'Ventas', labelCorto: 'Ventas', icono: '🧾',
    roles: ['admin', 'supervisor'], enMovil: false,
  },
  {
    href: '/reportes', label: 'Reportes', labelCorto: 'Reportes', icono: '📊',
    roles: ['admin', 'supervisor'], enMovil: false,
  },
  // Pendiente: /alertas. No se lista hasta que exista — un menú con enlaces
  // muertos se siente peor que un menú corto.
  {
    href: '/usuarios', label: 'Usuarios', labelCorto: 'Usuarios', icono: '👥',
    roles: ['admin'], enMovil: false,
  },
];

export function navPara(rol: Rol): ItemNav[] {
  return NAVEGACION.filter((i) => i.roles.includes(rol));
}

/** Objetivos táctiles de la barra inferior, "Más" incluido (RNF-16). */
export const MAX_BARRA_MOVIL = 5;

/**
 * La barra inferior del celular admite 5 objetivos táctiles como máximo: más
 * que eso los deja bajo los 44 px que exige RNF-16.
 *
 * Antes se cortaba la lista en 5 y lo que sobraba no existía en el celular:
 * un administrador no tenía forma de llegar a Proveedores, Ventas, Reportes ni
 * Usuarios desde el teléfono —el menú terminaba en Inventario—, y la barra
 * lateral que los tiene está oculta bajo 1024 px. Por eso el quinto lugar,
 * cuando sobra algo, es "Más" y abre el resto.
 */
export function navMovil(rol: Rol): { barra: ItemNav[]; resto: ItemNav[] } {
  const todos = navPara(rol);
  const preferidos = todos.filter((i) => i.enMovil);

  // Si todo lo que ve el rol cabe en la barra, no hay "Más" que mostrar.
  if (todos.length <= MAX_BARRA_MOVIL) return { barra: todos, resto: [] };

  const barra = preferidos.slice(0, MAX_BARRA_MOVIL - 1);
  const enBarra = new Set(barra.map((i) => i.href));
  return { barra, resto: todos.filter((i) => !enBarra.has(i.href)) };
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
