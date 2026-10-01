'use client';

import { useMemo } from 'react';
import { useConfiguracion } from './datos/configuracion';

/**
 * Fechas y horas para mostrar, en la zona del local (`tenants.settings`).
 *
 * Antes cada pantalla tenía sus propios formateadores con 'America/Santiago'
 * escrito a mano: cinco copias del mismo valor, y ninguna leía la
 * configuración que la base ya tenía.
 */
/**
 * Reloj de 24 horas ("14:05"), no "2:05 p. m.": el servidor (Node) y el
 * navegador escriben el "p. m." con espacios distintos (uno normal y otro
 * duro), y React tiraba el HTML del servidor y redibujaba toda la Caja en
 * cada visita ("Hydration failed", visto con tools/ui en /caja). Además en
 * un comprobante o un arqueo 24 h no se presta a confusión.
 */
export function formatoHora(iso: string, zona: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zona });
}

export function formatoFecha(iso: string, zona: string): string {
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: zona });
}

/**
 * "30-09 22:50". Armado a mano: `toLocaleString('es-CL')` da "30-09, 22:50"
 * en Node y "30/9, 22:50" en Chrome, así que el mismo dato salía distinto en
 * Ventas que en el Inicio, y el HTML del servidor no calzaba al hidratar.
 */
export function formatoFechaHora(iso: string, zona: string): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zona,
  }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}-${v('month')} ${v('hour')}:${v('minute')}`;
}

/**
 * "2026-09-30 22:50", para planillas: "30-09 22:50" no lleva año, y un
 * contador que exporta un rango de diciembre a enero no podía ordenarlo.
 */
export function formatoFechaHoraPlanilla(iso: string, zona: string): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zona,
  }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')} ${v('hour')}:${v('minute')}`;
}

export function useFormatoFecha() {
  const { zonaHoraria: zona } = useConfiguracion();
  return useMemo(() => ({
    zona,
    hora: (iso: string) => formatoHora(iso, zona),
    fecha: (iso: string) => formatoFecha(iso, zona),
    fechaHora: (iso: string) => formatoFechaHora(iso, zona),
    fechaHoraPlanilla: (iso: string) => formatoFechaHoraPlanilla(iso, zona),
  }), [zona]);
}

/**
 * Un día sin hora ('AAAA-MM-DD') como 'DD-MM-AAAA', tal cual. Pasarlo por
 * `new Date` lo lee como medianoche UTC y en Chile lo muestra el día anterior
 * (regla 17): una factura del 28 aparecía del 27.
 */
export const diaCorto = (dia: string) => dia.split('-').reverse().join('-');
