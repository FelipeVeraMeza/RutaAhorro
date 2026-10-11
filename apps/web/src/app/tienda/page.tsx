import type { Metadata } from 'next';
import Link from 'next/link';
import { ofertasDestacadas } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { sitioTienda } from '@/lib/tienda/sitio';
import { Grilla } from '@/components/tienda/Grilla';
import { ProductosGuardados } from '@/components/tienda/ProductosGuardados';
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
export async function generateMetadata({ searchParams }: { searchParams: Promise<ParamsCatalogo> }): Promise<Metadata> {
  const f = leerFiltros(await searchParams);
  const { base } = await sitioTienda();
  // RNF-T62 · La portada filtrada es la misma página para Google: una sola dirección.
  return { alternates: { canonical: base }, ...(f.q ? { robots: { index: false, follow: true } } : {}) };
}

export default async function InicioPage({ searchParams }: { searchParams: Promise<ParamsCatalogo> }) {
  const tienda = await datosTienda();
  if (!tienda) return <TiendaCerrada />;
  const f = leerFiltros(await searchParams);
  const sinFiltros = !f.q && !f.categoria && f.min == null && f.max == null && !f.marcas.length && !f.disponibles && !f.ofertas && f.pagina === 1;
  // RF-T68 · Las ofertas que más rebajan, arriba, cuando se llega sin buscar nada.
  const ofertas = sinFiltros ? ofertasDestacadas(tienda.catalogo, 4) : [];
  const { base } = await sitioTienda();
  // RNF-T63 · El buscador de la tienda, para que Google lo ofrezca en el resultado.
  const sitio = {
    '@context': 'https://schema.org', '@type': 'WebSite', name: tienda.nombre, url: base,
    potentialAction: { '@type': 'SearchAction', target: `${base}/productos?q={q}`, 'query-input': 'required name=q' },
  };

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
      {ofertas.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="t-ofertas-hoy">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="t-ofertas-hoy" className="text-xl md:text-2xl font-extrabold tracking-tight">Ofertas de hoy</h2>
            <Link href="/tienda/ofertas" className="font-semibold text-marca-700 hover:underline shrink-0">Ver todas →</Link>
          </div>
          <Grilla productos={ofertas} prioridad={4} />
        </section>
      )}
      {sinFiltros && <ProductosGuardados cual="vistos" titulo="Vistos hace poco" />}
      <VistaCatalogo catalogo={tienda.catalogo} ruta="/tienda" f={f} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(sitio).replace(/</g, '\\u003c') }} />
    </div>
  );
}
