/**
 * Factura manual (0026): el cálculo que la pantalla muestra antes de emitir y
 * el plan de líneas que el robot escribe en el portal del SII.
 *
 * La base es la autoridad (`fn_emitir_factura_manual`): esto existe para que
 * quien factura vea el total, el neto y el IVA mientras escribe, y hace la
 * misma cuenta que ella (`fn_desglose_factura`, 0027).
 *
 * Los precios incluyen IVA, como todo el sistema (regla 7). Para quien piensa
 * en neto (un flete que se cotizó "más IVA"), `precioConIva` lo convierte.
 *
 * Pero una factura NO se calcula como una boleta. En un DTE 33 el IVA es el
 * neto (entero) por la tasa, redondeado, y el total es neto + IVA; el portal
 * del SII lo calcula así y no deja escribirlo. Como el neto es entero, hay
 * totales que ninguna factura puede tener: $22 con IVA es neto 18 → $21, o
 * neto 19 → $23. Pasa con 1 de cada 6 totales. Por eso el neto sale de la suma
 * con IVA (como siempre) y el IVA sale del neto; el total puede quedar $1 por
 * debajo o por encima de la suma de las líneas, y la pantalla lo dice (`ajuste`).
 */
import { clp } from './money.js';
import { desglosarImpuestos, type Desglose } from './impuestos.js';

export interface LineaFactura {
  /** Null o ausente: línea libre (flete, servicio), no mueve stock. */
  productId?: string | null;
  nombre: string;
  cantidad: number;
  /** Precio de cada unidad con IVA (y adicional) incluido. */
  precio: number;
  descuento?: number;
  tasaAdicional?: number;
  nombreAdicional?: string | null;
}

/** Lo que vale la línea: cantidad × precio − descuento, redondeado como la base. */
export function montoLinea(l: LineaFactura): number {
  return clp(l.cantidad * l.precio) - clp(l.descuento ?? 0);
}

export interface ResumenFactura extends Desglose {
  /** Líneas que no se pueden emitir, con el motivo, en el orden en que están. */
  errores: string[];
  /** Total − suma de las líneas con IVA: −1, 0 o +1 (ver arriba). */
  ajuste: number;
}

/** El IVA de un DTE: neto × tasa, redondeado. Nunca extraído del total. */
export function ivaDeNeto(neto: number, ivaPct = 19): number {
  return clp((neto * ivaPct) / 100);
}

/** Neto, IVA, adicionales y total de la factura, y qué le falta para emitirse. */
export function resumenFactura(lineas: readonly LineaFactura[], ivaPct = 19): ResumenFactura {
  const errores: string[] = [];
  if (lineas.length === 0) errores.push('Agrega al menos una línea');
  if (lineas.length > 60) errores.push('El SII admite hasta 60 líneas por factura');
  lineas.forEach((l, i) => {
    const n = i + 1;
    if (!l.nombre.trim()) errores.push(`Línea ${n}: falta qué se factura`);
    if (!(l.cantidad > 0)) errores.push(`Línea ${n}: la cantidad tiene que ser mayor que cero`);
    if (!(l.precio >= 0)) errores.push(`Línea ${n}: el precio no puede ser negativo`);
    if (montoLinea(l) < 0) errores.push(`Línea ${n}: el descuento es mayor que la línea`);
  });
  const d = desglosarImpuestos(
    lineas.map((l) => ({ subtotal: Math.max(montoLinea(l), 0), tasaAdicional: l.tasaAdicional, nombreAdicional: l.nombreAdicional })),
    ivaPct,
  );
  const iva = ivaDeNeto(d.neto, ivaPct);
  const total = d.neto + iva + d.totalAdicionales;
  if (lineas.length > 0 && total <= 0) errores.push('La factura no puede quedar en $0');
  return { ...d, iva, total, ajuste: total - d.total, errores };
}

/** Un precio neto llevado a precio con IVA (y adicional), en pesos enteros. */
export function precioConIva(neto: number, ivaPct = 19, tasaAdicional = 0): number {
  return clp(neto * (1 + ivaPct / 100 + tasaAdicional / 100));
}

/** '76.086.428-5' → { cuerpo: '76086428', dv: '5' }. Null si no tiene forma de RUT. */
export function partirRut(rut: string | null | undefined): { cuerpo: string; dv: string } | null {
  const limpio = String(rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 2) return null;
  return { cuerpo: limpio.slice(0, -1), dv: limpio.slice(-1) };
}

// ---------------------------------------------------------------------------
// El plan del robot del portal del SII
// ---------------------------------------------------------------------------

export interface LineaParaPortal {
  nombre: string;
  descripcion?: string | null;
  unidad?: string | null;
  cantidad: number;
  /** Lo que vale la línea con IVA incluido (factura_lineas.monto). */
  monto: number;
  tasa?: number;
}

export interface PlanPortal {
  lineas: Array<{ nombre: string; descripcion: string | null; unidad: string; cantidad: string; precioNeto: string; netoLinea: number }>;
  neto: number;
  iva: number;
  total: number;
}

/** Hasta 6 decimales, con punto y sin ceros de más: lo que el formato del SII admite. */
function decimal6(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * Lo que el robot escribe en el portal, línea por línea.
 *
 * El portal del SII recibe precios NETOS y calcula él el IVA. RutaAhorro
 * guarda precios con IVA. Se reparte el neto de la factura entre las líneas
 * en proporción a su monto (el peso que sobra va a la línea más grande), y el
 * precio de cada unidad es ese neto dividido por la cantidad, con hasta 6
 * decimales. Así la suma del portal da el mismo neto que la base.
 *
 * La suma de las líneas con IVA puede diferir en $1 del total (el `ajuste` de
 * `resumenFactura`): se reparte el neto, no el total. Lo que sí se exige es
 * que `iva` sea el que calculará el portal; si no, no se abre el navegador.
 * Y el robot NO firma si el total que calcula el portal no es `total`: un
 * peso de diferencia en un documento tributario es un documento distinto.
 *
 * Una factura con impuesto adicional (IABA, ILA) no se emite por el portal
 * todavía: hay que elegir el código del impuesto en cada línea y ese campo no
 * se ha probado. Se rechaza con un motivo claro en vez de emitirla mal.
 */
export function planFacturaPortal(lineas: readonly LineaParaPortal[], neto: number, iva: number, total: number): PlanPortal {
  if (lineas.length === 0 || lineas.length > 60) throw new Error('PORTAL_LINEAS_FUERA_DE_RANGO');
  if (lineas.some((l) => (l.tasa ?? 0) > 0)) throw new Error('PORTAL_SIN_IMPUESTO_ADICIONAL');
  if (neto + iva !== total || iva !== ivaDeNeto(neto)) throw new Error('PORTAL_MONTOS_NO_CUADRAN');
  const suma = lineas.reduce((s, l) => s + l.monto, 0);
  if (suma <= 0 || Math.abs(suma - total) > 1) throw new Error('PORTAL_MONTOS_NO_CUADRAN');

  const netos = lineas.map((l) => (suma > 0 ? Math.floor((neto * l.monto) / suma) : 0));
  const sobra = neto - netos.reduce((s, n) => s + n, 0);
  let mayor = 0;
  lineas.forEach((l, i) => { if (l.monto > lineas[mayor].monto) mayor = i; });
  netos[mayor] += sobra;

  return {
    neto, iva, total,
    lineas: lineas.map((l, i) => ({
      nombre: l.nombre.slice(0, 80),
      descripcion: l.descripcion?.slice(0, 1000) ?? null,
      // El portal pide la unidad con 4 letras como máximo.
      unidad: (l.unidad && l.unidad !== 'unidad' ? l.unidad : 'UN').slice(0, 4).toUpperCase(),
      cantidad: decimal6(l.cantidad),
      precioNeto: decimal6(netos[i] / l.cantidad),
      netoLinea: netos[i],
    })),
  };
}
