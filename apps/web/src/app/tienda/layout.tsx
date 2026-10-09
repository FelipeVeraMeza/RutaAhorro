import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoMarca } from '@/components/Logo';
import { BotonCarrito } from '@/components/tienda/BotonCarrito';
import { PestanasAbajo, PestanasArriba } from '@/components/tienda/NavTienda';
import { datosTienda } from '@/lib/tienda/catalogo';

/**
 * La tienda online (docs/30): pública, sin sesión, sin el menú del sistema.
 *
 * Vive en la misma aplicación que el POS para leer los mismos productos,
 * precios y stock, pero el middleware la deja pasar sin sesión y, en el
 * dominio de la tienda (`NEXT_PUBLIC_TIENDA_HOST`), no deja llegar a nada más.
 *
 * Pestañas: Inicio · Productos · Ofertas · Mi cuenta, y el carrito.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tienda = await datosTienda().catch(() => null);
  const nombre = tienda?.nombre ?? 'Tienda';
  return {
    title: { default: nombre, template: `%s · ${nombre}` },
    description: `Productos y precios de ${nombre}`,
  };
}

export default async function TiendaLayout({ children }: { children: React.ReactNode }) {
  const tienda = await datosTienda().catch(() => null);
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-marca-900 text-white sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-16 md:h-[72px] flex items-center gap-4">
          <Link href="/tienda" className="flex items-center gap-2 min-w-0 tap">
            <LogoMarca tamano={40} />
            <span className="font-extrabold text-xl md:text-2xl tracking-tight truncate">{tienda?.nombre ?? 'Tienda'}</span>
          </Link>
          <div className="flex-1 h-full flex justify-center"><PestanasArriba /></div>
          <BotonCarrito />
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">{children}</main>

      {/* pb-20 en el celular: la barra de pestañas de abajo no tapa el pie. */}
      <footer className="border-t border-[var(--borde)] bg-[var(--superficie)] pb-20 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 py-5 text-sm text-[var(--texto-suave)] flex flex-col gap-1">
          <p className="font-semibold text-[var(--texto)]">{tienda?.nombre ?? 'Tienda'}</p>
          {tienda?.direccion && <p>{tienda.direccion}</p>}
          {tienda?.telefono && <p>Teléfono: {tienda.telefono}</p>}
          <p>Precios con IVA incluido. Pueden cambiar sin aviso y rigen los del local.</p>
        </div>
      </footer>

      <PestanasAbajo />
    </div>
  );
}
