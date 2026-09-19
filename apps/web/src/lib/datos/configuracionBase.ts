import type { Rol } from '../navegacion';

/**
 * Lo que comparten el navegador y el servidor sobre la configuración del
 * local: la forma, los valores por omisión y cómo se leen de
 * `tenants.settings`. Vive aparte de `configuracion.ts` porque ese módulo es
 * de cliente, y un componente de servidor que importa una constante desde un
 * módulo de cliente recibe una referencia, no el valor.
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
  /**
   * `true` si el terminal de tarjetas de este local emite el documento. Con
   * una máquina integrada el voucher ES la boleta, y emitir otra declararía la
   * venta dos veces. Un local con máquina no integrada lo pone en false.
   */
  tarjetaEmiteDocumento: boolean;
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
  tarjetaEmiteDocumento: true,
};

interface SettingsBD {
  iva_pct?: number | string;
  cost_variation_alert_pct?: number | string;
  cash_alert_hours?: number | string;
  timezone?: string;
  currency?: string;
  max_discount_pct?: Partial<Record<Rol, number>>;
  tarjeta_emite_documento?: boolean;
}

function numero(valor: unknown, porOmision: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : porOmision;
}

/**
 * Una zona que `Intl` no conoce rompería cada fecha de cada pantalla con un
 * RangeError. Mejor seguir con la de omisión que dejar el local sin sistema.
 */
function zonaValida(zona: unknown): string {
  if (typeof zona !== 'string' || zona === '') return CONFIGURACION_POR_OMISION.zonaHoraria;
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: zona });
    return zona;
  } catch {
    return CONFIGURACION_POR_OMISION.zonaHoraria;
  }
}

/** Convierte `tenants.settings` en la configuración, completando lo que falte. */
export function desdeSettings(settings: unknown): ConfiguracionLocal {
  const s = (settings ?? {}) as SettingsBD;
  return {
    ivaPct: numero(s.iva_pct, CONFIGURACION_POR_OMISION.ivaPct),
    variacionCostoPct: numero(s.cost_variation_alert_pct, CONFIGURACION_POR_OMISION.variacionCostoPct),
    horasAvisoCaja: numero(s.cash_alert_hours, CONFIGURACION_POR_OMISION.horasAvisoCaja),
    zonaHoraria: zonaValida(s.timezone),
    moneda: s.currency || CONFIGURACION_POR_OMISION.moneda,
    topeDescuento: s.max_discount_pct ?? {},
    tarjetaEmiteDocumento:
      s.tarjeta_emite_documento ?? CONFIGURACION_POR_OMISION.tarjetaEmiteDocumento,
  };
}
