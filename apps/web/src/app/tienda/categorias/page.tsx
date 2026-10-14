import type { Metadata } from 'next';
import Link from 'next/link';
import { categoriasDelCatalogo } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { sitioTienda } from '@/lib/tienda/sitio';
import { TiendaCerrada } from '@/components/tienda/Catalogo';
import { Icono } from '@/components/Icono';
import { iconoProducto } from '@/lib/tienda/iconos';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { base } = await sitioTienda();
  return { title: 'Categorías', description: 'Todas las categorías de productos de la tienda.', alternates: { canonical: `${base}/categorias` } };
}

/** RF-T79 · Todas las categorías con cuántos productos tiene cada una. */
export default async function CategoriasPage() {
  const tienda = await datosTienda().catch(() => null);
  if (!tienda) return <TiendaCerrada />;
  const cuantos = new Map<string, number>();
  for (const p of tienda.catalogo) if (p.grupo) cuantos.set(p.grupo, (cuantos.get(p.grupo) ?? 0) + 1);
  const sinGrupo = tienda.catalogo.filter((p) => !p.grupo).length;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-marca-900">Categorías</h1>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {categoriasDelCatalogo(tienda.catalogo).map((c) => (
          <li key={c}>
            <Link href={`/tienda/productos?categoria=${encodeURIComponent(c)}`} className="tarjeta flex items-center gap-3 p-3 min-h-16 hover:border-marca-300">
              <span className="grid place-items-center size-12 rounded-xl bg-marca-50 text-marca-700"><Icono nombre={iconoProducto(c, '')} tamano={26} /></span>
              <span className="flex-1 font-semibold">{c}</span>
              <span className="text-sm text-[var(--texto-suave)] num">{cuantos.get(c)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {sinGrupo > 0 && <p className="text-sm text-[var(--texto-suave)]">Y {sinGrupo.toLocaleString('es-CL')} productos más en <Link href="/tienda/productos" className="underline">Todos los productos</Link>.</p>}
    </div>
  );
}
