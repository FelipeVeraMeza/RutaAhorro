/**
 * Validación del destino al que se redirige después de iniciar sesión.
 *
 * El login recibe a dónde ir en el parámetro `next` de la URL, y una URL la
 * escribe cualquiera. Sin filtro, un enlace con `?next=https://sitio-falso.cl`
 * lleva a la víctima fuera del sistema en el instante siguiente a autenticarse
 * de verdad: el momento en que menos sospecha, porque acaba de escribir su
 * contraseña en el sitio legítimo.
 *
 * Vive en `core` y no en la pantalla para poder probarlo. Un arreglo de
 * seguridad sin prueba es un arreglo que vuelve en el próximo refactor.
 */

/** A dónde va el usuario cuando no pidió nada en particular. */
export const DESTINO_POR_DEFECTO = '/pos';

const BARRA_INVERTIDA = String.fromCharCode(92);

/**
 * Devuelve una ruta interna segura, o el destino por defecto.
 *
 * Solo se aceptan rutas del propio sitio. Las tres formas de salir del sitio
 * con algo que empieza en "/", y que este filtro tiene que cerrar:
 *
 *   - `//sitio.cl` — el navegador la lee como URL sin protocolo: otro dominio.
 *   - una barra invertida en vez de la segunda barra — el navegador la
 *     normaliza a barra normal, así que termina siendo el caso anterior.
 *   - un tabulador o un salto de línea entre las dos barras — desaparecen al
 *     normalizar la URL y dejan el `//` a la vista del navegador.
 *
 * Por eso no basta con mirar el primer carácter.
 */
export function destinoSeguro(next: string | null | undefined): string {
  if (!next) return DESTINO_POR_DEFECTO;

  // Se descarta todo lo que el navegador va a descartar igual al normalizar:
  // caracteres de control, espacios y el DEL. Ahí es donde se esconde el `//`.
  const limpio = Array.from(next)
    .filter((c) => {
      const codigo = c.codePointAt(0) ?? 0;
      return codigo > 32 && codigo !== 127;
    })
    .join('');

  if (!limpio.startsWith('/')) return DESTINO_POR_DEFECTO;
  if (limpio[1] === '/' || limpio[1] === BARRA_INVERTIDA) return DESTINO_POR_DEFECTO;
  return limpio;
}
