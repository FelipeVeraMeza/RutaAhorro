'use client';

import { normalizeBarcode } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { db, normalizeSearch, getMeta, setMeta, type LocalProduct } from './db';

/**
 * Replicación del catálogo al dispositivo.
 *
 * Se sincroniza de forma incremental por `updated_at`: la primera vez baja
 * todo, después solo lo que cambió. Con 3.000 SKU la carga inicial pesa pocos
 * cientos de KB; las siguientes, casi nada.
 */

const LAST_SYNC_KEY = 'catalog:lastSync';
const PAGE = 1000;

export async function syncCatalog(force = false): Promise<{ products: number; barcodes: number }> {
  const client = supabase();
  const since = force ? null : await getMeta(LAST_SYNC_KEY);
  const startedAt = new Date().toISOString();

  // --- Productos ---
  const products: LocalProduct[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = client
      .from('products')
      .select('id, name, sku, sale_price, unit, category_id, tracks_expiry, min_stock, is_active, updated_at')
      .order('updated_at', { ascending: true })
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
        sku: (p.sku as string) ?? null,
        salePrice: Number(p.sale_price ?? 0),
        unit: (p.unit as string) ?? 'unidad',
        categoryId: (p.category_id as string) ?? null,
        tracksExpiry: Boolean(p.tracks_expiry),
        stock: 0, // se completa abajo
        minStock: Number(p.min_stock ?? 0),
        isActive: Boolean(p.is_active),
        updatedAt: p.updated_at as string,
      })),
    );
    if (data.length < PAGE) break;
  }

  // --- Stock actual ---
  // Siempre completo: el stock cambia con cada venta de cualquier caja, así que
  // un sincronizado incremental por updated_at del producto se lo perdería.
  const { data: levels } = await client.from('stock_levels').select('product_id, quantity');
  const stockByProduct = new Map<string, number>(
    (levels ?? []).map((l) => [l.product_id as string, Number(l.quantity ?? 0)]),
  );

  // --- Códigos de barras ---
  const { data: codes } = await client.from('product_barcodes').select('barcode, product_id');

  const database = db();
  await database.transaction('rw', database.products, database.barcodes, async () => {
    if (products.length > 0) {
      for (const p of products) p.stock = stockByProduct.get(p.id) ?? 0;
      await database.products.bulkPut(products);
    }
    // Actualizar el stock de los productos que ya estaban en local
    if (!since || products.length === 0) {
      const existing = await database.products.toArray();
      const updates = existing
        .filter((p) => stockByProduct.has(p.id) && p.stock !== stockByProduct.get(p.id))
        .map((p) => ({ ...p, stock: stockByProduct.get(p.id)! }));
      if (updates.length > 0) await database.products.bulkPut(updates);
    }
    if (codes && codes.length > 0) {
      await database.barcodes.clear();
      await database.barcodes.bulkPut(
        codes.map((c) => ({
          barcode: normalizeBarcode(c.barcode as string),
          productId: c.product_id as string,
        })),
      );
    }
  });

  await setMeta(LAST_SYNC_KEY, startedAt);
  return { products: products.length, barcodes: codes?.length ?? 0 };
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

  const all = await database.products.where('isActive').equals(1 as never).toArray().catch(
    async () => database.products.toArray(),
  );

  const active = all.filter((p) => p.isActive);
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
