import type { Metadata } from 'next';
import { categoriasDelCatalogo, destacadosDelDia, diaLocal, filtrarCatalogo, ORDENES_TIENDA, type OrdenTienda } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { Buscador, Categorias, Resultados, TiendaCerrada, conParametros } from '@/components/tienda/Catalogo';

export const dynamic = 'force-dynamic';

type Params = Promise<{ q?: string; categoria?: string; orden?: string; pagina?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const { q, categoria } = await searchParams;
  return { title: q ? `Buscar "${q}"` : categoria || 'Productos' };
}

/** Productos: el catálogo completo, con búsqueda, categorías, orden y páginas. */
export default async function ProductosPage({ searchParams }: { searchParams: Params }) {
  const tienda = await datosTienda();
  if (!tienda) return <TiendaCerrada />;

  const { q = '', categoria = '', orden: ordenPedido, pagina } = await searchParams;
  const orden = ORDENES_TIENDA.some((o) => o.valor === ordenPedido) ? (ordenPedido as OrdenTienda) : undefined;
  const r = filtrarCatalogo(tienda.catalogo, { busqueda: q, categoria, orden, pagina: Number(pagina) });
  const sugeridos = r.total === 0 ? destacadosDelDia(tienda.catalogo, diaLocal(new Date(), 'America/Santiago'), 4) : [];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-marca-900">{categoria || 'Productos'}</h1>
      <Buscador accion="/tienda/productos" q={q} ocultos={{ categoria, orden }} />
      <Categorias categorias={categoriasDelCatalogo(tienda.catalogo)} activa={categoria} conTodo />
      <Resultados r={r} q={q} vacio="No hay productos para mostrar." conOrden sugeridos={sugeridos}
        enlace={(n) => conParametros('/tienda/productos', { q, categoria, orden, pagina: n })} />
    </div>
  );
}
