'use client';

/**
 * Preferencias de ESTE celular (RF-M9-14): no de la cuenta. El celular del
 * mostrador lo usan varias personas; el tamaño de letra y el bloqueo son del
 * aparato, no de quien entró.
 */
export interface Preferencias {
  /** RNF-59 · letra grande para quien ve poco o usa el celular a distancia. */
  letra: 'normal' | 'grande';
  /** RF-M1-19 · minutos sin uso antes de pedir la contraseña. 0 = nunca. */
  bloqueoMin: number;
}

const CLAVE = 'ra:preferencias';
export const PREFERENCIAS_POR_OMISION: Preferencias = { letra: 'normal', bloqueoMin: 0 };
export const EVENTO_PREFERENCIAS = 'ra:preferencias';

export function leerPreferencias(): Preferencias {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE) ?? '{}') as Partial<Preferencias>;
    return {
      letra: p.letra === 'grande' ? 'grande' : 'normal',
      bloqueoMin: [0, 2, 5, 10, 15, 30].includes(Number(p.bloqueoMin)) ? Number(p.bloqueoMin) : 0,
    };
  } catch {
    return PREFERENCIAS_POR_OMISION;
  }
}

export function guardarPreferencias(p: Preferencias) {
  try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch { /* sin almacenamiento, rige hasta recargar */ }
  document.documentElement.dataset.letra = p.letra;
  window.dispatchEvent(new Event(EVENTO_PREFERENCIAS));
}

/**
 * Se inyecta en <head> y corre antes de pintar: sin esto la pantalla aparece
 * con letra normal y salta a grande un instante después.
 */
export const SCRIPT_PREFERENCIAS =
  `try{var p=JSON.parse(localStorage.getItem('${CLAVE}')||'{}');if(p.letra==='grande')document.documentElement.dataset.letra='grande'}catch(e){}`;
