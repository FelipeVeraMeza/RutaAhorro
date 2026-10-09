/**
 * Tienda online, etapa 1: el catálogo público (docs/30).
 *
 * Lo que ve un cliente que NO es del local: nombre, precio, foto, si hay o no
 * y las ofertas que rigen hoy. Nunca el costo, nunca la cantidad exacta en
 * stock (eso le sirve a la competencia, no al cliente).
 *
 * Todo lo de este archivo es puro: la página lo usa sobre el catálogo que ya
 * trajo, y las pruebas lo usan sin base.
 */
import { formatCLP } from './money.js';
import { precioDelTramo, precioPorCantidad, tramosVigentes, type TramoPrecio } from './precios.js';

export interface ProductoTienda {
  id: string;
  nombre: string;
  descripcion: string | null;
  /** La categoría que le puso el local. Solo esta se muestra como "la categoría" del producto. */
  categoria: string | null;
  /**
   * Por dónde se agrupa en la tienda: la categoría del local o, si no tiene,
   * el rubro que calza con su nombre (`rubroPorNombre`). El catálogo real no
   * tiene ninguna categoría (2026-10-09) y sin esto no había cómo recorrerlo.
   */
  grupo: string | null;
  /** La marca, si el nombre trae una conocida (`marcaPorNombre`). Para el filtro "Marca". */
  marca: string | null;
  /** El tamaño, si el nombre lo trae: "1 kg", "500 ml", "6 unidades" (`formatoPorNombre`). */
  formato: string | null;
  /**
   * Precio de lista, IVA incluido. Null = el producto no tiene precio todavía
   * (136 de 801 en el local real, 2026-10-09): se muestra igual, con
   * "Consultar precio", nunca como "$0".
   */
  precio: number | null;
  imagen: string | null;
  disponible: boolean;
  /** Las ofertas que rigen hoy, ya en palabras: "Desde 3: $1.400 c/u". */
  ofertas: string[];
  /**
   * Los tramos que rigen hoy, para que el carrito cobre lo mismo que la caja.
   * Son públicos de todas formas: la página ya los dice en `ofertas`.
   */
  tramos: TramoPrecio[];
}

export interface FiltroTienda {
  busqueda?: string | null;
  categoria?: string | null;
  /** Solo los que tienen alguna oferta hoy (la sección "Ofertas"). */
  soloOfertas?: boolean;
  orden?: OrdenTienda | null;
  /** Rango de precio, en pesos. Con un rango, los sin precio no salen. */
  precioMin?: number | null;
  precioMax?: number | null;
  /** Cualquiera de estas marcas. Vacío = todas. */
  marcas?: readonly string[] | null;
  pagina?: number | null;
}

export type OrdenTienda = 'relevantes' | 'nombre' | 'menor-precio' | 'mayor-precio';
export const ORDENES_TIENDA: Array<{ valor: OrdenTienda; texto: string }> = [
  { valor: 'relevantes', texto: 'Más relevantes' },
  { valor: 'nombre', texto: 'Nombre (A–Z)' },
  { valor: 'menor-precio', texto: 'Menor precio' },
  { valor: 'mayor-precio', texto: 'Mayor precio' },
];

export interface PaginaTienda {
  productos: ProductoTienda[];
  total: number;
  pagina: number;
  paginas: number;
}

/**
 * Comparador de textos en español, creado una vez. `localeCompare` arma uno
 * nuevo en cada llamada: ordenar 801 productos en cada visita lo hacía el
 * paso más caro bajo carga (prueba del 2026-10-09).
 */
const COMPARAR = new Intl.Collator('es').compare;

/** De a cuántos productos se muestra el catálogo. Múltiplo de 2, 3 y 4 columnas. */
export const POR_PAGINA_TIENDA = 48;

/**
 * Quita tildes y pasa a minúsculas, igual que el POS (`normalizeSearch`):
 * quien escribe "azucar" en el celular tiene que encontrar "Azúcar".
 */
export function normalizarBusqueda(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Filtra, ordena y corta una página del catálogo.
 *
 * Cada palabra buscada tiene que estar en el nombre, la descripción o la
 * categoría, en cualquier orden: "leche entera" encuentra "Leche · entera 1 L".
 * Lo que no hay va al final: el cliente vino a comprar, y una primera página
 * llena de "Agotado" parece una tienda vacía.
 */
export function filtrarCatalogo(catalogo: readonly ProductoTienda[], filtro: FiltroTienda): PaginaTienda {
  const palabras = normalizarBusqueda(filtro.busqueda ?? '').split(/\s+/).filter(Boolean);
  const categoria = filtro.categoria?.trim() || null;

  const encontrados = catalogo.filter((p) => {
    if (categoria && p.grupo !== categoria) return false;
    if (filtro.soloOfertas && !p.ofertas.length) return false;
    if (filtro.precioMin != null || filtro.precioMax != null) {
      if (p.precio == null) return false;
      if (filtro.precioMin != null && p.precio < filtro.precioMin) return false;
      if (filtro.precioMax != null && p.precio > filtro.precioMax) return false;
    }
    if (filtro.marcas?.length && (!p.marca || !filtro.marcas.includes(p.marca))) return false;
    if (!palabras.length) return true;
    const texto = normalizarBusqueda(`${p.nombre} ${p.descripcion ?? ''} ${p.grupo ?? ''}`);
    return palabras.every((w) => texto.includes(w));
  });

  // Por precio, los que no tienen van al final en los dos sentidos: "sin
  // precio" no es ni lo más barato ni lo más caro.
  const signo = filtro.orden === 'mayor-precio' ? -1 : 1;
  const porPrecio = filtro.orden === 'menor-precio' || filtro.orden === 'mayor-precio';
  // "Más relevantes" (el orden por omisión): lo que se puede comprar ya
  // primero, y entre eso, lo que está en oferta.
  const relevantes = !filtro.orden || filtro.orden === 'relevantes';
  encontrados.sort((a, b) =>
    Number(b.disponible) - Number(a.disponible)
    || (relevantes ? Number(b.precio != null) - Number(a.precio != null) || Number(b.ofertas.length > 0) - Number(a.ofertas.length > 0) : 0)
    || (porPrecio ? Number(a.precio == null) - Number(b.precio == null) || signo * ((a.precio ?? 0) - (b.precio ?? 0)) : 0)
    || COMPARAR(a.nombre, b.nombre));

  const total = encontrados.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA_TIENDA));
  const pedida = Math.trunc(Number(filtro.pagina) || 1);
  const pagina = Math.min(Math.max(1, pedida), paginas);
  const desde = (pagina - 1) * POR_PAGINA_TIENDA;
  return { productos: encontrados.slice(desde, desde + POR_PAGINA_TIENDA), total, pagina, paginas };
}

/** Los grupos (categorías o rubros) que tienen algo que mostrar, los con más productos primero. */
export function categoriasDelCatalogo(catalogo: readonly ProductoTienda[]): string[] {
  const cuantos = new Map<string, number>();
  for (const p of catalogo) if (p.grupo) cuantos.set(p.grupo, (cuantos.get(p.grupo) ?? 0) + 1);
  return [...cuantos].sort((a, b) => b[1] - a[1] || COMPARAR(a[0], b[0])).map(([g]) => g);
}

/**
 * Rubros para agrupar un producto sin categoría, por palabras de su nombre.
 * El orden importa: gana la primera regla que calza ("leche chocolate" es
 * lácteo, no snack). Se compara sin tildes ni signos y con espacios a los
 * lados, para poder pedir palabra completa (" ron " no calza en "camarón").
 */
export const RUBROS: ReadonlyArray<{ rubro: string; re: RegExp }> = [
  { rubro: 'Limpieza y aseo', re: /limpi|aseo|deterg|cloro|lavaloza|jabon|suaviz|desinfect|lustra|papel hig|toalla|shampoo|pasta dent/ },
  { rubro: 'Lácteos', re: /lacteo|leche|yog|queso|mantequ|crema|postre|manjar|soprole|colun|nestle/ },
  { rubro: 'Bebidas', re: /bebida|jugo| agua |gaseosa|nectar|cerveza|vino |licor|pisco| ron |coca|pepsi|sprite|fanta|energet|cachantun|bilz| pap / },
  { rubro: 'Snacks y dulces', re: /snack|galleta|alfajor|bon o bon|choco|flopi|dulce|confit|krisp|papas fritas|ramitas|chicle|caramelo|cereal|zucarita|brownie|moranguete|gomita/ },
  { rubro: 'Panadería', re: / pan |panader|hallulla|marraqueta|queque|tostad/ },
  { rubro: 'Carnes y congelados', re: /carne|pollo|vacuno|cerdo|hamburg|salchich|vienesa|jamon|camaron|marisco|pescado|congelad|nugget/ },
  { rubro: 'Frutas y verduras', re: /fruta|verdura|platano|manzana|tomate| papa |cebolla|palta|limon|frutilla/ },
  { rubro: 'Abarrotes', re: /abarrote|despensa|arroz|fideo|aceite|azucar|harina| sal | te |cafe|conserva|atun|salsa|mayo|ketchup|legumbre|poroto|lenteja|sopa|vinagre|mostaza/ },
];

/**
 * Marcas que se reconocen en el nombre. Los productos no tienen una columna
 * de marca, así que es por palabras, como los rubros: una marca que no está
 * en la lista simplemente no aparece en el filtro.
 */
export const MARCAS: ReadonlyArray<{ marca: string; re: RegExp }> = [
  { marca: 'Soprole', re: / soprole / },
  { marca: 'Nestlé', re: / nestle | nesquik | milo | sahne nuss | trencito | super 8 / },
  { marca: 'Colún', re: / colun / },
  { marca: 'Watts', re: / watt ?s / },
  { marca: 'Arcor', re: / arcor | bon o bon | rocklets | menthoplus / },
  { marca: 'Costa', re: / costa | chocman | frac | vizzio / },
  { marca: 'McKay', re: / mc ?kay | alteza | triton / },
  { marca: 'Carozzi', re: / carozzi | ambrosoli | costanera / },
  { marca: 'Lucchetti', re: / lucchetti / },
  { marca: 'Tucapel', re: / tucapel / },
  { marca: 'Kellogg’s', re: / kellogg| zucaritas | choco krispis | froot loops / },
  { marca: 'Coca-Cola', re: / coca cola | coca | fanta | sprite / },
  { marca: 'CCU', re: / cachantun | bilz | pap | kem | cristal | escudo | nectar andina / },
  { marca: 'Evercrisp', re: / evercrisp | ramitas | gajitos / },
  { marca: 'Marco Polo', re: / marco polo / },
  { marca: 'Hellmann’s', re: / hellmann/ },
  { marca: 'Heinz', re: / heinz / },
  { marca: 'Surlat', re: / surlat / },
  { marca: 'Savory', re: / savory / },
  { marca: 'Gatorade', re: / gatorade / },
  { marca: 'Monster', re: / monster / },
  { marca: 'Oreo', re: / oreo / },
  { marca: 'Mi Sol', re: / mi sol / },
];

export function marcaPorNombre(nombre: string): string | null {
  const t = ` ${normalizarBusqueda(nombre).replace(/[^a-z0-9]+/g, ' ')} `;
  return MARCAS.find((m) => m.re.test(t))?.marca ?? null;
}

/** Las marcas que aparecen en el catálogo, las con más productos primero. */
export function marcasDelCatalogo(catalogo: readonly ProductoTienda[]): Array<{ marca: string; cuantos: number }> {
  const cuantos = new Map<string, number>();
  for (const p of catalogo) if (p.marca) cuantos.set(p.marca, (cuantos.get(p.marca) ?? 0) + 1);
  return [...cuantos].map(([marca, n]) => ({ marca, cuantos: n }))
    .sort((a, b) => b.cuantos - a.cuantos || COMPARAR(a.marca, b.marca));
}

/**
 * El tamaño del producto, sacado de su nombre ("ACEITE 10 LTS" → "10 L",
 * "Galleta 95g" → "95 g", "VALENTE TORRE 28 UNIDADES" → "28 unidades").
 * Null si el nombre no lo dice. Para mostrarlo bajo el nombre, como la maqueta.
 */
const UNIDADES: Array<[RegExp, string]> = [
  [/^(kg|kgs|kilo|kilos|k)$/, 'kg'],
  [/^(g|gr|grs|gramos?)$/, 'g'],
  [/^(ml|cc)$/, 'ml'],
  [/^(l|lt|lts|litros?)$/, 'L'],
  [/^(un|und|unid|unidades?|u)$/, 'unidades'],
];

export function formatoPorNombre(nombre: string): string | null {
  const t = normalizarBusqueda(nombre);
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|k|grs?|gramos?|g|ml|cc|lts?|litros?|l|unidades|unidad|unid|und|un)(?![a-z])/);
  if (!m) return null;
  const unidad = UNIDADES.find(([re]) => re.test(m[2]))?.[1];
  if (!unidad) return null;
  const cantidad = m[1].replace('.', ',');
  if (unidad === 'unidades') return `${cantidad} ${cantidad === '1' ? 'unidad' : 'unidades'}`;
  return `${cantidad} ${unidad}`;
}

export function rubroPorNombre(nombre: string): string | null {
  const t = ` ${normalizarBusqueda(nombre).replace(/[^a-z0-9]+/g, ' ')} `;
  return RUBROS.find((r) => r.re.test(t))?.rubro ?? null;
}

/**
 * La descripción que puede ver un cliente. La planilla de carga dejó en
 * muchas "Código anterior: 3020002" (el código del sistema viejo): es un dato
 * interno, no le dice nada a quien compra.
 */
export function descripcionPublica(descripcion: string | null | undefined): string | null {
  const limpia = (descripcion ?? '')
    .replace(/c[oó]digo anterior\s*:?\s*\S*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·,;.-]+|[\s·,;-]+$/g, '')
    .trim();
  return limpia || null;
}

/**
 * Las ofertas que rigen ese día, para mostrarlas: "Desde 3: $1.400 c/u".
 *
 * Un tramo desde 1 con fechas es una promoción ("Oferta: $1.800"). Un tramo
 * que no deja más barato que el precio de lista no se muestra: en la caja
 * tampoco se aplica (`precioPorCantidad` cobra el menor). Con las ofertas del
 * local apagadas (`settings.ofertas_activas`), no hay ninguna.
 */
export function ofertasVisibles(
  precioLista: number,
  tramos: readonly TramoPrecio[] | null | undefined,
  dia: string,
  ofertasActivas = true,
): string[] {
  if (!ofertasActivas || !(precioLista > 0)) return [];
  const textos: string[] = [];
  for (const t of tramosVigentes(tramos, dia)) {
    const precio = precioDelTramo(t, precioLista);
    if (precio >= precioLista) continue;
    const texto = t.desde <= 1
      ? `Oferta: ${formatCLP(precio)}`
      : `Desde ${t.desde}: ${formatCLP(precio)} c/u`;
    if (!textos.includes(texto)) textos.push(texto);
  }
  return textos;
}

// ---------------------------------------------------------------------------
// Carrito (etapa 2, RT-20 y RT-21)
// ---------------------------------------------------------------------------

/** Lo que el carrito guarda de cada producto, en el navegador del cliente. */
export interface LineaCarritoTienda {
  id: string;
  nombre: string;
  precio: number;
  tramos: TramoPrecio[];
  cantidad: number;
}

export interface CarritoCalculado {
  lineas: Array<LineaCarritoTienda & { precioUnitario: number; subtotal: number; conOferta: boolean }>;
  unidades: number;
  total: number;
  /** Cuánto menos paga por las ofertas, contra el precio de lista. */
  ahorro: number;
}

/**
 * El total del carrito con las mismas ofertas por cantidad que la caja
 * (`precioPorCantidad`). Es una estimación para el cliente: cuando exista el
 * pedido (RT-23), el servidor vuelve a calcular con los precios del momento.
 */
export function calcularCarrito(lineas: readonly LineaCarritoTienda[], dia: string): CarritoCalculado {
  const calculadas = lineas
    .filter((l) => l.cantidad > 0 && l.precio > 0)
    .map((l) => {
      const { precio, tramo } = precioPorCantidad(l.precio, l.tramos, l.cantidad, dia);
      return { ...l, precioUnitario: precio, subtotal: precio * l.cantidad, conOferta: tramo != null };
    });
  return {
    lineas: calculadas,
    unidades: calculadas.reduce((s, l) => s + l.cantidad, 0),
    total: calculadas.reduce((s, l) => s + l.subtotal, 0),
    ahorro: calculadas.reduce((s, l) => s + (l.precio - l.precioUnitario) * l.cantidad, 0),
  };
}

/** Los datos que el cliente deja en "Mi cuenta" (en su navegador, sin cuenta). */
export interface DatosCliente {
  nombre: string;
  celular: string;
  correo: string;
}

/** El pedido como mensaje de WhatsApp, mientras no haya pago en línea. */
export function mensajePedido(carrito: CarritoCalculado, cliente?: DatosCliente | null): string {
  const filas = carrito.lineas.map((l) => `• ${l.cantidad} × ${l.nombre} = ${formatCLP(l.subtotal)}`);
  const quien = cliente?.nombre.trim()
    ? `Hola, soy ${cliente.nombre.trim()}${cliente.celular.trim() ? ` (${cliente.celular.trim()})` : ''}. Quiero hacer este pedido:`
    : 'Hola, quiero hacer este pedido:';
  return [quien, ...filas, `Total: ${formatCLP(carrito.total)}`].join('\n');
}

/**
 * Qué está mal en los datos del cliente, por campo. El nombre y el celular
 * son obligatorios: sin ellos el local no sabe a quién entregarle el pedido.
 */
export function validarDatosCliente(d: DatosCliente): Partial<Record<keyof DatosCliente, string>> {
  const errores: Partial<Record<keyof DatosCliente, string>> = {};
  if (d.nombre.trim().length < 2) errores.nombre = 'Escribe tu nombre';
  if (!enlaceWhatsApp(d.celular, '')) errores.celular = 'Escribe un celular chileno, ej. 9 1234 5678';
  if (d.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo.trim())) errores.correo = 'Revisa el correo';
  return errores;
}

/**
 * Los productos para mostrar en la portada: con precio y disponibles, en un
 * orden que cambia cada día (la portada no queda siempre con los "1+1…" que
 * van primero en orden alfabético) pero es el mismo para todos ese día.
 */
export function destacadosDelDia(catalogo: readonly ProductoTienda[], dia: string, cuantos: number): ProductoTienda[] {
  const hash = (s: string) => {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return h;
  };
  return catalogo
    .filter((p) => p.precio != null && p.disponible)
    .map((p) => ({ p, k: hash(`${dia}:${p.id}`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, cuantos)
    .map((x) => x.p);
}

/** La mayor rebaja que dan las ofertas de hoy, en %, para la etiqueta "-17%". */
export function rebajaMaximaPct(precio: number | null, tramos: readonly TramoPrecio[]): number {
  if (precio == null || precio <= 0) return 0;
  let menor = precio;
  for (const t of tramos) menor = Math.min(menor, precioDelTramo(t, precio));
  return Math.round(((precio - menor) / precio) * 100);
}

/**
 * Lo que falta para la próxima oferta de esa línea: "Lleva 1 más y paga
 * $1.400 c/u". Null si no hay un tramo más barato por delante.
 */
export function proximaOferta(
  linea: Pick<LineaCarritoTienda, 'precio' | 'tramos' | 'cantidad'>, dia: string,
): { faltan: number; precio: number } | null {
  const ahora = precioPorCantidad(linea.precio, linea.tramos, linea.cantidad, dia).precio;
  const siguientes = linea.tramos
    .filter((t) => t.desde > linea.cantidad)
    .map((t) => ({ desde: t.desde, precio: precioPorCantidad(linea.precio, linea.tramos, t.desde, dia).precio }))
    .filter((x) => x.precio < ahora)
    .sort((a, b) => a.desde - b.desde);
  return siguientes[0] ? { faltan: siguientes[0].desde - linea.cantidad, precio: siguientes[0].precio } : null;
}

/** Productos del mismo grupo para "También te puede interesar" en la ficha. */
export function relacionados(catalogo: readonly ProductoTienda[], producto: ProductoTienda, cuantos: number): ProductoTienda[] {
  if (!producto.grupo) return [];
  return catalogo
    .filter((p) => p.id !== producto.id && p.grupo === producto.grupo && p.precio != null && p.disponible)
    .slice(0, cuantos);
}

/** El precio para mostrar: "$1.290", o "Consultar precio" si no tiene. */
export function precioTienda(precio: number | null): string {
  return precio != null && precio > 0 ? formatCLP(precio) : 'Consultar precio';
}

/**
 * Enlace de WhatsApp al teléfono del local, con el mensaje ya escrito.
 *
 * En la etapa 1 todavía no hay carrito ni pago: así es como el cliente
 * pregunta o encarga. El teléfono viene como lo anotó el dueño ("+56 9 1234
 * 5678", "912345678", "(2) 2345 6789"); sin un número chileno reconocible no
 * hay enlace, y la página no muestra el botón.
 */
export function enlaceWhatsApp(telefono: string | null | undefined, mensaje: string): string | null {
  let d = (telefono ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = `56${d}`;
  if (!/^56\d{9}$/.test(d)) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(mensaje)}`;
}

// ---------------------------------------------------------------------------
// Límite de solicitudes (RNF-T18)
// ---------------------------------------------------------------------------

/**
 * Ventana deslizante en memoria: cuántas solicitudes por clave (IP o usuario)
 * en los últimos `ventanaMs`. Vive en el proceso del servidor: con un solo
 * servicio en Railway alcanza; con varios, cada uno cuenta lo suyo.
 */
export function crearLimitador(maximo: number, ventanaMs: number, ahora: () => number = Date.now) {
  const golpes = new Map<string, number[]>();
  return {
    /** true = se deja pasar (y se cuenta); false = pasó el límite. */
    permitir(clave: string): boolean {
      const t = ahora();
      const recientes = (golpes.get(clave) ?? []).filter((x) => t - x < ventanaMs);
      if (recientes.length >= maximo) { golpes.set(clave, recientes); return false; }
      recientes.push(t);
      golpes.set(clave, recientes);
      // Que el mapa no crezca sin fin con IPs que no vuelven.
      if (golpes.size > 10_000) {
        for (const [k, v] of golpes) if (!v.some((x) => t - x < ventanaMs)) golpes.delete(k);
      }
      return true;
    },
  };
}
