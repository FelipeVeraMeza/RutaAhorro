/**
 * Reglas de la operación diaria que no dependen de la base (docs/25).
 *
 * Cada función cita el requerimiento que sostiene. Viven en core porque son
 * cuentas —dinero, cantidades, horas— y las cuentas se prueban, no se miran.
 */
import { admiteDecimales } from './money.js';

// ------------------------------------------------------------ RF-M5-28
/**
 * Redondeo del pago en efectivo (Ley 20.956, 2017): sin monedas de $1 ni $5,
 * el total que se cobra en efectivo termina en 0. Terminados en 1 a 5 bajan a
 * la decena; en 6 a 9 suben. Solo para efectivo: con tarjeta o transferencia
 * se cobra el monto exacto.
 */
export function redondeoEfectivo(total: number): number {
  const resto = total % 10;
  return resto <= 5 ? total - resto : total + (10 - resto);
}

// ------------------------------------------------------------ RF-M5-26, RF-M5-27
/**
 * Un recibido que parece error de tecleo: diez veces el total o más (escribir
 * 100.000 por 10.000) o sobre $500.000. No bloquea: pregunta.
 */
export function montoRecibidoAtipico(recibido: number, total: number): boolean {
  if (recibido <= 0 || total <= 0) return false;
  return recibido >= total * 10 && recibido - total >= 20_000 || recibido > 500_000;
}

/** Una cantidad que parece error de tecleo: 100 o más unidades, o 50 kg o más. */
export function cantidadAtipica(cantidad: number, unidad?: string | null): boolean {
  return admiteDecimales(unidad) ? cantidad >= 50 : cantidad >= 100;
}

// ------------------------------------------------------------ RF-M2-21
/**
 * Un precio que no termina en 0 obliga a redondear al cobrar en efectivo: el
 * cliente paga distinto según el medio de pago y el cajero duda. Se avisa al
 * ponerlo, no se prohíbe (un producto por kilo puede quedar en cualquier
 * monto).
 */
export function precioConRedondeo(precio: number): boolean {
  return Number.isInteger(precio) && precio > 0 && precio % 10 !== 0;
}

// ------------------------------------------------------------ RF-M6-13
/** Billetes y monedas en circulación en Chile, de mayor a menor. */
export const DENOMINACIONES_CLP = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10] as const;

/** El total contado a partir de cuántos hay de cada billete y moneda. */
export function totalArqueo(conteo: Partial<Record<number, number>>): number {
  return DENOMINACIONES_CLP.reduce((s, d) => s + d * Math.max(0, Math.floor(conteo[d] ?? 0)), 0);
}

// ------------------------------------------------------------ RF-M2-18
export interface ProductoParaRevisar {
  id: string;
  nombre: string;
  codigos: string[];
  costo?: number | null;
  stockMinimo: number;
  categoriaId: string | null;
  precio: number;
  perecible: boolean;
}

export type ProblemaCatalogo = 'sin_codigo' | 'sin_costo' | 'sin_minimo' | 'sin_categoria' | 'precio_con_redondeo';

export const TEXTO_PROBLEMA: Record<ProblemaCatalogo, string> = {
  sin_codigo: 'Sin código de barras: no se puede escanear',
  sin_costo: 'Sin costo: no hay margen ni inventario valorizado',
  sin_minimo: 'Sin stock mínimo: nunca avisa que hay que reponer',
  sin_categoria: 'Sin categoría: no aparece en los reportes por categoría',
  precio_con_redondeo: 'Precio que no termina en 0: en efectivo hay que redondear',
};

/**
 * Qué le falta a cada producto para que el sistema trabaje bien con él.
 * `revisarCosto` es falso para quien no ve costos: no se le reporta lo que no
 * puede ver ni arreglar.
 */
export function calidadCatalogo(productos: readonly ProductoParaRevisar[], revisarCosto: boolean) {
  const conteo: Record<ProblemaCatalogo, number> = {
    sin_codigo: 0, sin_costo: 0, sin_minimo: 0, sin_categoria: 0, precio_con_redondeo: 0,
  };
  const porProducto = new Map<string, ProblemaCatalogo[]>();
  for (const p of productos) {
    const problemas: ProblemaCatalogo[] = [];
    if (p.codigos.length === 0) problemas.push('sin_codigo');
    if (revisarCosto && !(p.costo && p.costo > 0)) problemas.push('sin_costo');
    if (!(p.stockMinimo > 0)) problemas.push('sin_minimo');
    if (!p.categoriaId) problemas.push('sin_categoria');
    if (precioConRedondeo(p.precio)) problemas.push('precio_con_redondeo');
    for (const x of problemas) conteo[x]++;
    if (problemas.length) porProducto.set(p.id, problemas);
  }
  return { conteo, porProducto, completos: productos.length - porProducto.size };
}

// ------------------------------------------------------------ RF-M4-21
export interface ProductoEnSala {
  id: string;
  nombre: string;
  sala: number;
  bodega: number;
  minimo: number;
  unidad?: string | null;
}

/**
 * Qué pasar de la bodega a la sala: lo que en la sala está en cero o bajo su
 * mínimo y tiene en bodega. Se sugiere llegar al doble del mínimo sin pasarse
 * de lo que hay guardado; sin mínimo y con la sala vacía, todo lo de bodega.
 */
export function sugerirReposicion(productos: readonly ProductoEnSala[]) {
  return productos
    .filter((p) => p.bodega > 0 && (p.sala <= 0 || (p.minimo > 0 && p.sala < p.minimo)))
    .map((p) => {
      const objetivo = p.minimo > 0 ? p.minimo * 2 - Math.max(p.sala, 0) : p.bodega;
      const bruto = Math.min(p.bodega, Math.max(objetivo, 0));
      const mover = admiteDecimales(p.unidad) ? Math.round(bruto * 1000) / 1000 : Math.floor(bruto);
      return { ...p, mover };
    })
    .filter((p) => p.mover > 0)
    .sort((a, b) => (a.sala <= 0 ? 0 : 1) - (b.sala <= 0 ? 0 : 1) || a.nombre.localeCompare(b.nombre, 'es'));
}

// ------------------------------------------------------------ RF-M7-14
export type ClaseABC = 'A' | 'B' | 'C';

/**
 * Clasificación ABC (Pareto): A son los que juntan el primer 80 % de lo
 * vendido, B el siguiente 15 %, C el último 5 %. Dice dónde no puede faltar
 * stock (A) y qué se puede dejar de comprar (C).
 */
export function clasificacionABC<T extends { ingresos: number }>(filas: readonly T[]): Array<T & { clase: ClaseABC; acumuladoPct: number }> {
  const total = filas.reduce((s, f) => s + Math.max(f.ingresos, 0), 0);
  let acumulado = 0;
  return [...filas]
    .sort((a, b) => b.ingresos - a.ingresos)
    .map((f) => {
      // La clase se decide por dónde EMPIEZA el producto en la curva: el que
      // cruza el 80 % todavía es A.
      const antes = total ? (acumulado / total) * 100 : 100;
      acumulado += Math.max(f.ingresos, 0);
      const clase: ClaseABC = antes < 80 ? 'A' : antes < 95 ? 'B' : 'C';
      return { ...f, clase, acumuladoPct: total ? Math.round((acumulado / total) * 1000) / 10 : 0 };
    });
}

// ------------------------------------------------------------ RF-M7-13
/** La hora (0 a 23) de un instante en la zona del local. */
export function horaLocal(instante: Date | string, zona: string): number {
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: zona, hour: '2-digit', hourCycle: 'h23' }).format(d));
}

/** Ventas y monto por hora del día, las 24 horas aunque alguna quede en cero. */
export function ventasPorHora(ventas: ReadonlyArray<{ fecha: string; total: number }>, zona: string) {
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, ventas: 0, total: 0 }));
  for (const v of ventas) {
    const h = horas[horaLocal(v.fecha, zona)];
    h.ventas++;
    h.total += v.total;
  }
  return horas;
}
