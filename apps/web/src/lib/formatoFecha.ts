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
export function formatoHora(iso: string, zona: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: zona });
}

export function formatoFecha(iso: string, zona: string): string {
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: zona });
}

export function formatoFechaHora(iso: string, zona: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: zona,
  });
}

export function useFormatoFecha() {
  const { zonaHoraria: zona } = useConfiguracion();
  return useMemo(() => ({
    zona,
    hora: (iso: string) => formatoHora(iso, zona),
    fecha: (iso: string) => formatoFecha(iso, zona),
    fechaHora: (iso: string) => formatoFechaHora(iso, zona),
  }), [zona]);
}
