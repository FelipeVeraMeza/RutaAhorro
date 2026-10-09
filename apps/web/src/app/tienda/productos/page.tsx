import type { Metadata } from 'next';
import { datosTienda } from '@/lib/tienda/catalogo';
import { Buscador, TiendaCerrada } from '@/components/tienda/Catalogo';
import { VistaCatalogo, leerFiltros, type ParamsCatalogo } from '@/components/tienda/VistaCatalogo';

export const dynamic = 'force-dynamic';

type Params = Promise<ParamsCatalogo>;

export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const f = leerFiltros(await searchParams);
  return { title: f.q ? `Buscar "${f.q}"` : f.categoria || 'Productos' };
}

/** Productos: el catálogo completo con su barra de filtros, sin la portada. */
export default async function ProductosPage({ searchParams }: { searchParams: Params }) {
  const tienda = await datosTienda();
  if (!tienda) return <TiendaCerrada />;
  const f = leerFiltros(await searchParams);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-10">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-marca-900 lg:w-[30%] shrink-0">
          {f.categoria || 'Productos'}
        </h1>
        <div className="flex-1 min-w-0">
          <Buscador accion="/tienda/productos" q={f.q} ocultos={{ categoria: f.categoria, orden: f.orden }} />
        </div>
      </div>
      <VistaCatalogo catalogo={tienda.catalogo} ruta="/tienda/productos" f={f} />
    </div>
  );
}
