'use client';

import { normalizeBarcode, type TramoPrecio } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { db, normalizeSearch, getMeta, setMeta, asegurarDueno, type LocalProduct } from './db';
import { desdeSettings } from '../datos/configuracionBase';
import { syncClientes } from '../datos/clientes';
import { syncCombos } from '../datos/combos';

/**
 * Replicación del catálogo al dispositivo.
 *
 * Se sincroniza de forma incremental por `updated_at`: la primera vez baja
 * todo, después solo lo que cambió. Con 3.000 SKU la carga inicial pesa pocos
 * cientos de KB; las siguientes, casi nada.
 */

const LAST_SYNC_KEY = 'catalog:lastSync';
/** Hasta qué `updated_at` de la base está bajado el catálogo (para la bajada incremental). */
const MARCA_KEY = 'catalog:marca';

/** Se emite en `window` cada vez que el catálogo local cambia. */
export const EVENTO_CATALOGO = 'catalogo-actualizado';
const PAGE = 1000;

/**
 * Todas las filas de una consulta, por páginas de 1.000 (lo que entrega la
 * API como máximo). Stock, códigos, ofertas y lotes se leían de una sola vez:
 * con más de 1.000 filas, los códigos de barra que quedaban afuera dejaban de
 * escanearse en el POS, el stock de esos productos llegaba en 0 (y Vender no
 * dejaba cobrarlos) y sus ofertas no se aplicaban.
 */
async function todas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; desde < 200_000; desde += PAGE) {
    const { data, error } = await pedir(desde, desde + PAGE - 1);
    if (error) throw error;
    filas.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return filas;
}

export async function syncCatalog(force = false): Promise<{ products: number; barcodes: number }> {
  const client = supabase();

  // El catálogo local tiene que ser de este local y de nadie más. Si el
  // navegador tenía el de la maqueta o el de otro local, se borra y se baja
  // completo.
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { products: 0, barcodes: 0 };
  const { data: perfil, error: ePerfil } = await client
    .from('profiles').select('tenant_id').eq('id', user.id).single();
  if (ePerfil || !perfil) throw ePerfil ?? new Error('SIN_PERFIL');
  const cambioDeDueno = await asegurarDueno(`tenant:${perfil.tenant_id as string}`);

  const marca = force || cambioDeDueno ? null : (await getMeta(MARCA_KEY)) ?? (await getMeta(LAST_SYNC_KEY));
  // Con 5 minutos de margen hacia atrás. `updated_at` es la hora en que
  // EMPEZÓ la transacción que editó el producto: una edición que tardó en
  // confirmarse (o dos con la misma hora) podía quedar con un updated_at
  // anterior a la marca del último producto bajado, y con `gt` ese cambio no
  // llegaba nunca al celular. Bajar de nuevo unos pocos es barato.
  const since = marca && Number.isFinite(Date.parse(marca))
    ? new Date(Date.parse(marca) - 5 * 60_000).toISOString()
    : marca;
  const startedAt = new Date().toISOString();

  // --- Productos ---
  const products: LocalProduct[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = client
      .from('products')
      .select('id, name, description, sku, sale_price, unit, category_id, tracks_expiry, min_stock, is_active, updated_at, impuesto_adicional_id')
      // Con el id de desempate: una carga masiva deja miles de productos con
      // el MISMO updated_at, y ordenando solo por él las páginas se solapaban
      // y algunos productos no bajaban nunca al celular.
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) query = query.gt('updated_at', since);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;

    products.push(
      ...data.map((p) => ({
        id: p.id as string,
        name: p.name as string,
        nameSearch: normalizeSearch(p.name as string),
        description: (p.description as string) ?? null,
        sku: (p.sku as string) ?? null,
        salePrice: Number(p.sale_price ?? 0),
        unit: (p.unit as string) ?? 'unidad',
        categoryId: (p.category_id as string) ?? null,
        tracksExpiry: Boolean(p.tracks_expiry),
        stock: 0, // se completa abajo
        minStock: Number(p.min_stock ?? 0),
        isActive: Boolean(p.is_active),
        updatedAt: p.updated_at as string,
        impuestoId: (p.impuesto_adicional_id as string) ?? null,
      })),
    );
    if (data.length < PAGE) break;
  }

  // Los ids que existen hoy, solo en una bajada incremental (la completa ya
  // los trae). Un producto ELIMINADO no cambia su updated_at, desaparece: en
  // el celular quedaba hasta la siguiente bajada completa (que casi nunca
  // pasa) y el cajero lo encontraba por nombre y lo cobraba; la base después
  // rechazaba la venta con PRODUCTO_NO_ENCONTRADO.
  const existentes = since
    ? new Set((await todas((a, b) => client.from('products').select('id').order('id').range(a, b)))
        .map((p) => p.id as string))
    : null;

  // --- Stock actual ---
  // Siempre completo: el stock cambia con cada venta de cualquier caja, así que
  // un sincronizado incremental por updated_at del producto se lo perdería.
  const levels = await todas((a, b) => client.from('stock_levels').select('product_id, quantity')
    .order('product_id').order('store_id').range(a, b));
  const stockByProduct = new Map<string, number>(
    levels.map((l) => [l.product_id as string, Number(l.quantity ?? 0)]),
  );
  // Sala y bodega por separado: el POS avisa cuando la sala no alcanza.
  const ubic = await todas((a, b) => client.from('stock_ubicaciones').select('product_id, ubicacion, quantity')
    .order('product_id').order('ubicacion').order('store_id').range(a, b));
  const porUbicacion = new Map<string, { sala: number; bodega: number }>();
  for (const u of ubic) {
    const r = porUbicacion.get(u.product_id as string) ?? { sala: 0, bodega: 0 };
    r[u.ubicacion as 'sala' | 'bodega'] = Number(u.quantity ?? 0);
    porUbicacion.set(u.product_id as string, r);
  }
  // Lotes con stock, para avisar en Vender lo vencido. Completo cada vez,
  // como el stock: un lote cambia sin tocar el producto.
  const lotes = await todas((a, b) => client.from('product_lots')
    .select('product_id, expiry_date').eq('is_active', true).gt('quantity', 0).order('id').range(a, b));
  const vence = new Map<string, string>();
  for (const l of lotes) {
    const id = l.product_id as string;
    const d = l.expiry_date as string;
    if (d && (!vence.has(id) || d < vence.get(id)!)) vence.set(id, d);
  }
  const conUbicacion = <T extends LocalProduct>(p: T): T => ({
    ...p,
    stockSala: porUbicacion.get(p.id)?.sala ?? 0,
    stockBodega: porUbicacion.get(p.id)?.bodega ?? 0,
    venceProximo: vence.get(p.id) ?? null,
  });

  // --- Ofertas e impuestos adicionales (0018) ---
  // Completos cada vez, como el stock: cambiar la tasa de un impuesto cambia
  // lo que se cobra en muchos productos sin tocar su `updated_at`.
  const [tiers, { data: taxes, error: eTaxes }, { data: local }] = await Promise.all([
    todas((a, b) => client.from('product_price_tiers')
      .select('product_id, desde, precio, descuento_pct, vigente_desde, vigente_hasta').order('id').range(a, b)),
    client.from('impuestos_adicionales').select('id, nombre, tasa, is_active'),
    client.from('tenants').select('settings').maybeSingle(),
  ]);
  if (eTaxes) throw eTaxes;
  // 0021 · Con las ofertas apagadas el celular no las recibe. Así el POS sin
  // conexión tampoco las cobra: si las cobrara, la base rechazaría la venta al
  // sincronizar (sería un descuento sin permiso) y quedaría trabada.
  const ofertasActivas = desdeSettings(local?.settings).ofertasActivas;
  const tramosPorProducto = new Map<string, TramoPrecio[]>();
  for (const t of ofertasActivas ? tiers : []) {
    const lista = tramosPorProducto.get(t.product_id as string) ?? [];
    lista.push({
      desde: Number(t.desde),
      precio: t.precio == null ? null : Number(t.precio),
      descuentoPct: t.descuento_pct == null ? null : Number(t.descuento_pct),
      vigenteDesde: (t.vigente_desde as string) ?? null,
      vigenteHasta: (t.vigente_hasta as string) ?? null,
    });
    tramosPorProducto.set(t.product_id as string, lista);
  }
  const impuestos = new Map(
    (taxes ?? []).filter((t) => t.is_active).map((t) => [t.id as string, { nombre: t.nombre as string, tasa: Number(t.tasa) }]),
  );
  const conPrecios = <T extends LocalProduct>(p: T): T => {
    const imp = p.impuestoId ? impuestos.get(p.impuestoId) : undefined;
    return {
      ...p,
      tramos: tramosPorProducto.get(p.id) ?? [],
      tasaAdicional: imp?.tasa ?? 0,
      impuestoNombre: imp?.nombre ?? null,
    };
  };

  // --- Códigos de barras ---
  // Si falla, se lanza: antes un error dejaba `codes` en null y se seguía,
  // y con una página a medias se habría vaciado la tabla de códigos.
  const codes = await todas((a, b) => client.from('product_barcodes').select('barcode, product_id')
    .order('barcode').range(a, b));

  const database = db();
  await database.transaction('rw', database.products, database.barcodes, async () => {
    if (products.length > 0) {
      for (const p of products) p.stock = stockByProduct.get(p.id) ?? 0;
      await database.products.bulkPut(products.map((p) => conPrecios(conUbicacion(p))));
    }
    // Una bajada completa es la verdad entera: lo que está en el celular y no
    // en la base (un producto eliminado, un resto de otra sesión) sale.
    if (!since) {
      const vigentes = new Set(products.map((p) => p.id));
      await database.products.filter((p) => !vigentes.has(p.id)).delete();
    } else if (existentes) {
      await database.products.filter((p) => !existentes.has(p.id)).delete();
    }
    // Stock, ofertas e impuestos de TODOS los productos del celular, no solo
    // de los que cambiaron. Antes esto corría solo si no había cambiado
    // ningún producto: bastaba con que se editara uno para que el stock de
    // los demás quedara viejo hasta la siguiente sincronización.
    const existing = await database.products.toArray();
    const updates = existing.map((p) =>
      conPrecios(conUbicacion({ ...p, stock: stockByProduct.get(p.id) ?? p.stock })));
    if (updates.length > 0) await database.products.bulkPut(updates);
    // Se reemplazan aunque la base no tenga ninguno. Antes solo se limpiaban si
    // llegaba al menos uno: con un catálogo sin códigos, los viejos seguían
    // escaneándose.
    {
      await database.barcodes.clear();
      await database.barcodes.bulkPut(
        codes.map((c) => ({
          barcode: normalizeBarcode(c.barcode as string),
          productId: c.product_id as string,
        })),
      );
    }
  });

  // 0022 · Los clientes y sus precios, para elegirlos en el POS sin conexión.
  // Si falla, el POS vende igual con la lista anterior.
  await syncClientes().catch(() => {});
  // 0023 · Los combos, que como las ofertas no bajan si el local las apagó.
  await syncCombos(ofertasActivas).catch(() => {});

  // La marca para la próxima vez es la del último producto que llegó, con
  // la hora de la BASE: con la del celular, un reloj adelantado se saltaba
  // los cambios hechos en esos minutos para siempre (hasta una bajada completa).
  const ultimo = products.reduce<string | null>((m, p) => (m === null || p.updatedAt > m ? p.updatedAt : m), null);
  if (ultimo) await setMeta(MARCA_KEY, ultimo);
  // Cuándo se sincronizó (lo que muestra Vender, RF-M5-29): eso sí es ahora.
  await setMeta(LAST_SYNC_KEY, startedAt);
  // Aviso para las pantallas abiertas: el POS repite la búsqueda en curso.
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_CATALOGO));
  return { products: products.length, barcodes: codes.length };
}

/** Busca por código de barras. Es el camino más caliente del POS. */
export async function findByBarcode(code: string): Promise<LocalProduct | null> {
  const normalized = normalizeBarcode(code);
  const database = db();

  let hit = await database.barcodes.get(normalized);
  // Si el código venía con un cero al frente (EAN-13 de un UPC-A), probar sin él
  if (!hit && normalized.startsWith('0')) {
    hit = await database.barcodes.get(normalized.slice(1));
  }
  if (!hit) return null;

  const product = await database.products.get(hit.productId);
  return product?.isActive ? product : null;
}

/** Búsqueda por nombre o SKU, local y por lo tanto instantánea (RNF-02). */
export async function searchProducts(term: string, limit = 25): Promise<LocalProduct[]> {
  const q = normalizeSearch(term);
  if (q.length === 0) return [];

  const database = db();

  // Un término puramente numérico probablemente sea un código tecleado a mano
  if (/^\d{6,}$/.test(q)) {
    const byCode = await findByBarcode(q);
    if (byCode) return [byCode];
  }

  // Se leen todos y se filtra acá. Antes era `where('isActive').equals(1)`,
  // pero `isActive` se guarda como `true` e IndexedDB no indexa booleanos: la
  // consulta no fallaba, devolvía vacío, y la búsqueda por nombre del POS no
  // encontraba nada nunca. Solo funcionaba escanear.
  const active = (await database.products.toArray()).filter((p) => p.isActive);
  const starts = active.filter((p) => p.nameSearch.startsWith(q));
  const contains = active.filter((p) => !p.nameSearch.startsWith(q) && p.nameSearch.includes(q));
  const bySku = active.filter(
    (p) => p.sku && normalizeSearch(p.sku).includes(q) && !starts.includes(p) && !contains.includes(p),
  );

  // Los que empiezan por el término primero: es lo que la persona espera ver.
  return [...starts, ...contains, ...bySku].slice(0, limit);
}

export async function localProductCount(): Promise<number> {
  return db().products.count();
}

/**
 * Cuándo se actualizó por última vez el catálogo de este celular (RF-M5-29).
 * El POS lo muestra: sin internet, el cajero tiene que saber si los precios
 * que ve son de hoy o de hace tres días.
 */
export async function ultimaActualizacionCatalogo(): Promise<string | null> {
  try { return await getMeta(LAST_SYNC_KEY); } catch { return null; }
}
