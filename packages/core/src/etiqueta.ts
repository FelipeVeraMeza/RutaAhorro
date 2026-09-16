/**
 * Dibujo de códigos de barra EAN-13 para imprimir etiquetas (RF-M2-13).
 *
 * El local necesita etiquetar los productos que no traen código de fábrica:
 * los que vende a granel, los que arma él, o aquellos cuyo envase llegó sin
 * código legible. `generateInternalBarcode()` ya genera el número; esto lo
 * convierte en las barras que el lector puede leer.
 *
 * Se dibuja a mano y no con una librería por una razón concreta: un EAN-13
 * son 95 módulos y tres tablas de 10 filas. Traer una dependencia para eso
 * agregaría peso al bundle del POS —que se carga en celulares con señal
 * mala— a cambio de un archivo que cabe en una pantalla y se puede probar
 * entero.
 *
 * Nada de este módulo toca el DOM: devuelve texto SVG.
 */
import { isValidEan } from './barcode.js';

// Los dígitos del grupo izquierdo se codifican en L o en G según el primer
// dígito; los del derecho siempre en R. R es el complemento de L, y G es R al
// revés: las tres tablas están probadas contra esas dos relaciones.
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

/**
 * Qué dígitos del grupo izquierdo van en G. El primer dígito del código no se
 * dibuja como barras: se codifica en este patrón de paridades, y por eso un
 * EAN-13 cabe en el mismo ancho que un EAN-12.
 */
const PARIDAD = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

const GUARDA_LATERAL = '101';
const GUARDA_CENTRAL = '01010';

/** Ancho total de un EAN-13 en módulos: 3 + 42 + 5 + 42 + 3. */
export const MODULOS_EAN13 = 95;

/**
 * Convierte un EAN-13 en su patrón de módulos: una cadena de 95 caracteres
 * donde '1' es barra y '0' es espacio.
 *
 * Devuelve null si el código no es un EAN-13 válido. No lanza: dibujar la
 * etiqueta de un producto mal cargado no puede voltear la pantalla completa
 * cuando se están imprimiendo cincuenta.
 */
export function modulosEan13(codigo: string): string | null {
  const c = String(codigo ?? '').trim();
  if (!/^\d{13}$/.test(c) || !isValidEan(c)) return null;

  const primero = Number(c[0]);
  const izquierda = c.slice(1, 7);
  const derecha = c.slice(7);

  let modulos = GUARDA_LATERAL;
  for (let i = 0; i < 6; i++) {
    const d = Number(izquierda[i]);
    modulos += PARIDAD[primero][i] === 'L' ? L[d] : G[d];
  }
  modulos += GUARDA_CENTRAL;
  for (let i = 0; i < 6; i++) {
    modulos += R[Number(derecha[i])];
  }
  modulos += GUARDA_LATERAL;

  return modulos;
}

export interface OpcionesEtiqueta {
  /** Ancho de cada módulo, en milímetros. El mínimo legible es 0,26 mm. */
  anchoModulo?: number;
  /** Alto de las barras, en milímetros. */
  altoBarras?: number;
  /** Mostrar los dígitos bajo las barras. */
  conNumeros?: boolean;
  /** Texto sobre el código: el nombre del producto. */
  titulo?: string;
  /** Texto bajo el código: normalmente el precio. */
  pie?: string;
}

/**
 * Dibuja el código como SVG, listo para imprimir.
 *
 * Las medidas van en milímetros porque la etiqueta se imprime, no se mira en
 * pantalla: un código escalado a píxeles puede verse bien en el monitor y
 * salir ilegible para el lector. La zona de silencio de los costados es parte
 * del estándar y no es decorativa — sin ella, muchos lectores no enganchan.
 */
export function etiquetaSvg(codigo: string, opciones: OpcionesEtiqueta = {}): string | null {
  const modulos = modulosEan13(codigo);
  if (!modulos) return null;

  const {
    anchoModulo = 0.33,
    altoBarras = 18,
    conNumeros = true,
    titulo,
    pie,
  } = opciones;

  // 9 módulos de silencio a la izquierda y 7 a la derecha, por norma.
  const silencioIzq = 9 * anchoModulo;
  const silencioDer = 7 * anchoModulo;
  const anchoCodigo = MODULOS_EAN13 * anchoModulo;
  const ancho = silencioIzq + anchoCodigo + silencioDer;

  const altoTitulo = titulo ? 4 : 0;
  // Las bandas de los números y del pie tienen que dejar espacio para su
  // propia tipografía. Con menos, la línea de base del precio cae encima de
  // los dígitos del código y la etiqueta sale ilegible justo donde importa.
  const altoNumeros = conNumeros ? 4.2 : 0;
  const altoPie = pie ? 6 : 0;
  const alto = altoTitulo + altoBarras + altoNumeros + altoPie + 1;

  const yBarras = altoTitulo;
  // Las guardas bajan un poco más que el resto: es lo que separa visualmente
  // los grupos y ayuda al lector a encuadrar.
  const bajada = conNumeros ? 2.6 : 0;

  const esGuarda = (i: number) =>
    i < 3 || (i >= 45 && i < 50) || i >= 92;

  const barras: string[] = [];
  for (let i = 0; i < modulos.length; i++) {
    if (modulos[i] !== '1') continue;
    const x = silencioIzq + i * anchoModulo;
    const h = altoBarras + (esGuarda(i) ? bajada : 0);
    barras.push(
      `<rect x="${redondear(x)}" y="${redondear(yBarras)}" width="${redondear(anchoModulo)}" height="${redondear(h)}" fill="#000"/>`,
    );
  }

  const partes: string[] = [];
  partes.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${redondear(ancho)}mm" height="${redondear(alto)}mm" viewBox="0 0 ${redondear(ancho)} ${redondear(alto)}" role="img" aria-label="Código de barras ${codigo}">`,
  );
  partes.push(`<rect width="${redondear(ancho)}" height="${redondear(alto)}" fill="#fff"/>`);

  if (titulo) {
    partes.push(
      `<text x="${redondear(ancho / 2)}" y="2.9" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="2.6" fill="#000">${escapar(recortar(titulo, 34))}</text>`,
    );
  }

  partes.push(barras.join(''));

  if (conNumeros) {
    const yTexto = yBarras + altoBarras + bajada + 0.4;
    const fuente = 'font-family="Courier New, monospace" font-size="3" fill="#000"';
    // El primer dígito va fuera de las barras, a la izquierda: es el que se
    // codifica en el patrón de paridad y no tiene barras propias.
    partes.push(`<text x="0" y="${redondear(yTexto + 2.6)}" ${fuente}>${codigo[0]}</text>`);
    partes.push(
      `<text x="${redondear(silencioIzq + 3 * anchoModulo + 21 * anchoModulo)}" y="${redondear(yTexto + 2.6)}" text-anchor="middle" ${fuente}>${codigo.slice(1, 7)}</text>`,
    );
    partes.push(
      `<text x="${redondear(silencioIzq + 50 * anchoModulo + 21 * anchoModulo)}" y="${redondear(yTexto + 2.6)}" text-anchor="middle" ${fuente}>${codigo.slice(7)}</text>`,
    );
  }

  if (pie) {
    partes.push(
      `<text x="${redondear(ancho / 2)}" y="${redondear(alto - 1.5)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="3.6" font-weight="bold" fill="#000">${escapar(recortar(pie, 20))}</text>`,
    );
  }

  partes.push('</svg>');
  return partes.join('');
}

function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function recortar(texto: string, max: number): string {
  const t = String(texto ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** El SVG se inserta como markup: un nombre de producto con `<` lo rompería. */
function escapar(texto: string): string {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
