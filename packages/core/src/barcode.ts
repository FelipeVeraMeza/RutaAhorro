/**
 * Códigos de barras.
 *
 * Validar el dígito de control importa en el POS: una lectura mal enfocada puede
 * devolver 13 dígitos que parecen un código pero no lo son. Sin esta
 * verificación, el cajero crearía productos fantasma cada vez que la cámara
 * lea mal (RF-M5-04 ofrece crear el producto ante un código desconocido).
 */

export type BarcodeFormat = 'EAN-13' | 'EAN-8' | 'UPC-A' | 'UPC-E' | 'CODE-128' | 'DESCONOCIDO';

/** Dígito de control para EAN/UPC (módulo 10, pesos 3 y 1). */
function checkDigit(digits: string): number {
  let sum = 0;
  // El peso se aplica de derecha a izquierda empezando por 3.
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** Verifica el dígito de control de un EAN-13, EAN-8, UPC-A o UPC-E. */
export function isValidEan(code: string): boolean {
  const c = String(code ?? '').trim();
  if (!/^\d+$/.test(c)) return false;
  if (![8, 12, 13].includes(c.length)) return false;
  return checkDigit(c.slice(0, -1)) === Number(c.slice(-1));
}

/** Identifica el formato por longitud. */
export function detectFormat(code: string): BarcodeFormat {
  const c = String(code ?? '').trim();
  if (!/^\d+$/.test(c)) return 'CODE-128';
  switch (c.length) {
    case 13: return 'EAN-13';
    case 12: return 'UPC-A';
    case 8:  return 'EAN-8';
    case 6:  return 'UPC-E';
    default: return 'DESCONOCIDO';
  }
}

/**
 * Normaliza un código para buscarlo en el catálogo.
 * Un UPC-A (12 dígitos) y el mismo producto como EAN-13 con un 0 al frente son
 * el mismo artículo. Sin normalizar, el mismo producto escaneado desde envases
 * distintos parecería ser dos productos.
 */
export function normalizeBarcode(code: string): string {
  const c = String(code ?? '').trim().toUpperCase();
  if (/^\d{12}$/.test(c)) return `0${c}`;
  return c;
}

/** Genera un código interno EAN-13 válido para productos sin código de fábrica (RF-M2-13). */
export function generateInternalBarcode(sequence: number): string {
  // Prefijo 200-299: rango reservado por GS1 para uso interno del comercio.
  // Usarlo garantiza que nunca chocará con el código de un producto de fábrica.
  const body = `200${String(sequence).padStart(9, '0')}`.slice(0, 12);
  return body + String(checkDigit(body));
}
