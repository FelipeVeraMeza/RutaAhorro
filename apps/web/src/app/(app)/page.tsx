import Link from 'next/link';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { formatCLP, textoVencimiento, cantidadConUnidad } from '@rutaahorro/core';
import { DEMO_ACTIVO } from '@/lib/demo';
import { DEMO_BAJO_STOCK, DEMO_LOTES } from '@/lib/demo/data';
import { diaLocal } from '@rutaahorro/core';
import { desdeSettings } from '@/lib/datos/configuracionBase';
import { VentasHoyDemo } from './VentasHoyDemo';

export const metadata = { title: 'Resumen' };

interface FilaBajoStock {
  product_id: string;
  name: string;
  quantity: number;
  min_stock: number;
  unit?: string | null;
}

interface FilaVencimiento {
  lot_id: string;
  product_name: string;
  quantity: number;
  value_at_risk: number;
  expiry_status: string;
  days_to_expiry: number;
  unit?: string | null;
}

/** Cuántas filas se muestran en cada panel antes de decir "y N más". */
const TOPE_PANEL = 8;

export default async function DashboardPage() {
  const user = await getCurrentUser();

  let total = 0;
  let cantidadVentas = 0;
  let ticket = 0;
  let bajoStock: FilaBajoStock[] = [];
  let porVencer: FilaVencimiento[] = [];
  let masBajoStock = 0;
  let masPorVencer = 0;
  // Los tres errores se ignoraban en silencio, y el panel mostraba ceros. Un
  // problema de red se veía exactamente igual que un día sin ventas: el dueño
  // leía "Vendido hoy $0" y creía que no se había vendido nada.
  const fallaron: string[] = [];

  if (DEMO_ACTIVO) {
    const todosBajos = DEMO_BAJO_STOCK;
    const todosPorVencer = DEMO_LOTES
      .filter((l) => l.expiry_status !== 'vigente')
      .sort((a, b) => a.days_to_expiry - b.days_to_expiry);
    bajoStock = todosBajos.slice(0, TOPE_PANEL);
    porVencer = todosPorVencer.slice(0, TOPE_PANEL);
    masBajoStock = todosBajos.length - bajoStock.length;
    masPorVencer = todosPorVencer.length - porVencer.length;
  } else {
    const client = await createClient();
    // El día del local, con la zona de su configuración: la misma con que
    // v_sales_daily agrupa desde 0013. Si no se pudiera leer, se usa la de
    // omisión y la vista hace lo mismo, así que los dos lados coinciden.
    const { data: local } = await client.from('tenants').select('settings').eq('id', user!.tenantId).maybeSingle();
    const hoy = diaLocal(new Date(), desdeSettings(local?.settings).zonaHoraria);

    // Antes esta
    // pantalla armaba el rango a mano con el desfase -03:00 escrito fijo, y
    // Chile está en -04:00 medio año: en invierno el "día de hoy" empezaba a
    // las 23:00 de ayer y terminaba a las 22:59, así que lo vendido después de
    // las 23:00 aparecía al día siguiente. Además traía todas las ventas del
    // día para sumarlas acá, anuladas incluidas.
    const { data: dia, error: eVentas } = await client
      .from('v_sales_daily')
      .select('sales_count, total_amount, average_ticket')
      .eq('sale_date', hoy)
      .maybeSingle();
    if (eVentas) fallaron.push('las ventas del día');
    total = Number(dia?.total_amount ?? 0);
    cantidadVentas = Number(dia?.sales_count ?? 0);
    ticket = Number(dia?.average_ticket ?? 0);

    // Ordenado por lo que más falta. Sin `order by`, PostgreSQL devuelve las
    // ocho filas que quiera: el dueño veía ocho productos bajo mínimo que no
    // eran los ocho más urgentes, y cambiaban de una recarga a otra.
    const { data: low, error: eLow, count: totalLow } = await client
      .from('v_low_stock')
      .select('product_id, name, quantity, min_stock, unit', { count: 'exact' })
      .order('shortfall', { ascending: false })
      .limit(TOPE_PANEL);
    if (eLow) fallaron.push('los productos bajo mínimo');
    bajoStock = (low ?? []) as unknown as FilaBajoStock[];
    masBajoStock = Math.max(0, (totalLow ?? bajoStock.length) - bajoStock.length);

    const { data: exp, error: eExp, count: totalExp } = await client
      .from('v_expiring_lots')
      .select(
        'lot_id, product_name, quantity, value_at_risk, expiry_status, days_to_expiry, unit',
        { count: 'exact' },
      )
      .in('expiry_status', ['vencido', 'por_vencer'])
      .order('days_to_expiry', { ascending: true })
      .limit(TOPE_PANEL);
    if (eExp) fallaron.push('los vencimientos');
    porVencer = (exp ?? []) as unknown as FilaVencimiento[];
    masPorVencer = Math.max(0, (totalExp ?? porVencer.length) - porVencer.length);
  }

  const enRiesgo = porVencer.reduce((s, l) => s + Number(l.value_at_risk ?? 0), 0);
  const primerNombre = user!.fullName.split(' ')[0] || 'bienvenido';

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Hola, {primerNombre}</h1>
        <p className="text-sm text-[var(--texto-suave)]">Así va el día</p>
      </div>

      {fallaron.length > 0 && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
          No pudimos cargar {fallaron.join(' ni ')}. Lo que ves abajo puede estar
          incompleto. Revisa tu conexión y vuelve a entrar.
        </p>
      )}

      {/* En la maqueta las ventas viven en el navegador y el servidor no las ve */}
      {DEMO_ACTIVO ? <VentasHoyDemo /> : (
        <div className="grid grid-cols-3 gap-2">
          <Tarjeta label="Vendido hoy" value={formatCLP(total)} />
          <Tarjeta label="Ventas" value={String(cantidadVentas)} />
          <Tarjeta label="Ticket prom." value={formatCLP(ticket)} />
        </div>
      )}

      {porVencer.length > 0 && (
        <section className="tarjeta p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-semibold text-sm">Vencimientos</h2>
            <span className="text-xs text-[var(--color-aviso)] num">
              {formatCLP(enRiesgo)} en riesgo
            </span>
          </div>
          <ul className="divide-y divide-[var(--borde)] text-sm">
            {porVencer.map((l) => (
              <li key={l.lot_id} className="py-2 flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">
                    {l.expiry_status === 'vencido' ? '🔴' : '🟡'} {l.product_name}
                  </span>
                  <span className="text-xs text-[var(--texto-suave)]">
                    {textoVencimiento(Number(l.days_to_expiry))}
                    {' · '}{cantidadConUnidad(Number(l.quantity), l.unit)}
                  </span>
                </span>
                <span className="num whitespace-nowrap">
                  {formatCLP(Number(l.value_at_risk ?? 0))}
                </span>
              </li>
            ))}
          </ul>
          {masPorVencer > 0 && (
            <p className="text-xs text-[var(--texto-suave)] mt-2">
              Y {masPorVencer} {masPorVencer === 1 ? 'lote más' : 'lotes más'}.{' '}
              <Link href="/inventario" className="underline">Ver todos</Link>
            </p>
          )}
        </section>
      )}

      {bajoStock.length > 0 && (
        <section className="tarjeta p-4">
          <h2 className="font-semibold text-sm mb-2">Bajo stock mínimo</h2>
          <ul className="divide-y divide-[var(--borde)] text-sm">
            {bajoStock.map((p) => (
              <li key={p.product_id} className="py-2 flex justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="num whitespace-nowrap text-[var(--color-aviso)]">
                  {cantidadConUnidad(Number(p.quantity), p.unit)}
                  {' / '}{p.min_stock}
                </span>
              </li>
            ))}
          </ul>
          {masBajoStock > 0 && (
            <p className="text-xs text-[var(--texto-suave)] mt-2">
              Y {masBajoStock} {masBajoStock === 1 ? 'producto más' : 'productos más'}.{' '}
              <Link href="/inventario" className="underline">Ver todos</Link>
            </p>
          )}
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
