import { createClient } from '@/lib/supabase/server';
import { formatCLP } from '@rutaahorro/core';
import { DEMO_ACTIVO } from '@/lib/demo';
import { DEMO_INVENTARIO_VALORIZADO, DEMO_LOTES } from '@/lib/demo/data';

export const metadata = { title: 'Inventario' };

interface FilaValorizada {
  product_id: string;
  name: string;
  quantity: number;
  avg_cost: number;
  cost_value: number;
  category_name?: string | null;
}

interface FilaLote {
  lot_id: string;
  product_name: string;
  lot_code: string | null;
  expiry_date: string;
  quantity: number;
  value_at_risk: number;
  expiry_status: string;
  days_to_expiry: number;
}

export default async function InventarioPage() {
  let valorizado: FilaValorizada[] = [];
  let lotes: FilaLote[] = [];

  if (DEMO_ACTIVO) {
    valorizado = DEMO_INVENTARIO_VALORIZADO;
    lotes = [...DEMO_LOTES].sort((a, b) => a.days_to_expiry - b.days_to_expiry);
  } else {
    const client = await createClient();

    const { data: v } = await client
      .from('v_inventory_valued')
      .select('product_id, name, quantity, avg_cost, cost_value, category_name')
      .order('cost_value', { ascending: false })
      .limit(50);
    valorizado = (v ?? []) as unknown as FilaValorizada[];

    const { data: l } = await client
      .from('v_expiring_lots')
      .select('lot_id, product_name, lot_code, expiry_date, quantity, value_at_risk, expiry_status, days_to_expiry')
      .order('days_to_expiry', { ascending: true })
      .limit(30);
    lotes = (l ?? []) as unknown as FilaLote[];
  }

  const totalValor = valorizado.reduce((s, p) => s + Number(p.cost_value ?? 0), 0);
  const enRiesgo = lotes
    .filter((l) => l.expiry_status !== 'vigente')
    .reduce((s, l) => s + Number(l.value_at_risk ?? 0), 0);

  return (
    <div className="px-4 py-5 space-y-4">
      <h1 className="text-lg font-semibold">Inventario</h1>

      <div className="grid grid-cols-2 gap-2">
        <div className="tarjeta p-4">
          <p className="text-[11px] text-[var(--texto-suave)]">Valor al costo</p>
          <p className="num text-xl font-bold">{formatCLP(totalValor)}</p>
        </div>
        <div className="tarjeta p-4">
          <p className="text-[11px] text-[var(--texto-suave)]">En riesgo por vencer</p>
          <p className={`num text-xl font-bold ${enRiesgo > 0 ? 'text-[var(--color-aviso)]' : ''}`}>
            {formatCLP(enRiesgo)}
          </p>
        </div>
      </div>

      {lotes.length > 0 && (
        <section className="tarjeta p-4">
          <h2 className="font-semibold text-sm mb-2">Lotes por vencimiento</h2>
          <p className="text-xs text-[var(--texto-suave)] mb-2">
            Se vende siempre primero el lote que vence antes (FEFO).
          </p>
          <ul className="divide-y divide-[var(--borde)] text-sm">
            {lotes.map((l) => (
              <li key={l.lot_id} className="py-2">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {l.expiry_status === 'vencido' ? '🔴' : l.expiry_status === 'por_vencer' ? '🟡' : '🟢'}{' '}
                    {l.product_name}
                  </span>
                  <span className="num whitespace-nowrap">{l.quantity} u</span>
                </div>
                <p className="text-xs text-[var(--texto-suave)] num">
                  {l.expiry_status === 'vencido'
                    ? `venció hace ${Math.abs(l.days_to_expiry)} d`
                    : `vence en ${l.days_to_expiry} d`}
                  {' · '}{l.expiry_date}
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
          {valorizado.map((p) => (
            <li key={p.product_id} className="py-2 flex justify-between gap-2">
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
