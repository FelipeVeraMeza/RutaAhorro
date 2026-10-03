import { diaLocal, rangoDeDias, textoVencimiento } from '@rutaahorro/core';
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
/** Una zona que Intl no conoce hacía fallar cada fecha (RangeError); como la web, se usa la de omisión. */
function zonaValida(zona: unknown): string {
  if (typeof zona !== 'string' || zona === '') return 'America/Santiago';
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: zona });
    return zona;
  } catch {
    return 'America/Santiago';
  }
}

export async function runDailySummary() {
  const tenants = await activeTenants();
  const results: Array<{ tenant: string; sent: boolean }> = [];
  const fallidos: string[] = [];

  for (const tenant of tenants) {
    // Cada local por separado: un error en uno (una consulta que falla, una
    // zona mal escrita) cortaba el ciclo y los locales que venían después
    // se quedaban sin resumen esa noche.
    try {
      // El día del local, con su zona y su desfase de HOY (regla 17). Antes iba
      // '-03:00' escrito fijo: en invierno (-04:00) el "día" partía a las 23:00
      // de ayer. Y la zona era siempre la de Santiago, no la del local.
      const zona = zonaValida((tenant.settings as { timezone?: string })?.timezone);
      const today = diaLocal(new Date(), zona);
      const rango = rangoDeDias(today, today, zona);

      // Ventas del día, netas de devoluciones, como el Inicio (v_sales_daily).
      // Antes se traían las ventas de a una, y la API corta en 1.000: un día
      // bueno salía con el total corto.
      // Cada consulta revisa su error: antes uno se ignoraba y el correo decía
      // "Total vendido $0" o "Sin novedades" en un día normal, sin avisar que
      // no se pudo leer. Un resumen que miente es peor que uno que no llega.
      const ok = <T,>(r: { data: T; error: { message: string } | null; count?: number | null }, que: string) => {
        if (r.error) throw new Error(`Resumen diario: no se pudo leer ${que}: ${r.error.message}`);
        return r;
      };
      const { data: dia } = ok(await admin
        .from('v_sales_daily')
        .select('sales_count, total_amount, average_ticket')
        .eq('tenant_id', tenant.id)
        .eq('sale_date', today)
        .maybeSingle(), 'las ventas del día');
      const { count: voidedCount } = ok(await admin
        .from('sales')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .eq('status', 'anulada')
        .gte('sold_at', rango.desde)
        .lt('sold_at', rango.hasta), 'las anulaciones');

      const completed = { length: Number(dia?.sales_count ?? 0) };
      const voided = { length: voidedCount ?? 0 };
      const total = Number(dia?.total_amount ?? 0);
      const avgTicket = Number(dia?.average_ticket ?? 0);

      // Cajas: las cerradas hoy con diferencia y TODAS las que siguen abiertas.
      // Antes solo las abiertas hoy: la caja olvidada desde ayer, que es la
      // que hay que avisar, no salía en el resumen.
      const { data: abiertas } = ok(await admin
        .from('v_cash_sessions_summary')
        .select('full_name, status, difference, sales_total')
        .eq('tenant_id', tenant.id)
        .eq('status', 'abierta'), 'las cajas abiertas');
      const { data: cerradasHoy } = ok(await admin
        .from('v_cash_sessions_summary')
        .select('full_name, status, difference, sales_total')
        .eq('tenant_id', tenant.id)
        .eq('status', 'cerrada')
        .gte('closed_at', rango.desde)
        .lt('closed_at', rango.hasta), 'las cajas cerradas');

      const open = abiertas ?? [];
      const withDiff = (cerradasHoy ?? []).filter((s) => (s.difference ?? 0) !== 0);

      // Stock bajo mínimo: los 15 a los que más les falta, como el Inicio. Sin
      // orden, PostgreSQL devolvía 15 cualquiera, distintos cada noche.
      const { data: lowStock, count: totalBajos } = ok(await admin
        .from('v_low_stock')
        .select('name, quantity, min_stock', { count: 'exact' })
        .eq('tenant_id', tenant.id)
        .order('shortfall', { ascending: false })
        .limit(15), 'el stock bajo mínimo');

      // Vencimientos (ADR-007)
      const { data: expiring, count: totalLotes } = ok(await admin
        .from('v_expiring_lots')
        .select('product_name, expiry_date, quantity, value_at_risk, expiry_status, days_to_expiry', { count: 'exact' })
        .eq('tenant_id', tenant.id)
        .in('expiry_status', ['vencido', 'por_vencer'])
        .order('days_to_expiry', { ascending: true })
        .limit(15), 'los vencimientos');

      // Suma de los 15 que salen en el correo: se dice así si hay más. Antes
      // decía "Valor en riesgo" como si fuera el total.
      const valueAtRisk = (expiring ?? []).reduce((s, l) => s + (l.value_at_risk ?? 0), 0);
      const masLotes = Math.max(0, (totalLotes ?? 0) - (expiring ?? []).length);
      const masBajos = Math.max(0, (totalBajos ?? 0) - (lowStock ?? []).length);

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
            ...(valueAtRisk > 0 ? [[`<strong>Valor en riesgo${masLotes > 0 ? ` (estos ${(expiring ?? []).length})` : ''}</strong>`, `<strong>${money(valueAtRisk)}</strong>`]] : []),
            ...(expiring ?? []).map((l) => [
              // textoVencimiento, como la pantalla: decía "vence en 0 d".
              `${l.expiry_status === 'vencido' ? '🔴' : '🟡'} ${escapar(l.product_name)} · ${textoVencimiento(Number(l.days_to_expiry))}`,
              money(l.value_at_risk ?? 0),
            ]),
            ...(masLotes > 0 ? [[`Y ${masLotes} ${masLotes === 1 ? 'lote más' : 'lotes más'}: ver Inventario → Lotes`, '']] : []),
          ],
        },
        {
          heading: 'Stock bajo mínimo',
          rows: [
            ...(lowStock ?? []).map((p) => [escapar(p.name), `${p.quantity} / mín. ${p.min_stock}`]),
            ...(masBajos > 0 ? [[`Y ${masBajos} ${masBajos === 1 ? 'producto más' : 'productos más'}: ver Qué comprar`, '']] : []),
          ],
        },
      ];

      const alertPrefix = open.length > 0 ? '⚠️ ' : '';
      const html = renderEmail(`${alertPrefix}Resumen del día · ${tenant.name}`, sections, zona);
      // El día como se escribe en Chile (decía "Resumen del 2026-10-03").
      const r = await sendEmail(`${alertPrefix}RutaAhorro · Resumen del ${today.split('-').reverse().join('-')}`, html);

      results.push({ tenant: tenant.name, sent: r.sent });
      log.info('Resumen diario procesado', { tenant: tenant.name, total, sent: r.sent });
    } catch (e) {
      results.push({ tenant: tenant.name, sent: false });
      fallidos.push(tenant.name);
      log.error('Resumen diario falló para un local', { tenant: tenant.name, error: (e as Error)?.message ?? String(e) });
    }
  }

  // Que el trabajo quede como fallido (job_runs) después de intentar con todos.
  if (fallidos.length) throw new Error(`Resumen diario sin enviar para: ${fallidos.join(', ')}`);
  return { summaries: results };
}
