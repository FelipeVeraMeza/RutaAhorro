/**
 * RUT chileno: normalización, dígito verificador y formato.
 * RF-M3-02 — validar el RUT de proveedores.
 */

/** Deja solo dígitos y K: "12.345.678-9" → "123456789". */
export function cleanRut(rut: string): string {
  return String(rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
}

/** Calcula el dígito verificador (módulo 11) del cuerpo numérico. */
export function computeDv(body: string): string {
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

/** true si el RUT es válido, incluido su dígito verificador. */
export function isValidRut(rut: string): boolean {
  const clean = cleanRut(rut);
  if (clean.length < 2) return false;

  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^\d+$/.test(body)) return false;

  // Un RUT de menos de 7 dígitos no existe en la práctica; rechazarlo evita
  // aceptar un número de teléfono mal pegado como si fuera un RUT válido.
  if (body.length < 7) return false;
  // "00.000.000-0" cuadraba el dígito y pasaba: con ceros a la izquierda el
  // largo engañaba. Un RUT es un número de al menos un millón.
  if (Number(body) < 1_000_000) return false;

  return computeDv(body) === dv;
}

/** "123456789" → "12.345.678-9". Devuelve la entrada si no se puede formatear. */
export function formatRut(rut: string): string {
  const clean = cleanRut(rut);
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

// ---------------------------------------------------------------------------
// Entrar con RUT (Felipe, 2026-10-07)
// ---------------------------------------------------------------------------
//
// El personal entra con su RUT y su clave, no con correo: en el mostrador
// nadie se acuerda de un correo y el celular de la caja muestra solo el
// teclado numérico. Supabase autentica por correo, así que cada cuenta con RUT
// tiene un correo técnico (`15620607@rut.rutaahorro.local`) que nadie ve ni
// recibe. Se escribe solo el cuerpo, sin el dígito verificador: así el
// teclado numérico basta, también cuando el dígito es K.

export const DOMINIO_RUT = 'rut.rutaahorro.local';

/**
 * Lo que la persona escribe para entrar → el cuerpo del RUT, o null.
 * "15620607", "15.620.607" y "15.620.607-5" (pegado completo) dan "15620607".
 */
export function rutParaEntrar(texto: string | null | undefined): string | null {
  const cuerpo = String(texto ?? '').split('-')[0].replace(/\D/g, '');
  return /^\d{7,8}$/.test(cuerpo) ? cuerpo : null;
}

/** "15620607" → "15620607@rut.rutaahorro.local". */
export function correoDeRut(cuerpo: string): string {
  return `${cuerpo}@${DOMINIO_RUT}`;
}

/** El correo técnico → "15.620.607-5", para mostrarlo; null si es un correo de verdad. */
export function rutDeCorreo(correo: string | null | undefined): string | null {
  const m = String(correo ?? '').toLowerCase().match(/^(\d{7,8})@(.+)$/);
  if (!m || m[2] !== DOMINIO_RUT) return null;
  return formatRut(m[1] + computeDv(m[1]));
}
