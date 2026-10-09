import Link from 'next/link';
import { categoriasDelCatalogo, destacadosDelDia, diaLocal, filtrarCatalogo } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { Buscador, Categorias, Grilla, TiendaCerrada } from '@/components/tienda/Catalogo';

// Sin esto, el build la dejaba estática: sin TIENDA_TENANT_ID al compilar,
// quedaba congelada en "todavía no está abierta". Los datos igual tienen su
// caché de 60 s (lib/tienda/catalogo.ts).
export const dynamic = 'force-dynamic';

/** Las tres líneas de velocidad del logo, al lado de "mejor precio". */
function Velocidad() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="inline-block w-[0.7em] h-[0.7em] ml-2 align-middle" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M4 5 20 2M2 12h20M4 19l16 3" />
    </svg>
  );
}

function Seccion({ titulo, href, enlace, children }: { titulo: string; href: string; enlace: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">{titulo}</h2>
        <Link href={href} className="font-semibold text-marca-700 hover:underline shrink-0">{enlace} →</Link>
      </div>
      {children}
    </section>
  );
}

/** Inicio: la portada. Lo que hay en oferta hoy y una muestra del catálogo. */
export default async function InicioPage() {
  const tienda = await datosTienda();
  if (!tienda) return <TiendaCerrada />;

  const dia = diaLocal(new Date(), 'America/Santiago');
  const ofertas = filtrarCatalogo(tienda.catalogo, { soloOfertas: true }).productos.filter((p) => p.disponible).slice(0, 8);
  const destacados = destacadosDelDia(tienda.catalogo, dia, 8);

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div className="flex flex-col gap-5">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.1] text-marca-900">
          Encuentra lo que necesitas<br />
          al <span className="text-acento-500">mejor precio</span><Velocidad />
        </h1>
        <Buscador accion="/tienda/productos" />
        <Categorias categorias={categoriasDelCatalogo(tienda.catalogo)} />
      </div>

      {ofertas.length > 0 && (
        <Seccion titulo="Ofertas de hoy" href="/tienda/ofertas" enlace="Ver todas">
          <Grilla productos={ofertas} />
        </Seccion>
      )}

      <Seccion titulo="Te puede interesar" href="/tienda/productos" enlace="Ver todos">
        <Grilla productos={destacados} />
      </Seccion>

      <Link href="/tienda/productos" className="btn btn-primario btn-grande self-center px-8">
        Ver los {tienda.catalogo.length.toLocaleString('es-CL')} productos
      </Link>
    </div>
  );
}
