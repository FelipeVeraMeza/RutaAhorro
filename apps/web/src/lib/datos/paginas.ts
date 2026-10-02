/**
 * Todas las filas de una consulta, de a 1.000: es lo que entrega la API de
 * Supabase como máximo, y sin avisar que cortó. La consulta tiene que traer un
 * orden estable (con una columna única al final), o las páginas se solapan.
 */
export async function todasLasFilas<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tope = 100_000,
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; desde < tope; desde += 1000) {
    const { data, error } = await pedir(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return filas;
}
