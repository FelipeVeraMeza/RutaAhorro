/**
 * Qué pasa con los códigos de barra de un producto cuando se edita.
 *
 * La regla vive acá y no en las pantallas porque tiene que ser **la misma** en
 * los tres lugares donde se aplica: `fn_update_product` en la base, el
 * repositorio de Supabase y el de IndexedDB. Cuando estaba escrita tres veces,
 * las tres decían cosas distintas y la de la carga masiva borraba códigos.
 *
 * La regla, en una línea: **no pedir nada no es pedir nada**. Una lista sin
 * definir deja los códigos como estaban; una lista vacía sí los borra, porque
 * eso es lo que pide quien vacía la lista en el formulario.
 */

/** Lo que hay que escribir en la base para dejar los códigos como se pidieron. */
export interface PlanCodigos {
  /** Si es falso, no se toca ninguna fila de códigos. */
  tocar: boolean;
  /** Códigos que hay que insertar. */
  agregar: string[];
  /** Códigos que hay que borrar. */
  quitar: string[];
  /** Cómo queda el producto. El primero es el principal. */
  finales: string[];
}

function limpiar(codigos: readonly string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const bruto of codigos) {
    const c = (bruto ?? '').trim();
    // Un código repetido dentro de la misma lista no es un error del usuario
    // que valga la pena mostrar: pegó dos veces el mismo. Se queda uno.
    if (c === '' || vistos.has(c)) continue;
    vistos.add(c);
    salida.push(c);
  }
  return salida;
}

/**
 * Compara lo que el producto tiene con lo que se pidió y devuelve la
 * diferencia. Se reconcilia en vez de borrar todo y reinsertar: los códigos
 * que no cambiaron nunca dejan de existir, ni siquiera un instante.
 *
 * @param previos  Los que el producto tiene hoy.
 * @param pedidos  Los que se piden. `undefined` o `null` = no tocar nada.
 */
export function planCodigos(
  previos: readonly string[],
  pedidos: readonly string[] | undefined | null,
): PlanCodigos {
  const actuales = limpiar(previos);
  if (pedidos === undefined || pedidos === null) {
    return { tocar: false, agregar: [], quitar: [], finales: actuales };
  }
  const finales = limpiar(pedidos);
  return {
    tocar: true,
    agregar: finales.filter((c) => !actuales.includes(c)),
    quitar: actuales.filter((c) => !finales.includes(c)),
    finales,
  };
}

/**
 * Qué códigos mandar al actualizar un producto desde una planilla.
 *
 * La planilla de carga masiva trae **una** columna de código de barra, y es
 * opcional. Antes se traducía a "déjalo con este código y ninguno más", así
 * que una planilla de actualización de precios —nombre, sku, precio, que es
 * justo la que manda un proveedor— borraba los códigos de todos los productos
 * que tocaba. El producto seguía en el catálogo con su nombre y su precio, y
 * dejaba de aparecer al escanear.
 *
 * Sin código en la fila no se toca nada. Con código, se **suma** a los que el
 * producto ya tenía: un artículo puede traer el código del envase individual y
 * el del pack, y la planilla solo sabe de uno.
 *
 * @returns La lista para `actualizar`, o `undefined` para no tocar los códigos.
 */
export function codigosDesdeImportacion(
  previos: readonly string[],
  codigoDeLaFila: string | null | undefined,
): string[] | undefined {
  const codigo = (codigoDeLaFila ?? '').trim();
  if (codigo === '') return undefined;
  const actuales = limpiar(previos);
  // Los previos primero: así el principal del producto sigue siendo el mismo
  // y una planilla no le cambia en silencio cuál código se imprime.
  return actuales.includes(codigo) ? actuales : [...actuales, codigo];
}
