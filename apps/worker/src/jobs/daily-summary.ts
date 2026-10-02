import { diaLocal, rangoDeDias } from '@rutaahorro/core';
import { admin, activeTenants } from '../supabase.js';
import { sendEmail, renderEmail, money, escapar } from '../mailer.js';
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
  const results: Array<{ tenant: string; sent: boolean }> = [];

  for (const tenant of tenants) {
    // El día del local, con su zona y su desfase de HOY (regla 17). Antes iba
    // '-03:00' escrito fijo: en invierno (-04:00) el "día" partía a las 23:00
    // de ayer. Y la zona era siempre la de Santiago, no la del local.
    const zona = String((tenant.settings as { timezone?: string })?.timezone || 'America/Santiago');
    const today = diaLocal(new Date(), zona);
    const rango = rangoDeDias(today, today, zona);

    // Ventas del día, netas de devoluciones, como el Inicio (v_sales_daily).
    // Antes se traían las ventas de a una, y la API corta en 1.000: un día
    // bueno salía con el total corto.
    const { data: dia } = await admin
      .from('v_sales_daily')
      .select('sales_count, total_amount, average_ticket')
      .eq('tenant_id', tenant.id)
      .eq('sale_date', today)
      .maybeSingle();
    const { count: voidedCount } = await admin
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('status', 'anulada')
      .gte('sold_at', rango.desde)
      .lt('sold_at', rango.hasta);

    const completed = { length: Number(dia?.sales_count ?? 0) };
    const voided = { length: voidedCount ?? 0 };
    const total = Number(dia?.total_amount ?? 0);
    const avgTicket = Number(dia?.average_ticket ?? 0);

    // Cajas: las cerradas hoy con diferencia y TODAS las que siguen abiertas.
    // Antes solo las abiertas hoy: la caja olvidada desde ayer, que es la
    // que hay que avisar, no salía en el resumen.
    const { data: abiertas } = await admin
      .from('v_cash_sessions_summary')
      .select('full_name, status, difference, sales_total')
      .eq('tenant_id', tenant.id)
      .eq('status', 'abierta');
    const { data: cerradasHoy } = await admin
      .from('v_cash_sessions_summary')
      .select('full_name, status, difference, sales_total')
      .eq('tenant_id', tenant.id)
      .eq('status', 'cerrada')
      .gte('closed_at', rango.desde)
      .lt('closed_at', rango.hasta);

    const open = abiertas ?? [];
    const withDiff = (cerradasHoy ?? []).filter((s) => (s.difference ?? 0) !== 0);

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
            ? open.map((s) => [`⚠️ Caja SIN CERRAR · ${escapar(s.full_name ?? 'sin nombre')}`, money(s.sales_total ?? 0)])
            : []),
          ...withDiff.map((s) => [
            `${(s.difference ?? 0) < 0 ? 'Faltante' : 'Sobrante'} · ${escapar(s.full_name ?? 'sin nombre')}`,
            money(Math.abs(s.difference ?? 0)),
          ]),
        ],
      },
      {
        heading: 'Vencimientos',
        rows: [
          ...(valueAtRisk > 0 ? [['<strong>Valor en riesgo</strong>', `<strong>${money(valueAtRisk)}</strong>`]] : []),
          ...(expiring ?? []).map((l) => [
            `${l.expiry_status === 'vencido' ? '🔴' : '🟡'} ${escapar(l.product_name)} · ${
              l.expiry_status === 'vencido' ? `venció hace ${Math.abs(l.days_to_expiry)} d` : `vence en ${l.days_to_expiry} d`
            }`,
            money(l.value_at_risk ?? 0),
          ]),
        ],
      },
      {
        heading: 'Stock bajo mínimo',
        rows: (lowStock ?? []).map((p) => [escapar(p.name), `${p.quantity} / mín. ${p.min_stock}`]),
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
