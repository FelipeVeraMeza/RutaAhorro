'use client';

import { db, normalizeSearch, type LocalProduct } from '../offline/db';
import { DEMO_PRODUCTOS } from './data';

/**
 * Carga el catálogo de ejemplo en IndexedDB.
 *
 * El POS busca y escanea SIEMPRE contra la base local (RNF-02). En modo demo no
 * hay Supabase de donde replicar, así que se siembra directamente. El resto del
 * POS funciona exactamente igual que en producción: no hay una rama especial
 * dentro de la pantalla de venta.
 */
export async function sembrarCatalogoDemo(): Promise<number> {
  const database = db();

  const productos: LocalProduct[] = DEMO_PRODUCTOS.map((p) => ({
    id: p.id,
    name: p.name,
    nameSearch: normalizeSearch(p.name),
    description: p.description ?? null,
    sku: p.sku,
    salePrice: p.sale_price,
    unit: p.unit,
    categoryId: p.categoria,
    tracksExpiry: p.tracks_expiry,
    stock: p.stock,
    minStock: p.min_stock,
    isActive: true,
    updatedAt: new Date().toISOString(),
  }));

  await database.transaction('rw', database.products, database.barcodes, async () => {
    await database.products.clear();
    await database.barcodes.clear();
    await database.products.bulkPut(productos);
    await database.barcodes.bulkPut(
      DEMO_PRODUCTOS.map((p) => ({ barcode: p.barcode, productId: p.id })),
    );
  });

  return productos.length;
}

/** Códigos de ejemplo, para poder probar el escaneo sin tener los productos. */
export const CODIGOS_DEMO = DEMO_PRODUCTOS.map((p) => ({
  codigo: p.barcode,
  nombre: p.name,
  precio: p.sale_price,
}));
