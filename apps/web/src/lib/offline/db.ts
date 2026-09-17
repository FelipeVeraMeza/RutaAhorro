'use client';

import Dexie, { type Table } from 'dexie';

/**
 * Base local del dispositivo (IndexedDB).
 *
 * Contiene dos cosas:
 *  1. El catálogo replicado, para que buscar y escanear funcione sin internet
 *     y responda en menos de 300 ms (RNF-02).
 *  2. La cola de ventas pendientes de sincronizar (US-15, ADR-005).
 *
 * Nunca guarda costos ni márgenes: el dispositivo de un vendedor no debe
 * contener información que su rol no puede ver, ni siquiera en caché.
 */

export interface LocalProduct {
  id: string;
  name: string;
  nameSearch: string;      // normalizado: minúsculas y sin tildes
  /** Qué es el producto. Se muestra al escanearlo en el POS. */
  description?: string | null;
  sku: string | null;
  salePrice: number;
  unit: string;
  categoryId: string | null;
  tracksExpiry: boolean;
  stock: number;
  minStock: number;
  isActive: boolean;
  updatedAt: string;
}

export interface LocalBarcode {
  barcode: string;
  productId: string;
}

export type QueuedSaleStatus = 'pendiente' | 'enviando' | 'error';

export interface QueuedSale {
  clientUuid: string;
  soldAt: string;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    discount_amount: number;
    name: string;
  }>;
  payments: Array<{ method: string; amount: number; received_amount?: number }>;
  discountTotal: number;
  total: number;
  status: QueuedSaleStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
}

export interface MetaEntry {
  key: string;
  value: string;
}

class RutaAhorroDB extends Dexie {
  products!: Table<LocalProduct, string>;
  barcodes!: Table<LocalBarcode, string>;
  saleQueue!: Table<QueuedSale, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('rutaahorro');
    this.version(1).stores({
      products: 'id, nameSearch, sku, categoryId, isActive',
      barcodes: 'barcode, productId',
      saleQueue: 'clientUuid, status, createdAt',
      meta: 'key',
    });
  }
}

let instance: RutaAhorroDB | null = null;

export function db(): RutaAhorroDB {
  if (!instance) instance = new RutaAhorroDB();
  return instance;
}

/** Quita tildes y pasa a minúsculas: buscar "leche" debe encontrar "Lechè". */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await db().meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db().meta.put({ key, value });
}

/** Al cerrar sesión se borra todo: el siguiente turno puede ser de otra persona. */
export async function clearLocalData(): Promise<void> {
  const database = db();
  await Promise.all([
    database.products.clear(),
    database.barcodes.clear(),
    database.meta.clear(),
  ]);
  // La cola de ventas NO se borra: son ventas reales que aún no llegan al
  // servidor. Perderlas sería perder plata del local.
}
