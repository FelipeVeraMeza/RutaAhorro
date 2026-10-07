/**
 * Largo mínimo de una contraseña, el mismo en todas las pantallas y rutas.
 *
 * 6 y no 8 (Felipe, 2026-10-07: "no es necesario" que sean 8). No baja de 6
 * porque es el mínimo que Supabase acepta por omisión: una clave más corta la
 * rechaza el servidor de cuentas aunque la pantalla la deje pasar. Y como se
 * entra con el RUT, que no es secreto, la clave es lo único que protege la
 * cuenta.
 */
export const MINIMO_CLAVE = 6;
