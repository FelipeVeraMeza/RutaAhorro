/**
 * Tendencia de ventas (RF-M7-10) y comparación con el período anterior
 * (RF-M7-11).
 *
 * Vive en core y no en la pantalla porque es aritmética de fechas, que es
 * donde este proyecto ya se equivocó varias veces (regla 17): días sin ventas
 * que desaparecían del gráfico y dejaban barras corridas, o un "período
 * anterior" que no medía lo mismo que el actual.
 */
import { sumarDias } from './fechas.js';

export interface PuntoDia {
  /** 'AAAA-MM-DD' en la zona del local. */
  fecha: string;
  total: number;
  ventas: number;
}

/** Cuántos días hay entre dos fechas 'AAAA-MM-DD', contando ambas. */
export function diasEnRango(desde: string, hasta: string): number {
  const [a, b] = [desde, hasta].map((f) => {
    const [y, m, d] = f.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Un punto por día del rango, en orden, con cero los días sin ventas. La base
 * solo devuelve los días que tuvieron ventas: sin esto, un domingo cerrado
 * hacía que el gráfico pegara el sábado con el lunes.
 */
export function serieCompleta(puntos: readonly PuntoDia[], desde: string, hasta: string): PuntoDia[] {
  const porFecha = new Map(puntos.map((p) => [p.fecha, p]));
  const n = diasEnRango(desde, hasta);
  const salida: PuntoDia[] = [];
  for (let i = 0; i < n; i++) {
    const fecha = sumarDias(desde, i);
    salida.push(porFecha.get(fecha) ?? { fecha, total: 0, ventas: 0 });
  }
  return salida;
}

/**
 * El período anterior de igual largo, pegado al actual. Del 8 al 14 de
 * octubre (7 días) → del 1 al 7. Así "vs anterior" compara lo mismo.
 */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const n = diasEnRango(desde, hasta);
  return { desde: sumarDias(desde, -n), hasta: sumarDias(desde, -1) };
}

/**
 * Variación porcentual redondeada. null si antes no hubo nada: "+∞ %" o
 * "+100 %" sobre cero no le dicen nada al dueño.
 */
export function variacionPct(actual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

/** "+12 %", "−8 %", "igual" o null, para mostrar al lado de una cifra. */
export function textoVariacion(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct === 0) return 'igual';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`;
}

export const sumaTotales = (puntos: readonly PuntoDia[]) =>
  puntos.reduce((s, p) => ({ total: s.total + p.total, ventas: s.ventas + p.ventas }), { total: 0, ventas: 0 });

/** Minutos desde la medianoche del local (0 a 1439) para un instante. */
export function minutoDelDia(instante: Date | string, zona: string): number {
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  const partes = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zona })
    .formatToParts(d);
  const h = Number(partes.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(partes.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/**
 * RF-M7-11 · Lo vendido en un día hasta cierta hora del local. El Inicio
 * comparaba lo que va de hoy (a las 10:00, la mañana) con el mismo día de la
 * semana pasada COMPLETO, y marcaba "−84 %" todos los días antes del cierre.
 */
export function totalHastaMinuto(
  ventas: ReadonlyArray<{ fecha: string; total: number }>, hastaMinuto: number, zona: string,
): number {
  return ventas.reduce((s, v) => (minutoDelDia(v.fecha, zona) <= hastaMinuto ? s + v.total : s), 0);
}
