import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { exigirRol } from '@/lib/permisos';
import { formatCLP, textoVencimiento, cantidadConUnidad } from '@rutaahorro/core';
import { DEMO_ACTIVO } from '@/lib/demo';
import { DEMO_BAJO_STOCK, DEMO_LOTES } from '@/lib/demo/data';
import { diaLocal } from '@rutaahorro/core';
import { desdeSettings } from '@/lib/datos/configuracionBase';
import { VentasHoyDemo } from './VentasHoyDemo';
import { Tendencia } from '@/components/Tendencia';
import { PanelControl } from '@/components/PanelControl';
import { Icono, type NombreIcono } from '@/components/Icono';
import { enlaceResumenDia } from '@/lib/resumenDia';

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
  // El resumen del negocio es del dueño y del supervisor. El vendedor va a
  // vender y bodega a su inventario (inicioPara).
  const user = await exigirRol(['admin', 'supervisor']);

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
  // Primeros pasos (RNF-18): mientras el local se está armando, qué falta y
  // dónde se hace. Desaparece cuando todo está hecho.
  let pasos: Array<{ hecho: boolean; texto: string; href: string }> = [];

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
    // Bajo mínimo y vencimientos no dependen del día: salen en paralelo con
    // la configuración, y las ventas del día apenas se sabe qué día es.
    const pBajos = client
      .from('v_low_stock')
      .select('product_id, name, quantity, min_stock, unit', { count: 'exact' })
      .order('shortfall', { ascending: false })
      .limit(TOPE_PANEL);
    const pVence = client
      .from('v_expiring_lots')
      .select(
        'lot_id, product_name, quantity, value_at_risk, expiry_status, days_to_expiry, unit',
        { count: 'exact' },
      )
      .in('expiry_status', ['vencido', 'por_vencer'])
      .order('days_to_expiry', { ascending: true })
      .limit(TOPE_PANEL);
    const pVentas = (async () => {
      const { data: local } = await client.from('tenants').select('settings').eq('id', user.tenantId).maybeSingle();
      const hoy = diaLocal(new Date(), desdeSettings(local?.settings).zonaHoraria);
      return client
        .from('v_sales_daily')
        .select('sales_count, total_amount, average_ticket')
        .eq('sale_date', hoy)
        .maybeSingle();
    })();
    const cuantos = (tabla: string) => client.from(tabla).select('id', { count: 'exact', head: true })
      .then((r) => r.count ?? 0, () => 0);
    const pPasos = user.role === 'admin'
      ? Promise.all([cuantos('products'), cuantos('profiles'), cuantos('cash_sessions'), cuantos('sales')])
      : Promise.resolve(null);
    const [rVentas, rBajos, rVence, rPasos] = await Promise.all([pVentas, pBajos, pVence, pPasos]);
    if (rPasos) {
      const [nProductos, nPersonas, nCajas, nVentas] = rPasos;
      pasos = [
        { hecho: nProductos > 0, texto: 'Carga tus productos (uno por uno o desde Excel)', href: '/productos' },
        { hecho: nPersonas > 1, texto: 'Crea las cuentas de tu personal', href: '/usuarios' },
        { hecho: nCajas > 0, texto: 'Abre la primera caja', href: '/caja' },
        { hecho: nVentas > 0, texto: 'Haz la primera venta', href: '/pos' },
      ];
      if (pasos.every((x) => x.hecho)) pasos = [];
    }

    // Antes esta
    // pantalla armaba el rango a mano con el desfase -03:00 escrito fijo, y
    // Chile está en -04:00 medio año: en invierno el "día de hoy" empezaba a
    // las 23:00 de ayer y terminaba a las 22:59, así que lo vendido después de
    // las 23:00 aparecía al día siguiente. Además traía todas las ventas del
    // día para sumarlas acá, anuladas incluidas.
    const { data: dia, error: eVentas } = rVentas;
    if (eVentas) fallaron.push('las ventas del día');
    total = Number(dia?.total_amount ?? 0);
    cantidadVentas = Number(dia?.sales_count ?? 0);
    ticket = Number(dia?.average_ticket ?? 0);

    // Ordenado por lo que más falta. Sin `order by`, PostgreSQL devuelve las
    // ocho filas que quiera: el dueño veía ocho productos bajo mínimo que no
    // eran los ocho más urgentes, y cambiaban de una recarga a otra.
    const { data: low, error: eLow, count: totalLow } = rBajos;
    if (eLow) fallaron.push('los productos bajo mínimo');
    bajoStock = (low ?? []) as unknown as FilaBajoStock[];
    masBajoStock = Math.max(0, (totalLow ?? bajoStock.length) - bajoStock.length);

    const { data: exp, error: eExp, count: totalExp } = rVence;
    if (eExp) fallaron.push('los vencimientos');
    porVencer = (exp ?? []) as unknown as FilaVencimiento[];
    masPorVencer = Math.max(0, (totalExp ?? porVencer.length) - porVencer.length);
  }

  const enRiesgo = porVencer.reduce((s, l) => s + Number(l.value_at_risk ?? 0), 0);
  const primerNombre = user.fullName.split(' ')[0] || 'bienvenido';

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h1 className="text-xl font-bold">Hola, {primerNombre}</h1>
        <p className="text-sm text-[var(--texto-suave)]">Así va el día en el local</p>
      </div>

      {pasos.length > 0 && (
        <section className="tarjeta p-4 border-marca-300" aria-labelledby="t-pasos">
          <h2 id="t-pasos" className="font-semibold text-sm">Primeros pasos</h2>
          <p className="text-xs text-[var(--texto-suave)] mb-2">
            {pasos.filter((x) => x.hecho).length} de {pasos.length} listos. Toca uno para hacerlo.
          </p>
          <ol className="space-y-1">
            {pasos.map((x) => (
              <li key={x.href}>
                <Link href={x.href} prefetch={false} className="tap flex items-center gap-3 px-2 rounded-lg hover:bg-[var(--fondo)]">
                  <span className={`grid place-items-center w-6 h-6 rounded-full border ${x.hecho ? 'bg-marca-500 border-marca-500 text-white' : 'border-[var(--borde)]'}`}>
                    {x.hecho && <Icono nombre="listo" tamano={14} />}
                  </span>
                  <span className={`text-sm ${x.hecho ? 'line-through text-[var(--texto-suave)]' : ''}`}>{x.texto}</span>
                  <span className="sr-only">{x.hecho ? '(hecho)' : '(pendiente)'}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {fallaron.length > 0 && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
          No pudimos cargar {fallaron.join(' ni ')}. Lo que ves abajo puede estar
          incompleto. Revisa tu conexión y vuelve a entrar.
        </p>
      )}

      {/* En la maqueta las ventas viven en el navegador y el servidor no las ve */}
      {DEMO_ACTIVO ? <VentasHoyDemo bajoMinimo={bajoStock.length + masBajoStock} enRiesgo={enRiesgo} /> : (
        <div>
          <div className="grid grid-cols-3 gap-2">
            <Tarjeta label="Vendido hoy" value={formatCLP(total)} />
            <Tarjeta label="Ventas" value={String(cantidadVentas)} />
            <Tarjeta label="Ticket prom." value={formatCLP(ticket)} />
          </div>
          <a href={enlaceResumenDia({ total, ventas: cantidadVentas, ticket, bajoMinimo: bajoStock.length + masBajoStock, enRiesgo })}
             target="_blank" rel="noopener noreferrer"
             className="tap inline-flex items-center gap-1.5 text-sm font-medium text-marca-700 underline mt-1">
            Enviar el resumen de hoy por WhatsApp
          </a>
        </div>
      )}

      <PanelControl usuarioId={user.id} verCostos={user.role === 'admin'} />

      <Tendencia />

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
              <Link href="/inventario" className="underline inline-flex items-center min-h-[44px] px-1 -my-3">Ver todos</Link>
            </p>
          )}
        </section>
      )}

      {bajoStock.length > 0 && (
        <section className="tarjeta p-4">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h2 className="font-semibold text-sm">Bajo stock mínimo</h2>
            <Link href="/proveedores?vista=comprar" prefetch={false} className="tap inline-flex items-center text-xs font-medium text-marca-700 underline -my-3">
              Qué comprar
            </Link>
          </div>
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
              <Link href="/inventario" className="underline inline-flex items-center min-h-[44px] px-1 -my-3">Ver todos</Link>
            </p>
          )}
        </section>
      )}

      <nav aria-label="Accesos rápidos" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {ACCESOS.filter((a) => !a.soloAdmin || user.role === 'admin').map((a) => (
          <Link key={a.href} href={a.href} prefetch={false}
            className={`tap flex flex-col items-start gap-1.5 p-3 rounded-xl border ${a.principal ? 'bg-marca-500 border-marca-500 text-white' : 'tarjeta hover:border-marca-300'}`}>
            <Icono nombre={a.icono} tamano={22} />
            <span className="text-sm font-semibold">{a.texto}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

const ACCESOS: Array<{ href: string; texto: string; icono: NombreIcono; principal?: boolean; soloAdmin?: boolean }> = [
  { href: '/pos', texto: 'Vender', icono: 'vender', principal: true },
  { href: '/proveedores/recepcion', texto: 'Recibir mercadería', icono: 'proveedores' },
  { href: '/ventas', texto: 'Ventas del día', icono: 'ventas' },
  { href: '/reportes', texto: 'Reportes', icono: 'reportes' },
];

function Tarjeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="tarjeta px-3 py-3">
      <p className="num text-base font-bold truncate">{value}</p>
      <p className="text-[11px] text-[var(--texto-suave)] mt-0.5">{label}</p>
    </div>
  );
}
