/**
 * Cifrado de las credenciales del SII (0026): AES-256-GCM.
 *
 * La clave tributaria del cliente y la del certificado se guardan en la base
 * cifradas, y la llave vive solo en el servidor (variable SII_CLAVE_CIFRADO,
 * 32 bytes en base64), nunca en la base ni en el navegador. Las escribe el
 * servidor web y las lee el worker: por eso está en core, una sola vez, y no
 * copiado en los dos lados con el riesgo de que diverjan.
 *
 * GCM y no CBC (el modelo de VSV usa CBC): GCM autentica, así que un texto
 * cifrado alterado o una llave equivocada fallan en vez de devolver basura.
 *
 * Usa WebCrypto, que existe igual en Node 22 y en el navegador; core no
 * depende de `node:crypto`. Formato: `v1:<iv base64>:<cifrado+etiqueta base64>`.
 */

// Tipos mínimos de WebCrypto: core compila sin la biblioteca DOM.
interface SubtleMinimo {
  importKey(formato: 'raw', llave: Uint8Array, algoritmo: { name: 'AES-GCM' }, extraible: false,
            usos: Array<'encrypt' | 'decrypt'>): Promise<unknown>;
  encrypt(algoritmo: { name: 'AES-GCM'; iv: Uint8Array }, llave: unknown, datos: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algoritmo: { name: 'AES-GCM'; iv: Uint8Array }, llave: unknown, datos: Uint8Array): Promise<ArrayBuffer>;
}
interface CriptoMinimo {
  subtle: SubtleMinimo;
  getRandomValues(arreglo: Uint8Array): Uint8Array;
}

function cripto(): CriptoMinimo {
  const c = (globalThis as unknown as { crypto?: CriptoMinimo }).crypto;
  if (!c?.subtle) throw new Error('CIFRADO_NO_DISPONIBLE');
  return c;
}

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function aBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += ALFABETO[(n >> 18) & 63] + ALFABETO[(n >> 12) & 63]
      + (i + 1 < bytes.length ? ALFABETO[(n >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? ALFABETO[n & 63] : '=');
  }
  return s;
}

export function desdeBase64(texto: string): Uint8Array {
  const limpio = texto.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < limpio.length; i += 4) {
    const n = (ALFABETO.indexOf(limpio[i]) << 18) | (ALFABETO.indexOf(limpio[i + 1]) << 12)
      | ((i + 2 < limpio.length ? ALFABETO.indexOf(limpio[i + 2]) : 0) << 6)
      | (i + 3 < limpio.length ? ALFABETO.indexOf(limpio[i + 3]) : 0);
    bytes.push((n >> 16) & 255);
    if (i + 2 < limpio.length) bytes.push((n >> 8) & 255);
    if (i + 3 < limpio.length) bytes.push(n & 255);
  }
  return new Uint8Array(bytes);
}

function utf8(texto: string): Uint8Array {
  const out: number[] = [];
  for (const ch of texto) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return new Uint8Array(out);
}

function desdeUtf8(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let c: number;
    if (b < 0x80) { c = b; i += 1; }
    else if (b < 0xe0) { c = ((b & 31) << 6) | (bytes[i + 1] & 63); i += 2; }
    else if (b < 0xf0) { c = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3; }
    else { c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); i += 4; }
    s += String.fromCodePoint(c);
  }
  return s;
}

async function importar(llaveBase64: string): Promise<unknown> {
  const llave = desdeBase64(llaveBase64 ?? '');
  if (llave.length !== 32) throw new Error('LLAVE_CIFRADO_INVALIDA');
  return cripto().subtle.importKey('raw', llave, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Una llave nueva de 32 bytes, en base64: el valor para SII_CLAVE_CIFRADO. */
export function generarLlaveCifrado(): string {
  return aBase64(cripto().getRandomValues(new Uint8Array(32)));
}

export async function cifrar(texto: string, llaveBase64: string): Promise<string> {
  const llave = await importar(llaveBase64);
  const iv = cripto().getRandomValues(new Uint8Array(12));
  const datos = new Uint8Array(await cripto().subtle.encrypt({ name: 'AES-GCM', iv }, llave, utf8(texto)));
  return `v1:${aBase64(iv)}:${aBase64(datos)}`;
}

/** Lanza CIFRADO_INVALIDO si el texto fue alterado o la llave no es la que cifró. */
export async function descifrar(cifrado: string, llaveBase64: string): Promise<string> {
  const [version, iv, datos] = String(cifrado ?? '').split(':');
  if (version !== 'v1' || !iv || !datos) throw new Error('CIFRADO_INVALIDO');
  const llave = await importar(llaveBase64);
  try {
    const plano = await cripto().subtle.decrypt({ name: 'AES-GCM', iv: desdeBase64(iv) }, llave, desdeBase64(datos));
    return desdeUtf8(new Uint8Array(plano));
  } catch {
    throw new Error('CIFRADO_INVALIDO');
  }
}
