/**
 * Ficha de un producto a partir de su código de barras (docs/30).
 *
 * La fuente es Open Food Facts (https://world.openfoodfacts.org), una base
 * pública y gratuita. Prueba del 2026-10-09 con el catálogo real: tiene ~16 %
 * de los productos (los de marcas grandes), todos con foto. Para el resto se
 * sigue escribiendo a mano y la foto se saca con el celular.
 *
 * Sus fotos son CC BY-SA: quien las muestra tiene que citar la fuente (la
 * tienda lo dice al pie cuando alguna foto viene de ahí).
 */

export interface FichaPorCodigo {
  /** Nombre sugerido para el catálogo: "El Manjar Nestlé 1 kg". */
  nombre: string;
  marca: string | null;
  cantidad: string | null;
  /** Descripción sugerida: "El Manjar · Nestlé · 1 kg". */
  descripcion: string;
  /** Foto del frente, o null si no tiene. */
  imagen: string | null;
}

/** Hosts desde donde se acepta copiar una foto (evita que el servidor descargue cualquier dirección). */
export const HOSTS_FOTOS_CODIGO = ['images.openfoodfacts.org', 'static.openfoodfacts.org'];

export function urlFichaPorCodigo(codigo: string): string {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(codigo)}.json` +
    '?fields=product_name,product_name_es,brands,quantity,image_front_url,image_url';
}

const limpiar = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const contiene = (texto: string, parte: string) => texto.toLowerCase().includes(parte.toLowerCase());

/**
 * Lee la respuesta de Open Food Facts. Null si el producto no está o no
 * trae ni siquiera un nombre (una ficha sin nombre no ayuda a nadie).
 */
export function leerFichaPorCodigo(respuesta: unknown): FichaPorCodigo | null {
  const r = respuesta as { status?: number; product?: Record<string, unknown> } | null;
  if (!r || r.status !== 1 || !r.product) return null;
  const p = r.product;
  const base = limpiar(p.product_name_es) || limpiar(p.product_name);
  if (!base) return null;
  const marca = limpiar(p.brands).split(',').map((m) => m.trim()).filter(Boolean)[0] ?? null;
  const cantidad = limpiar(p.quantity) || null;

  let nombre = base;
  if (marca && !contiene(nombre, marca)) nombre += ` ${marca}`;
  if (cantidad && !contiene(nombre, cantidad)) nombre += ` ${cantidad}`;

  const imagen = limpiar(p.image_front_url) || limpiar(p.image_url) || null;
  return {
    nombre: nombre.slice(0, 120),
    marca,
    cantidad,
    descripcion: [base, marca, cantidad].filter(Boolean).join(' · '),
    imagen: imagen && /^https:\/\//.test(imagen) ? imagen : null,
  };
}

/** ¿Se puede copiar la foto de esa dirección? Solo https y de los hosts de la fuente. */
export function fotoCopiable(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS_FOTOS_CODIGO.includes(u.hostname);
  } catch {
    return false;
  }
}
