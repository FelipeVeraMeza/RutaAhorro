'use client';

/**
 * Productos frecuentes de este celular (RF-M5-25): los que más se venden
 * acá, para agregarlos de un toque. Lo que no tiene código (el pan, la bolsa
 * de hielo) se buscaba por nombre en cada venta.
 *
 * Se cuenta en el dispositivo (localStorage), no en la base: responde sin
 * internet y refleja lo que vende ESTE mostrador.
 */
const CLAVE = 'pos:frecuentes';
const MAXIMO_GUARDADOS = 60;

function leer(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(CLAVE) ?? '{}') as Record<string, number>; } catch { return {}; }
}

export function contarVendidos(productIds: string[]) {
  try {
    const c = leer();
    for (const id of productIds) c[id] = (c[id] ?? 0) + 1;
    // Se guardan los más vendidos: el resto no aporta y la clave crecería sin fin.
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, MAXIMO_GUARDADOS);
    localStorage.setItem(CLAVE, JSON.stringify(Object.fromEntries(top)));
  } catch { /* sin almacenamiento, no hay frecuentes */ }
}

/** Los ids más vendidos, del más al menos. */
export function masVendidos(n = 8): string[] {
  return Object.entries(leer()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}
