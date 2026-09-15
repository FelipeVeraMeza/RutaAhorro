'use client';

import { supabase } from '../supabase/client';
import { db, type QueuedSale } from './db';

/**
 * Cola de ventas offline (US-15, ADR-005).
 *
 * Reglas que hacen esto seguro:
 *  - Cada venta lleva un `clientUuid` generado en el dispositivo. El servidor
 *    deduplica por él: reenviar una venta NO la duplica.
 *  - Se envían de a una y EN ORDEN. Enviarlas en paralelo puede alterar el
 *    orden de los folios respecto al orden real de las ventas.
 *  - Una venta que falla NO bloquea a las demás: se marca en error y se sigue
 *    con la siguiente (docs/08-api-contratos.md §4.1).
 */

export function newClientUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Respaldo para navegadores antiguos sin randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function enqueueSale(sale: Omit<QueuedSale, 'status' | 'attempts' | 'createdAt'>) {
  await db().saleQueue.put({
    ...sale,
    status: 'pendiente',
    attempts: 0,
    createdAt: new Date().toISOString(),
  });
}

export async function pendingCount(): Promise<number> {
  return db().saleQueue.where('status').anyOf('pendiente', 'error').count();
}

export async function pendingSales(): Promise<QueuedSale[]> {
  const rows = await db().saleQueue.where('status').anyOf('pendiente', 'error').toArray();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface SyncResult {
  sent: number;
  duplicated: number;
  failed: number;
  remaining: number;
}

let syncing = false;

/** Envía la cola al servidor. Es seguro llamarla muchas veces. */
export async function syncQueue(): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, duplicated: 0, failed: 0, remaining: 0 };

  if (syncing || typeof navigator !== 'undefined' && !navigator.onLine) {
    result.remaining = await pendingCount();
    return result;
  }

  syncing = true;
  try {
    const client = supabase();
    const queue = await pendingSales();

    for (const sale of queue) {
      await db().saleQueue.update(sale.clientUuid, { status: 'enviando' });

      const { data, error } = await client.rpc('fn_register_sale', {
        p_client_uuid: sale.clientUuid,
        p_items: sale.items.map(({ name: _name, ...rest }) => rest),
        p_payments: sale.payments,
        p_sold_at: sale.soldAt,
        p_discount_total: sale.discountTotal,
      });

      if (error) {
        result.failed++;
        await db().saleQueue.update(sale.clientUuid, {
          status: 'error',
          attempts: sale.attempts + 1,
          lastError: error.message,
        });
        // Se sigue con la siguiente: una venta con un producto que alguien
        // desactivó no puede impedir que se sincronicen las otras del turno.
        continue;
      }

      if ((data as { already_existed?: boolean })?.already_existed) result.duplicated++;
      else result.sent++;

      // Solo aquí se borra de la cola: cuando el servidor confirmó.
      await db().saleQueue.delete(sale.clientUuid);
    }
  } finally {
    syncing = false;
  }

  result.remaining = await pendingCount();
  return result;
}

/** Sincroniza al recuperar la conexión y cada 60 s como red de seguridad. */
export function startAutoSync(onResult?: (r: SyncResult) => void) {
  if (typeof window === 'undefined') return () => {};

  const run = () => {
    void syncQueue().then((r) => {
      if (r.sent > 0 || r.duplicated > 0 || r.failed > 0) onResult?.(r);
    });
  };

  window.addEventListener('online', run);
  const timer = window.setInterval(run, 60_000);
  run();

  return () => {
    window.removeEventListener('online', run);
    window.clearInterval(timer);
  };
}
