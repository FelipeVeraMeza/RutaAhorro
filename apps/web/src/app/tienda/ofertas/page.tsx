import type { Metadata } from 'next';
import { destacadosDelDia, diaLocal, filtrarCatalogo, ORDENES_TIENDA, type OrdenTienda } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { Buscador, Resultados, TiendaCerrada, conParametros } from '@/components/tienda/Catalogo';

export async function generateMetadata(): Promise<Metadata> {
  const { base } = await import('@/lib/tienda/sitio').then((m) => m.sitioTienda());
  return { title: 'Ofertas', description: 'Precios por cantidad y promociones de hoy.', alternates: { canonical: `${base}/ofertas` } };
}
export const dynamic = 'force-dynamic';

type Params = Promise<{ q?: string; orden?: string; pagina?: string }>;

/** Ofertas: lo que hoy tiene precio por cantidad o promoción. */
export default async function OfertasPage({ searchParams }: { searchParams: Params }) {
  const tienda = await datosTienda();
  if (!tienda) return <TiendaCerrada />;

  const { q = '', orden: ordenPedido, pagina } = await searchParams;
  // RF-T82 · En Ofertas, por omisión lo que más rebaja va primero.
  const orden = ORDENES_TIENDA.some((o) => o.valor === ordenPedido) ? (ordenPedido as OrdenTienda) : 'mayor-descuento';
  const r = filtrarCatalogo(tienda.catalogo, { busqueda: q, soloOfertas: true, orden, pagina: Number(pagina) });
  const sugeridos = r.total === 0 ? destacadosDelDia(tienda.catalogo, diaLocal(new Date(), 'America/Santiago'), 4) : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-acento-50 border border-acento-100 p-4 md:p-5">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-marca-900">Ofertas</h1>
        <p className="text-[var(--texto)]">
          Precios por cantidad y promociones de hoy. <strong>Se aplican solas en el carrito</strong> cuando llevas la cantidad.
        </p>
      </div>
      <Buscador accion="/tienda/ofertas" q={q} ocultos={{ orden }} />
      <Resultados r={r} q={q} vacio="No hay ofertas por ahora." sugeridos={sugeridos}
        orden={{ ruta: '/tienda/ofertas', actual: orden, ocultos: q ? [['q', q]] : [] }}
        enlace={(n) => conParametros('/tienda/ofertas', { q, orden, pagina: n })} />
    </div>
  );
}
