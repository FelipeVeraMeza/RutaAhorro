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
