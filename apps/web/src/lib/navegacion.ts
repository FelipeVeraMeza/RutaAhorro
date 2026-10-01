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

import type { NombreIcono } from '@/components/Icono';

export type Rol = 'admin' | 'supervisor' | 'vendedor' | 'bodega';

export interface ItemNav {
  href: string;
  label: string;
  /** Etiqueta corta para la barra inferior del celular. */
  labelCorto: string;
  icono: NombreIcono;
  /** Qué se hace ahí, en una frase: la bajada del título de la pantalla y del menú "Más". */
  ayuda: string;
  roles: Rol[];
  /** Si es true, aparece también en la barra inferior del celular. */
  enMovil: boolean;
  /** Nombre distinto según quién mira: el vendedor ve "Mis ventas". */
  porRol?: Partial<Record<Rol, { label: string; labelCorto: string; ayuda?: string }>>;
}

export const NAVEGACION: ItemNav[] = [
  {
    href: '/', label: 'Inicio', labelCorto: 'Inicio', icono: 'inicio',
    ayuda: 'Cómo va el día: ventas, stock bajo y vencimientos',
    roles: ['admin', 'supervisor'], enMovil: true,
  },
  {
    href: '/pos', label: 'Vender', labelCorto: 'Vender', icono: 'vender',
    ayuda: 'Escanea o busca productos y cobra',
    roles: ['admin', 'supervisor', 'vendedor'], enMovil: true,
  },
  {
    href: '/caja', label: 'Caja', labelCorto: 'Caja', icono: 'caja',
    ayuda: 'Abre tu caja, registra ingresos y egresos, y ciérrala al final del turno',
    roles: ['admin', 'supervisor', 'vendedor'], enMovil: true,
  },
  {
    // Va antes que Productos porque la pregunta "¿cuánto vale esto?" se
    // responde de pie y con el cliente esperando, y Productos no.
    href: '/precio', label: 'Consultar precio', labelCorto: 'Precio', icono: 'precio',
    ayuda: 'Cuánto vale un producto, con o sin internet',
    roles: ['admin', 'supervisor', 'vendedor', 'bodega'], enMovil: true,
  },
  {
    href: '/productos', label: 'Productos', labelCorto: 'Productos', icono: 'productos',
    ayuda: 'El catálogo: precios, códigos de barra, ofertas y etiquetas',
    roles: ['admin', 'supervisor', 'vendedor', 'bodega'], enMovil: true,
  },
  {
    href: '/inventario', label: 'Inventario', labelCorto: 'Stock', icono: 'inventario',
    ayuda: 'Cuánto hay, dónde está y qué vence; ajustes, reposición y conteo',
    roles: ['admin', 'supervisor', 'bodega'], enMovil: true,
  },
  {
    href: '/proveedores', label: 'Proveedores', labelCorto: 'Prov.', icono: 'proveedores',
    ayuda: 'Proveedores, recepción de mercadería y qué comprar',
    roles: ['admin', 'supervisor', 'bodega'], enMovil: false,
  },
  {
    // El vendedor ve solo las suyas (matriz del doc 02: "Ver historial de
    // ventas propias ✅"; RLS de `sales` ya lo impone). Antes no tenía ninguna
    // forma de encontrar una venta que acababa de cobrar.
    href: '/ventas', label: 'Ventas', labelCorto: 'Ventas', icono: 'ventas',
    ayuda: 'Historial de ventas: detalle, documentos, devoluciones y anulaciones',
    roles: ['admin', 'supervisor', 'vendedor'], enMovil: false,
    porRol: {
      vendedor: { label: 'Mis ventas', labelCorto: 'Mis ventas', ayuda: 'Las ventas que cobraste tú, con su detalle' },
    },
  },
  {
    // Ficha y precio por cliente (0022, RQ-21). El vendedor no entra: elige
    // al cliente desde el POS.
    href: '/clientes', label: 'Clientes', labelCorto: 'Clientes', icono: 'clientes',
    ayuda: 'Fichas de clientes y precios especiales o mayoristas',
    roles: ['admin', 'supervisor'], enMovil: false,
  },
  {
    // Cuenta corriente de los clientes con crédito (RF-M5-30, 0029). El
    // vendedor entra: es quien recibe los abonos en el mostrador.
    href: '/fiado', label: 'Fiado', labelCorto: 'Fiado', icono: 'fiado',
    ayuda: 'Lo que deben los clientes con crédito, y sus abonos',
    roles: ['admin', 'supervisor', 'vendedor'], enMovil: false,
  },
  {
    // Factura manual, recibidas y resumen mensual (0026). La boleta sale del POS.
    href: '/facturacion', label: 'Facturación', labelCorto: 'Facturas', icono: 'facturacion',
    ayuda: 'Facturas emitidas y recibidas, y el resumen de IVA del mes',
    roles: ['admin', 'supervisor'], enMovil: false,
  },
  {
    href: '/reportes', label: 'Reportes', labelCorto: 'Reportes', icono: 'reportes',
    ayuda: 'Qué se vende, quién vende, cuánto hay en bodega y en qué se pierde',
    roles: ['admin', 'supervisor'], enMovil: false,
  },
  // Pendiente: /alertas. No se lista hasta que exista — un menú con enlaces
  // muertos se siente peor que un menú corto.
  {
    href: '/usuarios', label: 'Usuarios', labelCorto: 'Usuarios', icono: 'usuarios',
    ayuda: 'Cuentas del personal: crear, cambiar rol, contraseñas y desactivar',
    roles: ['admin'], enMovil: false,
  },
  {
    // Quién hizo qué (RF-M9-11). La base la escribe desde 0002.
    href: '/bitacora', label: 'Bitácora', labelCorto: 'Bitácora', icono: 'bitacora',
    ayuda: 'Quién cambió precios, anuló ventas, ajustó stock o tocó cuentas',
    roles: ['admin'], enMovil: false,
  },
  {
    // Impuestos adicionales y cómo opera el local (0018, T-18).
    href: '/configuracion', label: 'Configuración', labelCorto: 'Config.', icono: 'configuracion',
    ayuda: 'Datos del local, impuestos y cómo opera la caja',
    roles: ['admin'], enMovil: false,
  },
  {
    // Contraseña y preferencias de este celular (RF-M9-14).
    href: '/cuenta', label: 'Mi cuenta', labelCorto: 'Mi cuenta', icono: 'cuenta',
    ayuda: 'Tu contraseña, letra más grande y bloqueo de pantalla en este celular',
    roles: ['admin', 'supervisor', 'vendedor', 'bodega'], enMovil: false,
  },
  {
    // "¿Cómo se hace?" por rol (RF-M9-12, RNF-18).
    href: '/ayuda', label: 'Ayuda', labelCorto: 'Ayuda', icono: 'ayuda',
    ayuda: 'Cómo se hace cada cosa, paso a paso',
    roles: ['admin', 'supervisor', 'vendedor', 'bodega'], enMovil: false,
  },
  {
    // Versión instalada y qué cambió (RF-M9-09). Para todos: el cajero también
    // tiene que enterarse de que un botón se movió.
    href: '/novedades', label: 'Novedades', labelCorto: 'Novedades', icono: 'novedades',
    ayuda: 'Qué versión está instalada y qué cambió',
    roles: ['admin', 'supervisor', 'vendedor', 'bodega'], enMovil: false,
  },
];

export function navPara(rol: Rol): ItemNav[] {
  return NAVEGACION.filter((i) => i.roles.includes(rol))
    .map((i) => (i.porRol?.[rol] ? { ...i, ...i.porRol[rol] } : i));
}

/**
 * La primera pantalla de cada rol.
 *
 * Antes todos entraban al POS, incluida bodega, que no vende (matriz del
 * doc 02): Luis Rojas iniciaba sesión y quedaba frente a un carrito. Y el
 * Inicio ("Vendido hoy") se abría para cualquiera que escribiera la
 * dirección, aunque no estuviera en su menú.
 */
export function inicioPara(rol: Rol): string {
  if (rol === 'vendedor') return '/pos';
  if (rol === 'bodega') return '/inventario';
  return '/';
}

/** ¿Puede este rol abrir esta ruta? La misma regla que el menú. */
/** El ítem del menú de una ruta, para el encabezado de la pantalla. */
export function itemDe(href: string, rol: Rol): ItemNav | undefined {
  return navPara(rol).find((i) => i.href === href);
}

export function rolPuedeVer(rol: Rol, href: string): boolean {
  return NAVEGACION.some((i) => i.href === href && i.roles.includes(rol));
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
