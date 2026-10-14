/**
 * Todas las filas de una consulta, de a 1.000.
 *
 * La API de Supabase entrega como máximo 1.000 filas por consulta y no avisa
 * cuando corta: con 1.200 códigos de barra el celular guardaba 1.000 y el
 * resto "no estaba en el catálogo" al escanearlo. Cada consulta que puede
 * pasar de 1.000 filas tiene que pedirse por páginas, y con un orden fijo
 * (sin `order`, dos páginas pueden repetir o saltarse filas).
 *
 *   const filas = await todasLasFilas((a, b) =>
 *     supabase().from('product_barcodes').select('barcode, product_id').order('barcode').range(a, b));
 */
export async function todasLasFilas<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  { pagina = 1000, maximo = 100_000 }: { pagina?: number; maximo?: number } = {},
): Promise<T[]> {
  const salida: T[] = [];
  for (let desde = 0; desde < maximo; desde += pagina) {
    const { data, error } = await pedir(desde, desde + pagina - 1);
    if (error) throw error;
    salida.push(...(data ?? []));
    if ((data ?? []).length < pagina) break;
  }
  return salida;
}
