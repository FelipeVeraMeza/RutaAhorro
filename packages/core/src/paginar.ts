/**
 * Todas las filas de una consulta paginada, de a `tamano`.
 *
 * La API de Supabase entrega como máximo 1.000 filas por consulta y corta SIN
 * AVISAR: con un catálogo o un mes más grande que eso, la pantalla mostraba
 * números cortos como si fueran completos (docs/28, 120 a 126). `pedir` recibe
 * el rango (ambos extremos incluidos) y tiene que venir ordenada por algo que
 * no se repita, o una página se salta filas.
 */
export async function todasLasPaginas<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  { tamano = 1000, maximo = 50_000 }: { tamano?: number; maximo?: number } = {},
): Promise<T[]> {
  const salida: T[] = [];
  for (let desde = 0; desde < maximo; desde += tamano) {
    const { data, error } = await pedir(desde, desde + tamano - 1);
    if (error) throw error;
    salida.push(...(data ?? []));
    if ((data ?? []).length < tamano) break;
  }
  return salida;
}
