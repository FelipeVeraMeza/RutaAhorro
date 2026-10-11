import { diaLocal, rangoDeDias } from '@rutaahorro/core';
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
  const results: Array<{ tenant: string; sent: boolean }> = [];

  for (const tenant of tenants) {
    // El día del local (regla 17). Antes iba fijo "-03:00": con el horario de
    // invierno (-04:00) el resumen sumaba la última hora del día anterior.
    const zona = String((tenant.settings as { timezone?: string })?.timezone || 'America/Santiago');
    const today = diaLocal(new Date(), zona);
    const dia = rangoDeDias(today, today, zona);

    // Ventas del día, de a 1.000: la API no entrega más por consulta y un día
    // con más ventas salía con el total corto, sin avisar.
    const sales: Array<{ total: number | null; status: string }> = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await admin
        .from('sales')
        .select('total, status')
        .eq('tenant_id', tenant.id)
        .gte('sold_at', dia.desde)
        .lt('sold_at', dia.hasta)
        .order('id')
        .range(desde, desde + 999);
      if (error) throw new Error(`No se pudieron leer las ventas: ${error.message}`);
      sales.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }

    const completed = sales.filter((s) => s.status === 'completada');
    const voided = sales.filter((s) => s.status === 'anulada');
    const total = completed.reduce((sum, s) => sum + (s.total ?? 0), 0);
    const avgTicket = completed.length > 0 ? Math.round(total / completed.length) : 0;

    // Cajas del día, y las que siguen abiertas aunque sean de antes: una caja
    // olvidada desde ayer no salía como "SIN CERRAR".
    const { data: sessions } = await admin
      .from('v_cash_sessions_summary')
      .select('full_name, status, difference, sales_total')
      .eq('tenant_id', tenant.id)
      .or(`status.eq.abierta,opened_at.gte."${dia.desde}"`);

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

    // docs/33 · Pedidos de la tienda online: los de hoy y los que siguen sin
    // entregar. Sin 0040 la tabla no existe y la sección no sale.
    const { data: pedidosHoy } = await admin
      .from('pedidos_web').select('estado, total')
      .eq('tenant_id', tenant.id).gte('created_at', dia.desde).lt('created_at', dia.hasta);
    const { count: pedidosAbiertos } = await admin
      .from('pedidos_web').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id).in('estado', ['recibido', 'preparando', 'listo']);

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
      ...(pedidosHoy && (pedidosHoy.length > 0 || (pedidosAbiertos ?? 0) > 0) ? [{
        heading: 'Pedidos web',
        rows: [
          ['Pedidos de hoy', String(pedidosHoy.length)],
          ['Entregados hoy', money(pedidosHoy.filter((p) => p.estado === 'entregado').reduce((s, p) => s + (p.total ?? 0), 0))],
          ...((pedidosAbiertos ?? 0) > 0 ? [[`⚠️ Sin entregar todavía`, String(pedidosAbiertos)]] : []),
        ],
      }] : []),
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
