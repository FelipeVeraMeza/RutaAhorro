import { admin, activeTenants, todasLasFilas } from '../supabase.js';
import { sendEmail, renderEmail, money } from '../mailer.js';
import { log } from '../logger.js';

/** Alertas de stock bajo mínimo (RF-M8-01). */
export async function runLowStockCheck() {
  const tenants = await activeTenants();
  let created = 0;

  for (const tenant of tenants) {
    // Por páginas: con más de 1.000 productos bajo mínimo (un local recién
    // cargado con mínimos y sin stock) los demás no avisaban nunca. Un error
    // ya no queda como "ok, 0 alertas" en job_runs.
    const data = await todasLasFilas<{ product_id: string; name: string; quantity: number; min_stock: number }>((a, b) => admin
      .from('v_low_stock')
      .select('product_id, name, quantity, min_stock')
      .eq('tenant_id', tenant.id)
      .order('product_id')
      .range(a, b));

    for (const p of data) {
      // No repetir la alerta si ya hay una sin leer del mismo producto:
      // un panel con la misma alerta cuarenta veces deja de leerse.
      const { data: existing } = await admin
        .from('alerts')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('type', 'low_stock')
        .eq('is_read', false)
        .contains('payload', { product_id: p.product_id })
        .limit(1);

      if ((existing ?? []).length > 0) continue;

      await admin.from('alerts').insert({
        tenant_id: tenant.id,
        type: 'low_stock',
        severity: (p.quantity ?? 0) <= 0 ? 'critical' : 'warning',
        payload: { product_id: p.product_id, product_name: p.name, quantity: p.quantity, min_stock: p.min_stock },
      });
      created++;
    }
  }

  return { alertsCreated: created };
}

/** Alertas de vencimiento (RF-M4-18, ADR-007). */
export async function runExpiryCheck() {
  const tenants = await activeTenants();
  let created = 0;

  for (const tenant of tenants) {
    // Por páginas, como el stock bajo mínimo.
    const data = await todasLasFilas<{
      lot_id: string; product_id: string; product_name: string; expiry_date: string; quantity: number;
      value_at_risk: number; expiry_status: string; days_to_expiry: number;
    }>((a, b) => admin
      .from('v_expiring_lots')
      .select('lot_id, product_id, product_name, expiry_date, quantity, value_at_risk, expiry_status, days_to_expiry')
      .eq('tenant_id', tenant.id)
      .in('expiry_status', ['vencido', 'por_vencer'])
      .order('lot_id')
      .range(a, b));

    for (const lot of data) {
      const { data: existing } = await admin
        .from('alerts')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('type', lot.expiry_status === 'vencido' ? 'lot_expired' : 'lot_expiring')
        .eq('is_read', false)
        .contains('payload', { lot_id: lot.lot_id })
        .limit(1);

      if ((existing ?? []).length > 0) continue;

      await admin.from('alerts').insert({
        tenant_id: tenant.id,
        type: lot.expiry_status === 'vencido' ? 'lot_expired' : 'lot_expiring',
        severity: lot.expiry_status === 'vencido' ? 'critical' : 'warning',
        payload: {
          lot_id: lot.lot_id,
          product_id: lot.product_id,
          product_name: lot.product_name,
          expiry_date: lot.expiry_date,
          quantity: lot.quantity,
          value_at_risk: lot.value_at_risk,
          days_to_expiry: lot.days_to_expiry,
        },
      });
      created++;
    }
  }

  return { alertsCreated: created };
}

/**
 * Avisa las cajas que quedaron abiertas (RF-M8-03).
 *
 * Dos cosas que este trabajo no hacía:
 *
 * 1. **Miraba la hora de apertura.** Avisaba de toda caja abierta, incluida la
 *    que un cajero abrió hace diez minutos. Si el trabajo corre mientras el
 *    local está atendiendo —y corre todos los días— denuncia a todo el mundo
 *    por estar trabajando. `cash_alert_hours` está en la configuración del
 *    local desde la primera migración, con 12 horas, y nadie la leía.
 *
 * 2. **No repetía la alerta.** Los otros dos chequeos comprueban si ya hay una
 *    sin leer del mismo objeto antes de crear otra, y este no: una caja que
 *    alguien olvidó abierta una semana generaba siete alertas idénticas, y un
 *    panel con la misma alerta siete veces deja de leerse.
 */
export async function runOpenCashCheck() {
  const tenants = await activeTenants();
  const found: Array<{ tenant: string; user: string; horas: number }> = [];

  for (const tenant of tenants) {
    const horasLimite = Number(
      (tenant.settings as { cash_alert_hours?: number | string })?.cash_alert_hours ?? 12,
    );
    const limite = Number.isFinite(horasLimite) && horasLimite > 0 ? horasLimite : 12;

    const { data, error } = await admin
      .from('v_cash_sessions_summary')
      .select('session_id, full_name, opened_at, sales_total')
      .eq('tenant_id', tenant.id)
      .eq('status', 'abierta');
    if (error) throw new Error(`No se pudieron leer las cajas abiertas: ${error.message}`);

    for (const s of data ?? []) {
      const horas = (Date.now() - new Date(s.opened_at as string).getTime()) / 3_600_000;
      if (horas < limite) continue;

      const { data: existing } = await admin
        .from('alerts')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('type', 'cash_session_open')
        .eq('is_read', false)
        .contains('payload', { session_id: s.session_id })
        .limit(1);

      if ((existing ?? []).length > 0) continue;

      await admin.from('alerts').insert({
        tenant_id: tenant.id,
        type: 'cash_session_open',
        severity: 'warning',
        payload: {
          session_id: s.session_id, user: s.full_name,
          opened_at: s.opened_at, hours_open: Math.round(horas),
        },
      });
      found.push({
        tenant: tenant.name,
        user: (s.full_name as string) ?? 'sin nombre',
        horas: Math.round(horas),
      });
    }
  }

  return { openSessions: found };
}

/**
 * Verificación semanal de integridad del inventario.
 *
 * Compara el saldo derivado (`stock_levels`) contra la suma real del kardex y lo
 * corrige. Es el control que justifica tener una tabla derivada: si alguna vez
 * se desincroniza, el equipo se entera el domingo y no el día en que el cliente
 * descubre que su inventario no cuadra. Ver ADR-006 §5.4.
 */
export async function runIntegrityCheck() {
  const tenants = await activeTenants();
  const results: Array<{ tenant: string; corrected: number; lotMismatches: number }> = [];

  for (const tenant of tenants) {
    const { data, error } = await admin.rpc('fn_rebuild_stock_levels', { p_tenant: tenant.id });
    if (error) throw new Error(`Reconstrucción de stock falló: ${error.message}`);

    const corrected = (data as { corrected?: number })?.corrected ?? 0;

    // ADR-007: el stock de un perecible vive en stock_levels Y en product_lots.
    // Si difieren, FEFO descontará de lotes que no reflejan el saldo real.
    // Por páginas y de una vez (antes, una consulta por producto y sin
    // paginar). Se recorren también los perecibles con stock y SIN ningún lote
    // con cantidad: no aparecen en v_stock_by_lot, así que su descuadre (stock
    // 12, lotes 0) no se detectaba nunca y la venta no tenía de dónde
    // descontar por FEFO.
    const byLot = await todasLasFilas<{ product_id: string; product_name: string; total_quantity: number }>((a, b) => admin
      .from('v_stock_by_lot').select('product_id, product_name, total_quantity')
      .eq('tenant_id', tenant.id).order('product_id').range(a, b));
    const niveles = await todasLasFilas<{ product_id: string; quantity: number; products: unknown }>((a, b) => admin
      .from('stock_levels').select('product_id, quantity, products!inner(name, tracks_expiry)')
      .eq('tenant_id', tenant.id).eq('products.tracks_expiry', true)
      .order('product_id').order('store_id').range(a, b));
    const stockDe = new Map<string, { cantidad: number; nombre: string }>();
    for (const n of niveles) {
      const x = stockDe.get(n.product_id) ?? { cantidad: 0, nombre: (n.products as { name?: string } | null)?.name ?? 'Producto' };
      x.cantidad += Number(n.quantity ?? 0);
      stockDe.set(n.product_id, x);
    }
    const lotesDe = new Map(byLot.map((r) => [r.product_id, r]));
    const revisar = new Set<string>([...lotesDe.keys(), ...[...stockDe].filter(([, x]) => x.cantidad > 0).map(([id]) => id)]);

    let lotMismatches = 0;
    for (const productId of revisar) {
      const enStock = stockDe.get(productId)?.cantidad ?? 0;
      const enLotes = Number(lotesDe.get(productId)?.total_quantity ?? 0);
      const diff = Math.abs(enStock - enLotes);
      if (diff > 0.001) {
        lotMismatches++;
        // Una por producto mientras no se lea, como los otros chequeos: cada
        // domingo se sumaba otra igual del mismo producto.
        const { data: existing } = await admin
          .from('alerts').select('id')
          .eq('tenant_id', tenant.id).eq('type', 'lot_stock_mismatch').eq('is_read', false)
          .contains('payload', { product_id: productId }).limit(1);
        if ((existing ?? []).length > 0) continue;
        await admin.from('alerts').insert({
          tenant_id: tenant.id,
          type: 'lot_stock_mismatch',
          severity: 'critical',
          payload: {
            product_id: productId,
            product_name: lotesDe.get(productId)?.product_name ?? stockDe.get(productId)?.nombre,
            stock_levels: enStock,
            sum_of_lots: enLotes,
            difference: diff,
          },
        });
      }
    }

    if (corrected > 0 || lotMismatches > 0) {
      log.warn('Integridad de inventario con desviaciones', {
        tenant: tenant.name, corrected, lotMismatches,
      });
      await sendEmail(
        `⚠️ RutaAhorro · Revisión de inventario · ${tenant.name}`,
        renderEmail('Desviaciones detectadas en el inventario', [
          {
            heading: 'Resultado de la verificación semanal',
            rows: [
              ['Saldos corregidos desde el kardex', String(corrected)],
              ['Productos con lotes descuadrados', String(lotMismatches)],
            ],
          },
        ]),
      );
    }

    results.push({ tenant: tenant.name, corrected, lotMismatches });
  }

  return { integrity: results };
}

export { money };
