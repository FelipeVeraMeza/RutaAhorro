import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { formatCLP, marginPct } from '@rutaahorro/core';
import { DEMO_ACTIVO } from '@/lib/demo';
import { DEMO_PRODUCTOS } from '@/lib/demo/data';

export const metadata = { title: 'Productos' };

interface FilaProducto {
  id: string;
  name: string;
  sku: string | null;
  sale_price: number;
  avg_cost?: number;
  unit: string;
  tracks_expiry: boolean;
  min_stock: number;
}

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await getCurrentUser();

  // Solo el administrador ve costos y márgenes (matriz de permisos, doc 02).
  const verCostos = user!.role === 'admin';

  let productos: FilaProducto[] = [];
  const stockMap = new Map<string, number>();

  if (DEMO_ACTIVO) {
    const filtro = (q ?? '').trim().toLowerCase();
    productos = DEMO_PRODUCTOS
      .filter((p) => !filtro || p.name.toLowerCase().includes(filtro))
      .map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        sale_price: p.sale_price,
        unit: p.unit,
        tracks_expiry: p.tracks_expiry,
        min_stock: p.min_stock,
        // El costo se omite si el rol no puede verlo: en demo se replica la
        // misma regla que en producción aplica RLS sobre la vista sin costos.
        ...(verCostos ? { avg_cost: p.avg_cost } : {}),
      }));
    DEMO_PRODUCTOS.forEach((p) => stockMap.set(p.id, p.stock));
  } else {
    const client = await createClient();

    // El vendedor no debe ver costos NI a través de la red: se consulta la
    // vista sin esas columnas (docs/06-modelo-datos.md §6.2).
    let query = verCostos
      ? client.from('products').select('id, name, sku, sale_price, avg_cost, unit, tracks_expiry, min_stock, is_active')
      : client.from('products_public').select('id, name, sku, sale_price, unit, tracks_expiry, min_stock, is_active');

    if (q && q.trim()) query = query.ilike('name', `%${q.trim()}%`);

    const { data } = await query.eq('is_active', true).order('name').limit(100);
    productos = (data ?? []) as unknown as FilaProducto[];

    const { data: stock } = await client.from('stock_levels').select('product_id, quantity');
    (stock ?? []).forEach((s) =>
      stockMap.set(s.product_id as string, Number(s.quantity ?? 0)),
    );
  }

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

      {productos.length === 0 ? (
        <p className="text-center text-sm text-[var(--texto-suave)] py-10">
          {q ? 'No encontramos productos con ese nombre' : 'Aún no hay productos cargados'}
        </p>
      ) : (
        <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
          {productos.map((p) => {
            const cantidad = stockMap.get(p.id) ?? 0;
            const bajo = p.min_stock > 0 && cantidad <= p.min_stock;
            return (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-[var(--texto-suave)]">
                      {p.sku ?? 'sin SKU'}
                      {p.tracks_expiry && ' · perecible'}
                    </p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="num font-semibold">{formatCLP(p.sale_price)}</p>
                    {verCostos && typeof p.avg_cost === 'number' && (
                      <p className="text-xs text-[var(--texto-suave)] num">
                        costo {formatCLP(p.avg_cost)} · {marginPct(p.sale_price, p.avg_cost)}%
                      </p>
                    )}
                  </div>
                </div>
                <p
                  className={`text-xs num mt-1 ${
                    bajo ? 'text-[var(--color-aviso)] font-medium' : 'text-[var(--texto-suave)]'
                  }`}
                >
                  {bajo && '⚠ '}Stock: {cantidad} {p.unit}
                  {p.min_stock > 0 && ` · mínimo ${p.min_stock}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {!verCostos && productos.length > 0 && (
        <p className="text-[11px] text-[var(--texto-suave)] text-center mt-4">
          Tu rol no tiene acceso a costos ni márgenes.
        </p>
      )}
    </div>
  );
}
