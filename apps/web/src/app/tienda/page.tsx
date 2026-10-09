import { datosTienda } from '@/lib/tienda/catalogo';
import { Buscador, TiendaCerrada } from '@/components/tienda/Catalogo';
import { FranjaCategorias, VistaCatalogo, leerFiltros, type ParamsCatalogo } from '@/components/tienda/VistaCatalogo';

// Sin esto, el build la dejaba estática: sin TIENDA_TENANT_ID al compilar,
// quedaba congelada en "todavía no está abierta". Los datos igual tienen su
// caché de 60 s (lib/tienda/catalogo.ts).
export const dynamic = 'force-dynamic';

/**
 * Inicio, como la maqueta de Felipe (2026-10-09): titular y buscador en una
 * fila, la franja de categorías y el catálogo con su barra de filtros.
 */
export default async function InicioPage({ searchParams }: { searchParams: Promise<ParamsCatalogo> }) {
  const tienda = await datosTienda();
  if (!tienda) return <TiendaCerrada />;
  const f = leerFiltros(await searchParams);

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-10">
        <div className="lg:w-[44%] shrink-0">
          <h1 className="text-3xl md:text-[2.6rem] font-extrabold tracking-tight leading-[1.1] text-marca-900">
            Tus productos favoritos,<br />
            <span className="text-acento-500">al mejor precio</span>
          </h1>
          <p className="mt-2 text-[var(--texto-suave)] md:text-lg">Calidad, variedad y ahorros en un solo lugar.</p>
        </div>
        <div className="flex-1 min-w-0">
          <Buscador accion="/tienda" q={f.q} ocultos={{ categoria: f.categoria }} />
        </div>
      </div>

      <FranjaCategorias catalogo={tienda.catalogo} ruta="/tienda" activa={f.categoria} />
      <VistaCatalogo catalogo={tienda.catalogo} ruta="/tienda" f={f} />
    </div>
  );
}
