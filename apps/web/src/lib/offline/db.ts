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
  /** Lo que hay en la sala de ventas (0014). Opcional: catálogos viejos no lo traen. */
  stockSala?: number;
  stockBodega?: number;
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
  /**
   * Quién hizo la venta. Se envía solo con la sesión de esa persona: si no,
   * una venta sin conexión del cajero A que se sincroniza cuando ya entró el
   * cajero B queda en la caja de B, y el arqueo de B tiene plata que no cobró.
   * Opcional porque las ventas encoladas antes de este campo no lo traen.
   */
  userId?: string;
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

const DUENO_KEY = 'dispositivo:dueno';

/**
 * De quién es lo que está guardado en este navegador: `demo` o `tenant:<id>`.
 *
 * La maqueta y producción comparten esta base local. La sincronización real
 * solo agrega y actualiza, así que sin esto los 14 productos de ejemplo
 * seguían apareciendo en el POS de producción después de apagar el demo, con
 * códigos de barra que se podían escanear. Y un celular donde entraba alguien
 * de otro local le mostraba el catálogo del local anterior.
 *
 * Si el dueño cambió, se borra el catálogo y devuelve true: quien llama tiene
 * que bajarlo completo. Las ventas en cola no se tocan —pueden ser plata real
 * de otra persona, y `syncQueue` solo envía las del usuario que las hizo—,
 * salvo las de la maqueta, que nunca fueron plata.
 */
export async function asegurarDueno(dueno: string): Promise<boolean> {
  const database = db();
  const actual = await getMeta(DUENO_KEY);
  if (actual === dueno) return false;
  await database.transaction('rw', [database.products, database.barcodes, database.meta, database.saleQueue], async () => {
    await database.products.clear();
    await database.barcodes.clear();
    await database.meta.clear();
    if (actual === 'demo') await database.saleQueue.filter((s) => s.userId === 'demo').delete();
    await database.meta.put({ key: DUENO_KEY, value: dueno });
  });
  return true;
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
