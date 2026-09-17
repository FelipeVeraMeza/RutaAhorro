'use client';

import { maxDiscountFor, type UserRole } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import type { Rol } from '../navegacion';

/**
 * Configuración del local (RF-M9-08).
 *
 * `tenants.settings` existe desde la primera migración, con el IVA, la zona
 * horaria, la moneda, el tope de descuento por rol, el umbral de variación de
 * costo y las horas para avisar una caja sin cerrar. **Ninguna pantalla lo
 * leía.** Los mismos números estaban escritos a mano repartidos por el código:
 * el 19 % del IVA como valor por omisión de `taxIncluded`, el 20 % de
 * variación como valor por omisión de `shouldWarnCostVariation`, la tabla de
 * descuentos por rol en la pantalla de usuarios.
 *
 * Mientras coincidan, no se nota. El día que un local tenga otro IVA —o que
 * este cliente quiera avisar la variación de costo al 10 % en vez del 20 %—
 * no hay dónde cambiarlo, y el valor escrito en el navegador gana por sobre el
 * que diga la base.
 *
 * Se lee una vez por sesión: son datos que cambian cuando el dueño los cambia,
 * no entre una venta y la siguiente.
 */
export interface ConfiguracionLocal {
  /** Porcentaje de IVA. El precio lo incluye; el IVA se extrae, nunca se suma. */
  ivaPct: number;
  /** A partir de qué variación de costo se avisa en la recepción. */
  variacionCostoPct: number;
  /** Horas que pueden pasar antes de avisar una caja sin cerrar. */
  horasAvisoCaja: number;
  zonaHoraria: string;
  moneda: string;
  /** Tope de descuento por rol, si el local configuró alguno. */
  topeDescuento: Partial<Record<Rol, number>>;
}

/**
 * Los mismos valores que ya estaban por omisión en core y en el esquema.
 *
 * Están acá para que un local sin configurar se comporte igual que antes, y
 * para que el modo demo no dependa de una consulta.
 */
export const CONFIGURACION_POR_OMISION: ConfiguracionLocal = {
  ivaPct: 19,
  variacionCostoPct: 20,
  horasAvisoCaja: 12,
  zonaHoraria: 'America/Santiago',
  moneda: 'CLP',
  topeDescuento: {},
};

interface SettingsBD {
  iva_pct?: number | string;
  cost_variation_alert_pct?: number | string;
  cash_alert_hours?: number | string;
  timezone?: string;
  currency?: string;
  max_discount_pct?: Partial<Record<Rol, number>>;
}

function numero(valor: unknown, porOmision: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : porOmision;
}

let cache: Promise<ConfiguracionLocal> | null = null;

async function leer(): Promise<ConfiguracionLocal> {
  if (DEMO_ACTIVO) return CONFIGURACION_POR_OMISION;

  const { data, error } = await supabase().from('tenants').select('settings').maybeSingle();
  // Si no se puede leer, se sigue con los valores por omisión: quedarse sin
  // vender porque no cargó la configuración sería mucho peor que cobrar con el
  // IVA por omisión, que además es el que corresponde en Chile.
  if (error || !data) return CONFIGURACION_POR_OMISION;

  const s = (data.settings ?? {}) as SettingsBD;
  return {
    ivaPct: numero(s.iva_pct, CONFIGURACION_POR_OMISION.ivaPct),
    variacionCostoPct: numero(s.cost_variation_alert_pct, CONFIGURACION_POR_OMISION.variacionCostoPct),
    horasAvisoCaja: numero(s.cash_alert_hours, CONFIGURACION_POR_OMISION.horasAvisoCaja),
    zonaHoraria: s.timezone || CONFIGURACION_POR_OMISION.zonaHoraria,
    moneda: s.currency || CONFIGURACION_POR_OMISION.moneda,
    topeDescuento: s.max_discount_pct ?? {},
  };
}

/** Configuración del local. Se consulta una vez y se reutiliza. */
export function configuracionLocal(): Promise<ConfiguracionLocal> {
  cache ??= leer();
  return cache;
}

/** Olvida lo leído. Para después de guardar un cambio de configuración. */
export function olvidarConfiguracion() {
  cache = null;
}

/** Tope de descuento que le corresponde a un rol en este local. */
export async function topeDescuentoDe(rol: Rol): Promise<number> {
  const { topeDescuento } = await configuracionLocal();
  return maxDiscountFor(rol as UserRole, topeDescuento);
}
