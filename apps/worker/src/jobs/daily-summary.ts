import { admin, activeTenants } from '../supabase.js';
import { sendEmail, renderEmail, money } from '../mailer.js';
import { log } from '../logger.js';

/**
 * Resumen diario al administrador (RF-M8-02, RF-M8-03).
 *
 * Es lo que permite al dueño enterarse de cómo fue el día sin entrar al sistema
 * ni llamar al local — el objetivo ON-5. Incluye a propósito lo incómodo
 * (diferencias de caja, cajas sin cerrar, productos por vencer): un resumen que
 * solo muestra buenas noticias no sirve para administrar.
 */
export async function runDailySummary() {
  const tenants = await activeTenants();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const results: Array<{ tenant: string; sent: boolean }> = [];

  for (const tenant of tenants) {
    // Ventas del día
    const { data: sales } = await admin
      .from('sales')
      .select('total, status')
      .eq('tenant_id', tenant.id)
      .gte('sold_at', `${today}T00:00:00-03:00`)
      .lte('sold_at', `${today}T23:59:59-03:00`);

    const completed = (sales ?? []).filter((s) => s.status === 'completada');
    const voided = (sales ?? []).filter((s) => s.status === 'anulada');
    const total = completed.reduce((sum, s) => sum + (s.total ?? 0), 0);
    const avgTicket = completed.length > 0 ? Math.round(total / completed.length) : 0;

    // Cajas del día
    const { data: sessions } = await admin
      .from('v_cash_sessions_summary')
      .select('full_name, status, difference, sales_total')
      .eq('tenant_id', tenant.id)
      .gte('opened_at', `${today}T00:00:00-03:00`);

    const open = (sessions ?? []).filter((s) => s.status === 'abierta');
    const withDiff = (sessions ?? []).filter((s) => s.status === 'cerrada' && (s.difference ?? 0) !== 0);

    // Stock bajo mínimo
    const { data: lowStock } = await admin
      .from('v_low_stock')
      .select('name, quantity, min_stock')
      .eq('tenant_id', tenant.id)
      .limit(15);

    // Vencimientos (ADR-007)
    const { data: expiring } = await admin
      .from('v_expiring_lots')
      .select('product_name, expiry_date, quantity, value_at_risk, expiry_status, days_to_expiry')
      .eq('tenant_id', tenant.id)
      .in('expiry_status', ['vencido', 'por_vencer'])
      .order('days_to_expiry', { ascending: true })
      .limit(15);

    const valueAtRisk = (expiring ?? []).reduce((s, l) => s + (l.value_at_risk ?? 0), 0);

    const sections = [
      {
        heading: 'Ventas de hoy',
        rows: [
          ['Total vendido', money(total)],
          ['Transacciones', String(completed.length)],
          ['Ticket promedio', money(avgTicket)],
          ...(voided.length > 0 ? [['Ventas anuladas', String(voided.length)]] : []),
        ],
      },
      {
        heading: 'Caja',
        rows: [
          ...(open.length > 0
            ? open.map((s) => [`⚠️ Caja SIN CERRAR · ${s.full_name ?? 'sin nombre'}`, money(s.sales_total ?? 0)])
            : []),
          ...withDiff.map((s) => [
            `${(s.difference ?? 0) < 0 ? 'Faltante' : 'Sobrante'} · ${s.full_name ?? 'sin nombre'}`,
            money(Math.abs(s.difference ?? 0)),
          ]),
        ],
      },
      {
        heading: 'Vencimientos',
        rows: [
          ...(valueAtRisk > 0 ? [['<strong>Valor en riesgo</strong>', `<strong>${money(valueAtRisk)}</strong>`]] : []),
          ...(expiring ?? []).map((l) => [
            `${l.expiry_status === 'vencido' ? '🔴' : '🟡'} ${l.product_name} · ${
              l.expiry_status === 'vencido' ? `venció hace ${Math.abs(l.days_to_expiry)} d` : `vence en ${l.days_to_expiry} d`
            }`,
            money(l.value_at_risk ?? 0),
          ]),
        ],
      },
      {
        heading: 'Stock bajo mínimo',
        rows: (lowStock ?? []).map((p) => [p.name as string, `${p.quantity} / mín. ${p.min_stock}`]),
      },
    ];

    const alertPrefix = open.length > 0 ? '⚠️ ' : '';
    const html = renderEmail(`${alertPrefix}Resumen del día · ${tenant.name}`, sections);
    const r = await sendEmail(`${alertPrefix}RutaAhorro · Resumen del ${today}`, html);

    results.push({ tenant: tenant.name, sent: r.sent });
    log.info('Resumen diario procesado', { tenant: tenant.name, total, sent: r.sent });
  }

  return { summaries: results };
}
