import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { formatCLP, marginPct } from '@rutaahorro/core';

export const metadata = { title: 'Productos' };

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await getCurrentUser();
  const client = await createClient();
  const verCostos = user!.role === 'admin';

  // El vendedor no debe ver costos NI a través de la red: se consulta la
  // vista sin esas columnas (docs/06-modelo-datos.md §6.2).
  let query = verCostos
    ? client.from('products').select('id, name, sku, sale_price, avg_cost, unit, is_active, tracks_expiry, min_stock')
    : client.from('products_public').select('id, name, sku, sale_price, unit, is_active, tracks_expiry, min_stock');

  if (q && q.trim()) query = query.ilike('name', `%${q.trim()}%`);

  const { data: productos } = await query.eq('is_active', true).order('name').limit(100);
  const { data: stock } = await client.from('stock_levels').select('product_id, quantity');
  const stockMap = new Map((stock ?? []).map((s) => [s.product_id as string, Number(s.quantity ?? 0)]));

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg font-semibold mb-3">Productos</h1>

      <form className="mb-4">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Buscar producto…"
          className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white"
        />
      </form>

      {(productos ?? []).length === 0 ? (
        <p className="text-center text-sm text-[var(--texto-suave)] py-10">
          {q ? 'No encontramos productos con ese nombre' : 'Aún no hay productos cargados'}
        </p>
      ) : (
        <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
          {(productos ?? []).map((p) => {
            const cantidad = stockMap.get(p.id as string) ?? 0;
            const bajo = cantidad <= Number(p.min_stock ?? 0) && Number(p.min_stock ?? 0) > 0;
            return (
              <li key={p.id as string} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-[var(--texto-suave)]">
                      {p.sku ?? 'sin SKU'}
                      {p.tracks_expiry ? ' · perecible' : ''}
                    </p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="num font-semibold">{formatCLP(Number(p.sale_price ?? 0))}</p>
                    {verCostos && 'avg_cost' in p && (
                      <p className="text-xs text-[var(--texto-suave)] num">
                        costo {formatCLP(Number(p.avg_cost ?? 0))} ·{' '}
                        {marginPct(Number(p.sale_price ?? 0), Number(p.avg_cost ?? 0))}%
                      </p>
                    )}
                  </div>
                </div>
                <p className={`text-xs num mt-1 ${bajo ? 'text-[var(--color-aviso)] font-medium' : 'text-[var(--texto-suave)]'}`}>
                  {bajo && '⚠ '}Stock: {cantidad} {p.unit}
                  {Number(p.min_stock ?? 0) > 0 && ` · mínimo ${p.min_stock}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
