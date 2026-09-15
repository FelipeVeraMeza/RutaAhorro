import { createClient } from '@/lib/supabase/server';
import { formatCLP } from '@rutaahorro/core';

export const metadata = { title: 'Inventario' };

export default async function InventarioPage() {
  const client = await createClient();

  const { data: valorizado } = await client
    .from('v_inventory_valued')
    .select('product_id, name, quantity, avg_cost, cost_value, category_name')
    .order('cost_value', { ascending: false })
    .limit(50);

  const totalValor = (valorizado ?? []).reduce((s, p) => s + Number(p.cost_value ?? 0), 0);

  const { data: lotes } = await client
    .from('v_expiring_lots')
    .select('lot_id, product_name, lot_code, expiry_date, quantity, value_at_risk, expiry_status, days_to_expiry')
    .order('days_to_expiry', { ascending: true })
    .limit(30);

  return (
    <div className="px-4 py-5 space-y-4">
      <h1 className="text-lg font-semibold">Inventario</h1>

      <div className="tarjeta p-4">
        <p className="text-xs text-[var(--texto-suave)]">Valor del inventario al costo</p>
        <p className="num text-2xl font-bold">{formatCLP(totalValor)}</p>
      </div>

      {(lotes ?? []).length > 0 && (
        <section className="tarjeta p-4">
          <h2 className="font-semibold text-sm mb-2">Lotes por vencimiento</h2>
          <ul className="divide-y divide-[var(--borde)] text-sm">
            {(lotes ?? []).map((l) => (
              <li key={l.lot_id as string} className="py-2">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {l.expiry_status === 'vencido' ? '🔴' : l.expiry_status === 'por_vencer' ? '🟡' : '🟢'}{' '}
                    {l.product_name}
                  </span>
                  <span className="num whitespace-nowrap">{l.quantity} u</span>
                </div>
                <p className="text-xs text-[var(--texto-suave)] num">
                  vence {l.expiry_date}
                  {l.lot_code ? ` · lote ${l.lot_code}` : ''}
                  {' · '}{formatCLP(Number(l.value_at_risk ?? 0))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tarjeta p-4">
        <h2 className="font-semibold text-sm mb-2">Mayor capital inmovilizado</h2>
        <ul className="divide-y divide-[var(--borde)] text-sm">
          {(valorizado ?? []).map((p) => (
            <li key={p.product_id as string} className="py-2 flex justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate">{p.name}</span>
                <span className="text-xs text-[var(--texto-suave)] num">
                  {p.quantity} u × {formatCLP(Number(p.avg_cost ?? 0))}
                </span>
              </span>
              <span className="num whitespace-nowrap font-medium">
                {formatCLP(Number(p.cost_value ?? 0))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
