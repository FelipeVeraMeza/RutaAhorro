'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db, type QueuedSale } from './db';
import { syncCatalog } from './catalog';
import { registrarVentaDemo } from '../datos/ventas';

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

/**
 * Usuario de la sesión, leído del almacenamiento local y no del servidor:
 * tiene que funcionar sin conexión, que es cuando más se encola.
 */
const ULTIMO_USUARIO = 'ra:ultimo-usuario';

async function usuarioActual(): Promise<string | null> {
  if (DEMO_ACTIVO) return 'demo';
  // Sin red y con el token vencido (pasa a la hora), getSession no puede
  // refrescarlo y devuelve null. La venta se encolaba sin dueño, y una venta
  // sin dueño la enviaba el siguiente que entrara: quedaba en SU caja. Se
  // recuerda quién tuvo la sesión por última vez en este navegador.
  try {
    const { data } = await supabase().auth.getSession();
    const id = data.session?.user.id;
    if (id) {
      try { localStorage.setItem(ULTIMO_USUARIO, id); } catch { /* sin almacenamiento */ }
      return id;
    }
  } catch { /* sin red */ }
  try { return localStorage.getItem(ULTIMO_USUARIO); } catch { return null; }
}

export async function enqueueSale(sale: Omit<QueuedSale, 'status' | 'attempts' | 'createdAt' | 'userId'>) {
  await db().saleQueue.put({
    ...sale,
    userId: (await usuarioActual()) ?? undefined,
    status: 'pendiente',
    attempts: 0,
    createdAt: new Date().toISOString(),
  });
}

export async function pendingCount(): Promise<number> {
  return (await pendingSales()).length;
}

/**
 * Las ventas por enviar de quien tiene la sesión abierta. Las de otro usuario
 * del mismo celular esperan a que esa persona vuelva a entrar: enviarlas con
 * esta sesión las dejaría en otra caja.
 */
export async function pendingSales(): Promise<QueuedSale[]> {
  const yo = await usuarioActual();
  // 'enviando' también: si la pestaña se cerró (o el celular se quedó sin
  // batería) a mitad del envío, la venta quedaba en ese estado para siempre,
  // fuera de la cola y del aviso de "ventas sin enviar". Reenviarla es seguro:
  // la base la reconoce por su clientUuid y no la duplica.
  const rows = await db().saleQueue.where('status').anyOf('pendiente', 'enviando', 'error').toArray();
  return rows
    .filter((s) => !s.userId || s.userId === yo)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Las ventas que la base rechazó al sincronizar, con el motivo. Antes
 * quedaban contadas como "por sincronizar" para siempre y nadie veía por qué:
 * la plata estaba en el cajón y la venta no, y el arqueo no cuadraba.
 */
export async function ventasConError(): Promise<QueuedSale[]> {
  return (await pendingSales()).filter((s) => s.status === 'error');
}

export interface SyncResult {
  sent: number;
  duplicated: number;
  failed: number;
  remaining: number;
}

/**
 * La sincronización en curso, si hay una. Antes era un booleano y una segunda
 * llamada volvía al tiro: el POS (que sincroniza para saber si la base aceptó
 * la venta) leía la venta todavía "pendiente" y entregaba el comprobante de
 * una venta que la base podía rechazar un segundo después (regla 19).
 */
let enCurso: Promise<SyncResult> | null = null;

/**
 * Lo que respondió la base por cada venta enviada en esta sesión: el folio y
 * la boleta o factura emitida (0019). El POS lo lee para imprimir el
 * documento con su número y su timbre, que solo existen después de que la
 * base confirmó.
 */
const respuestas = new Map<string, unknown>();
export function respuestaDe(clientUuid: string): unknown {
  return respuestas.get(clientUuid);
}

/**
 * Envía la cola al servidor. Es seguro llamarla muchas veces: si ya hay una
 * sincronización andando, se espera a que termine y se hace otra pasada, así
 * lo que se encoló mientras tanto también se envía antes de responder.
 */
export async function syncQueue(): Promise<SyncResult> {
  while (enCurso) await enCurso.catch(() => undefined);
  const esta = enviarCola();
  enCurso = esta;
  try {
    return await esta;
  } finally {
    if (enCurso === esta) enCurso = null;
  }
}

/**
 * ¿El envío falló por la red y no porque la base rechazó la venta? Sin
 * respuesta del servidor (status 0) no se sabe nada de la venta: se deja
 * pendiente, no en error. Antes quedaba "rechazada" con "Failed to fetch".
 */
function falloDeRed(status: number, error: { code?: string } | null): boolean {
  // 401 (token vencido, PGRST301/PGRST303) y 5xx (Supabase caído o
  // reiniciando) tampoco dicen nada de la venta: antes la dejaban "rechazada
  // por la base" y el POS le avisaba al cajero que la venta no existía.
  return status === 0 || status === 401 || status >= 500
    || (!!error && (!error.code || error.code === 'PGRST301' || error.code === 'PGRST303'));
}

async function enviarCola(): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, duplicated: 0, failed: 0, remaining: 0 };

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    result.remaining = await pendingCount();
    return result;
  }

  {
    const queue = await pendingSales();

    // En demo no hay servidor: se simula una sincronización exitosa para poder
    // ver el indicador de "por sincronizar" y cómo se vacía.
    if (DEMO_ACTIVO) {
      for (const sale of queue) {
        try {
          // La maqueta también entrega el folio: el comprobante decía
          // "N° pendiente de sincronizar" en una venta ya registrada.
          respuestas.set(sale.clientUuid, { folio: await registrarVentaDemo(sale) });
        } catch (e) {
          // Igual que un rechazo de la base: queda con su error en la cola.
          result.failed++;
          await db().saleQueue.update(sale.clientUuid, {
            status: 'error', attempts: sale.attempts + 1, lastError: (e as Error).message,
          });
          continue;
        }
        await db().saleQueue.delete(sale.clientUuid);
        result.sent++;
      }
      result.remaining = await pendingCount();
      return result;
    }

    const client = supabase();

    for (const sale of queue) {
      await db().saleQueue.update(sale.clientUuid, { status: 'enviando' });

      const { data, error, status } = await client.rpc('fn_register_sale', {
        p_client_uuid: sale.clientUuid,
        p_items: sale.items.map(({ name: _name, ...rest }) => rest),
        p_payments: sale.payments,
        p_sold_at: sale.soldAt,
        p_discount_total: sale.discountTotal,
        p_force: sale.sinConexion === true,
        // La base lo valida de nuevo y decide si viene null: la pantalla no es
        // la única forma de registrar una venta (regla 6).
        // El cliente (0022) viaja en el mismo objeto: la firma de la función
        // no cambia y la cola vieja sigue sirviendo.
        p_document: sale.documento || sale.clienteId || sale.autorizacion
          ? {
              tipo: sale.documento?.tipo ?? null,
              rut: sale.documento?.receptor?.rut ?? null,
              razon_social: sale.documento?.receptor?.razonSocial ?? null,
              giro: sale.documento?.receptor?.giro ?? null,
              direccion: sale.documento?.receptor?.direccion ?? null,
              cliente_id: sale.clienteId ?? null,
              autorizacion: sale.autorizacion ?? null,
            }
          : null,
      });

      if (error && falloDeRed(status, error)) {
        // Sin respuesta: la venta vuelve a la cola tal cual y se corta la
        // pasada (las siguientes fallarían igual). Se reintenta con la red.
        await db().saleQueue.update(sale.clientUuid, { status: 'pendiente', lastError: error.message });
        break;
      }

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

      respuestas.set(sale.clientUuid, data);
      if ((data as { already_existed?: boolean })?.already_existed) result.duplicated++;
      else result.sent++;

      // Solo aquí se borra de la cola: cuando el servidor confirmó.
      await db().saleQueue.delete(sale.clientUuid);
    }
    // El stock que muestra el POS es el del celular. Sin esto quedaba el de
    // antes de vender hasta la sincronización periódica, 10 minutos después.
    if (result.sent > 0) void syncCatalog().catch(() => {});
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
