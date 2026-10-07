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

/**
 * Cuántas lecturas iguales y seguidas hacen falta para aceptar un código de la
 * cámara, o 0 si la lectura se descarta.
 *
 * La cámara lee ~15 cuadros por segundo y aceptaba el primero. Un cuadro
 * movido o un código a medio entrar devuelve otro número, y el carrito se
 * llenaba de productos equivocados o de "no está en el catálogo" (Felipe,
 * 2026-10-06: "lee muy rápido y no lee bien"). Un EAN/UPC con su dígito de
 * control bien se confirma con 2 lecturas; ITF, Code 39 y Code 128 se inventan
 * más fácil a partir de un trozo de otro código y piden 3.
 */
export function lecturasNecesarias(code: string, formato?: string): number {
  const c = String(code ?? '').trim();
  if (c === '') return 0;
  const f = (formato ?? '').toLowerCase().replace(/-/g, '_');
  if (f === 'upc_e') return 2; // su dígito de control es del UPC-A expandido
  if (f === 'itf' || f === 'code_39' || f === 'codabar') return 3;
  if (/^\d+$/.test(c) && [8, 12, 13].includes(c.length)) return isValidEan(c) ? 2 : 0;
  return 3;
}

/**
 * Junta las lecturas de la cámara y dice cuándo un código quedó confirmado.
 *
 * Confirma una sola vez por racha: mientras el mismo código siga en cuadro no
 * se vuelve a sumar al carrito. Para el segundo yogur igual hay que sacar el
 * primero de la cámara (`ventanaMs` sin leerlo) y pasar el otro.
 */
export class ConfirmadorLecturas {
  private candidato = '';
  private veces = 0;
  private ultimaLectura = 0;

  constructor(private readonly ventanaMs = 700) {}

  /** Registra una lectura. Devuelve true la vez que el código queda confirmado. */
  registrar(code: string, ahora: number, formato?: string): boolean {
    const necesarias = lecturasNecesarias(code, formato);
    if (necesarias === 0) return false;
    if (code === this.candidato && ahora - this.ultimaLectura <= this.ventanaMs) {
      this.veces++;
    } else {
      this.candidato = code;
      this.veces = 1;
    }
    this.ultimaLectura = ahora;
    return this.veces === necesarias;
  }

  reiniciar(): void {
    this.candidato = '';
    this.veces = 0;
    this.ultimaLectura = 0;
  }
}
