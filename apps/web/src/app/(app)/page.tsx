import Link from 'next/link';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { formatCLP } from '@rutaahorro/core';

export const metadata = { title: 'Resumen' };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const client = await createClient();
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

  const { data: ventas } = await client
    .from('sales')
    .select('total, status')
    .gte('sold_at', `${hoy}T00:00:00-03:00`)
    .lte('sold_at', `${hoy}T23:59:59-03:00`);

  const completadas = (ventas ?? []).filter((v) => v.status === 'completada');
  const total = completadas.reduce((s, v) => s + (v.total ?? 0), 0);
  const ticket = completadas.length > 0 ? Math.round(total / completadas.length) : 0;

  const { data: bajoStock } = await client
    .from('v_low_stock').select('product_id, name, quantity, min_stock').limit(8);

  const { data: porVencer } = await client
    .from('v_expiring_lots')
    .select('lot_id, product_name, expiry_date, quantity, value_at_risk, expiry_status, days_to_expiry')
    .in('expiry_status', ['vencido', 'por_vencer'])
    .order('days_to_expiry', { ascending: true })
    .limit(8);

  const enRiesgo = (porVencer ?? []).reduce((s, l) => s + (l.value_at_risk ?? 0), 0);

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Hola, {user!.fullName.split(' ')[0] || 'bienvenido'}</h1>
        <p className="text-sm text-[var(--texto-suave)]">Así va el día</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tarjeta label="Vendido hoy" value={formatCLP(total)} />
        <Tarjeta label="Ventas" value={String(completadas.length)} />
        <Tarjeta label="Ticket prom." value={formatCLP(ticket)} />
      </div>

      {(porVencer ?? []).length > 0 && (
        <section className="tarjeta p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-semibold text-sm">Vencimientos</h2>
            <span className="text-xs text-[var(--color-aviso)] num">
              {formatCLP(enRiesgo)} en riesgo
            </span>
          </div>
          <ul className="divide-y divide-[var(--borde)] text-sm">
            {(porVencer ?? []).map((l) => (
              <li key={l.lot_id as string} className="py-2 flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">
                    {l.expiry_status === 'vencido' ? '🔴' : '🟡'} {l.product_name}
                  </span>
                  <span className="text-xs text-[var(--texto-suave)]">
                    {l.expiry_status === 'vencido'
                      ? `venció hace ${Math.abs(Number(l.days_to_expiry))} días`
                      : `vence en ${l.days_to_expiry} días`}
                    {' · '}{l.quantity} u
                  </span>
                </span>
                <span className="num whitespace-nowrap">{formatCLP(Number(l.value_at_risk ?? 0))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(bajoStock ?? []).length > 0 && (
        <section className="tarjeta p-4">
          <h2 className="font-semibold text-sm mb-2">Bajo stock mínimo</h2>
          <ul className="divide-y divide-[var(--borde)] text-sm">
            {(bajoStock ?? []).map((p) => (
              <li key={p.product_id as string} className="py-2 flex justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="num whitespace-nowrap text-[var(--color-aviso)]">
                  {p.quantity} / {p.min_stock}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href="/pos"
        className="tap flex items-center justify-center w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold"
      >
        Ir a vender
      </Link>
    </div>
  );
}

function Tarjeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="tarjeta px-3 py-3">
      <p className="num text-base font-bold truncate">{value}</p>
      <p className="text-[11px] text-[var(--texto-suave)] mt-0.5">{label}</p>
    </div>
  );
}
