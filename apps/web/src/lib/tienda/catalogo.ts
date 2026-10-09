import { unstable_cache } from 'next/cache';
import { descripcionPublica, diaLocal, formatoPorNombre, marcaPorNombre, ofertasVisibles, rubroPorNombre, tramosVigentes, type ProductoTienda, type TramoPrecio } from '@rutaahorro/core';
import { clienteAdmin } from '@/lib/supabase/admin';
import { DEMO_ACTIVO } from '@/lib/demo';
import { DEMO_PRODUCTOS } from '@/lib/demo/data';

/**
 * El catálogo de la tienda online (docs/30, etapa 1), leído en el servidor.
 *
 * Por qué con la llave de servicio y no con la pública: quien abre la tienda
 * no tiene sesión, y abrirle a `anon` una tabla o una función le abriría la
 * base a cualquiera con la consola del navegador (seguridad.test.mjs exige
 * que `anon` no ejecute nada). Acá el servidor elige las columnas y el local;
 * al navegador solo llega lo que dice `ProductoTienda`. Nunca el costo.
 *
 * El local sale de `TIENDA_TENANT_ID`. Sin esa variable no hay tienda: es el
 * interruptor, y es lo que impide mostrar el catálogo de otro local.
 */

export interface DatosTienda {
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  catalogo: ProductoTienda[];
  /** Alguna foto vino de Open Food Facts (`-off-` en el archivo): hay que citar la fuente (CC BY-SA). */
  fotosDeOpenFoodFacts: boolean;
}

/** Cada cuánto se vuelve a leer la base. Un precio nuevo tarda a lo más esto en verse. */
const REFRESCO_S = 60;

interface FilaProducto {
  id: string;
  name: string;
  description: string | null;
  sale_price: number;
  image_url: string | null;
  categories: { name: string } | null;
  stock_levels: Array<{ quantity: number }> | null;
  product_price_tiers: Array<{
    desde: number; precio: number | null; descuento_pct: number | null;
    vigente_desde: string | null; vigente_hasta: string | null;
  }> | null;
}

async function leerTienda(tenantId: string): Promise<DatosTienda | null> {
  const db = clienteAdmin();
  if (!db) throw new Error('Falta SUPABASE_SECRET_KEY en el servidor');

  const { data: local, error: e1 } = await db.from('tenants')
    .select('name, status, settings').eq('id', tenantId).maybeSingle();
  if (e1) throw e1;
  if (!local || local.status !== 'activo') return null;

  const { data: sucursal } = await db.from('stores')
    .select('name, address, phone').eq('tenant_id', tenantId).eq('is_active', true)
    .order('created_at').limit(1).maybeSingle();

  const ajustes = (local.settings ?? {}) as Record<string, unknown>;
  const dia = diaLocal(new Date(), String(ajustes.timezone ?? 'America/Santiago'));
  // Mismo interruptor que la caja (0021): apagado, ninguna oferta rige.
  const ofertasActivas = ajustes.ofertas_activas !== false;
  // Un local que vende sin stock (la caja lo deja) no lo lleva al día: con
  // cero en todo, la tienda entera decía "Agotado" (2026-10-09, el local real
  // con 665 productos y ninguno con stock). Ahí no se marca nada agotado.
  const venderSinStock = ajustes.vender_sin_stock === true;

  // Supabase entrega hasta 1.000 filas por consulta: se pide por páginas.
  const filas: FilaProducto[] = [];
  const PAGINA = 1000;
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await db.from('products')
      .select('id, name, description, sale_price, image_url, categories(name), stock_levels(quantity), ' +
        'product_price_tiers(desde, precio, descuento_pct, vigente_desde, vigente_hasta)')
      // Todos los activos, también los sin precio (Felipe, 2026-10-09): salen
      // con "Consultar precio".
      .eq('tenant_id', tenantId).eq('is_active', true)
      .order('name').order('id').range(desde, desde + PAGINA - 1);
    if (error) throw error;
    filas.push(...((data ?? []) as unknown as FilaProducto[]));
    if (!data || data.length < PAGINA) break;
  }

  return {
    // El nombre del negocio, no el de la sucursal ("Local principal" no le
    // dice nada a un cliente).
    nombre: local.name || sucursal?.name || 'Tienda',
    direccion: sucursal?.address ?? null,
    telefono: sucursal?.phone ?? null,
    fotosDeOpenFoodFacts: filas.some((f) => f.image_url?.includes('-off-')),
    catalogo: filas.map((f) => {
      const tramos: TramoPrecio[] = (f.product_price_tiers ?? []).map((t) => ({
        desde: Number(t.desde), precio: t.precio, descuentoPct: t.descuento_pct == null ? null : Number(t.descuento_pct),
        vigenteDesde: t.vigente_desde, vigenteHasta: t.vigente_hasta,
      }));
      const stock = (f.stock_levels ?? []).reduce((s, x) => s + Number(x.quantity), 0);
      return {
        id: f.id,
        nombre: f.name,
        descripcion: descripcionPublica(f.description),
        categoria: f.categories?.name ?? null,
        grupo: f.categories?.name ?? rubroPorNombre(f.name),
        marca: marcaPorNombre(f.name),
        formato: formatoPorNombre(f.name),
        precio: f.sale_price > 0 ? f.sale_price : null,
        imagen: f.image_url,
        disponible: venderSinStock || stock > 0,
        ofertas: ofertasVisibles(f.sale_price, tramos, dia, ofertasActivas),
        tramos: ofertasActivas && f.sale_price > 0 ? tramosVigentes(tramos, dia) : [],
      };
    }),
  };
}

const leerTiendaGuardada = unstable_cache(leerTienda, ['tienda-catalogo'], { revalidate: REFRESCO_S });

const DEMO_OFERTAS: Record<string, TramoPrecio[]> = {
  p01: [{ desde: 3, precio: 1390 }],
  p05: [{ desde: 6, descuentoPct: 10 }],
};

/** La maqueta: los productos de ejemplo, para recorrer la tienda sin Supabase. */
function tiendaDemo(): DatosTienda {
  return {
    nombre: 'Almacén de ejemplo',
    direccion: 'Av. Siempre Viva 742, Santiago',
    telefono: '+56 9 1234 5678',
    fotosDeOpenFoodFacts: false,
    catalogo: DEMO_PRODUCTOS.map((p) => ({
      id: p.id,
      nombre: p.name,
      descripcion: descripcionPublica(p.description),
      categoria: p.categoria,
      grupo: p.categoria,
      marca: marcaPorNombre(p.name),
      formato: formatoPorNombre(p.name),
      precio: p.sale_price,
      imagen: null,
      disponible: p.stock > 0,
      // Dos ofertas de ejemplo, para ver la sección "Ofertas" y el carrito.
      ...DEMO_OFERTAS[p.id]
        ? { ofertas: ofertasVisibles(p.sale_price, DEMO_OFERTAS[p.id], '2026-01-01'), tramos: DEMO_OFERTAS[p.id] }
        : { ofertas: [], tramos: [] },
    })),
  };
}

/**
 * Copia en memoria del proceso por 60 s, encima de `unstable_cache`: esa
 * caché devuelve el catálogo deserializado de nuevo en cada visita (801
 * productos). Con 100 visitas simultáneas era la mitad del tiempo de cada
 * página (prueba de carga del 2026-10-09).
 */
let enMemoria: { tenantId: string; hasta: number; datos: Promise<DatosTienda | null> } | null = null;

/** Null = no hay tienda: falta `TIENDA_TENANT_ID` o el local no está activo. */
export async function datosTienda(): Promise<DatosTienda | null> {
  if (DEMO_ACTIVO) return tiendaDemo();
  const tenantId = process.env.TIENDA_TENANT_ID?.trim();
  if (!tenantId) return null;
  if (enMemoria && enMemoria.tenantId === tenantId && enMemoria.hasta > Date.now()) return enMemoria.datos;
  const datos = leerTiendaGuardada(tenantId);
  enMemoria = { tenantId, hasta: Date.now() + REFRESCO_S * 1000, datos };
  // Un error no queda guardado: la próxima visita vuelve a intentar.
  datos.catch(() => { if (enMemoria?.datos === datos) enMemoria = null; });
  return datos;
}
