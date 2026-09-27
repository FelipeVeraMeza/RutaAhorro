'use client';

import { maxDiscountFor, type UserRole } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import type { Rol } from '../navegacion';
import { useEffect, useState } from 'react';
import { CONFIGURACION_POR_OMISION, desdeSettings, type ConfiguracionLocal } from './configuracionBase';

export { CONFIGURACION_POR_OMISION, type ConfiguracionLocal };

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
let cache: Promise<ConfiguracionLocal> | null = null;

const CLAVE_DEMO = 'demo:configuracion';

async function leer(): Promise<ConfiguracionLocal> {
  if (DEMO_ACTIVO) {
    const { getMeta } = await import('../offline/db');
    const guardada = await getMeta(CLAVE_DEMO);
    return guardada ? desdeSettings(JSON.parse(guardada)) : CONFIGURACION_POR_OMISION;
  }

  const { data, error } = await supabase().from('tenants').select('settings').maybeSingle();
  // Si no se puede leer, se sigue con los valores por omisión: quedarse sin
  // vender porque no cargó la configuración sería mucho peor que cobrar con el
  // IVA por omisión, que además es el que corresponde en Chile.
  if (error || !data) return CONFIGURACION_POR_OMISION;

  return desdeSettings(data.settings);
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

/**
 * La configuración del local para un componente. Arranca con los valores por
 * omisión y se actualiza apenas llega la de la base, que queda en caché para
 * el resto de la sesión.
 */
export function useConfiguracion(): ConfiguracionLocal {
  const [config, setConfig] = useState(CONFIGURACION_POR_OMISION);
  useEffect(() => {
    let vivo = true;
    void configuracionLocal().then((c) => { if (vivo) setConfig(c); });
    return () => { vivo = false; };
  }, []);
  return config;
}

/**
 * Lo que el administrador puede cambiar desde la pantalla (T-18). Las mismas
 * claves y rangos que acepta `fn_guardar_configuracion` (0018): el IVA y la
 * zona horaria no se cambian desde acá.
 */
export interface CambiosConfiguracion {
  vender_sin_stock?: boolean;
  tarjeta_emite_documento?: boolean;
  efectivo_inicial_sugerido?: number;
  cash_alert_hours?: number;
  cost_variation_alert_pct?: number;
}

export async function guardarConfiguracion(cambios: CambiosConfiguracion): Promise<ConfiguracionLocal> {
  if (DEMO_ACTIVO) {
    const { getMeta, setMeta } = await import('../offline/db');
    const actual = JSON.parse((await getMeta(CLAVE_DEMO)) ?? '{}');
    const nueva = { ...actual, ...cambios };
    await setMeta(CLAVE_DEMO, JSON.stringify(nueva));
    olvidarConfiguracion();
    return desdeSettings(nueva);
  }
  const { data, error } = await supabase().rpc('fn_guardar_configuracion', { p_cambios: cambios });
  if (error) throw error;
  olvidarConfiguracion();
  return desdeSettings(data);
}
