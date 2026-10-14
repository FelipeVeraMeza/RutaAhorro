import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoMarca } from '@/components/Logo';
import { BotonCarrito } from '@/components/tienda/BotonCarrito';
import { PestanasAbajo, PestanasArriba } from '@/components/tienda/NavTienda';
import { IndicadorCarga } from '@/components/tienda/IndicadorCarga';
import { Suspense } from 'react';
import { enlaceMapa, enlaceWhatsApp, estadoAtencion, resumenHorario } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { Icono } from '@/components/Icono';

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
    description: `Productos y precios de ${nombre}${tienda?.direccion ? `, ${tienda.direccion}` : ''}. Revisa ofertas y haz tu pedido para retirar en el local.`,
    applicationName: nombre,
    openGraph: { siteName: nombre, locale: 'es_CL', type: 'website' },
    formatDetection: { telephone: false },
  };
}

export default async function TiendaLayout({ children }: { children: React.ReactNode }) {
  const tienda = await datosTienda().catch(() => null);
  const atencion = tienda ? estadoAtencion(tienda.horario, new Date(), tienda.zona) : null;
  const horario = resumenHorario(tienda?.horario);
  const mapa = enlaceMapa(tienda?.direccion);
  const whatsapp = enlaceWhatsApp(tienda?.telefono, `Hola, tengo una consulta para ${tienda?.nombre ?? 'el local'}.`);
  return (
    <div className="min-h-dvh flex flex-col">
      {/* RNF-T64 · Con teclado o lector de pantalla, saltar el menú. */}
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-primario">Saltar al contenido</a>
      <Suspense><IndicadorCarga /></Suspense>
      {tienda?.mensaje && (
        <p role="note" className="bg-acento-500 text-marca-900 text-sm font-semibold text-center px-4 py-2">{tienda.mensaje}</p>
      )}
      <header className="bg-marca-900 text-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 md:h-[72px] flex items-center gap-4">
          <Link href="/tienda" className="flex items-center gap-2 min-w-0 tap">
            <LogoMarca tamano={40} />
            <span className="font-extrabold text-xl md:text-2xl tracking-tight truncate">{tienda?.nombre ?? 'Tienda'}</span>
          </Link>
          <div className="flex-1 h-full flex justify-center"><PestanasArriba /></div>
          <BotonCarrito />
        </div>
      </header>

      {atencion && (
        <div className="bg-[var(--superficie)] border-b border-[var(--borde)]">
          <p className="max-w-7xl mx-auto px-4 py-1.5 text-sm flex items-center gap-2">
            <span aria-hidden className={`size-2.5 rounded-full ${atencion.abierto ? 'bg-exito' : 'bg-[var(--texto-suave)]'}`} />
            <span className={atencion.abierto ? 'font-semibold text-exito' : 'text-[var(--texto-suave)]'}>{atencion.texto}</span>
            <Link href="/tienda/contacto" className="ml-auto text-marca-700 font-semibold hover:underline">Horario y dirección</Link>
          </p>
        </div>
      )}

      <main id="contenido" tabIndex={-1} className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 focus:outline-none">{children}</main>

      {/* pb-20 en el celular: la barra de pestañas de abajo no tapa el pie. */}
      <footer className="border-t border-[var(--borde)] bg-[var(--superficie)] pb-20 md:pb-0">
        <div className="max-w-7xl mx-auto px-4 py-5 text-sm text-[var(--texto-suave)] grid gap-5 md:grid-cols-3">
          <div className="flex flex-col gap-1">
          <p className="font-semibold text-[var(--texto)]">{tienda?.nombre ?? 'Tienda'}</p>
          {tienda?.direccion && (
            <p className="flex items-start gap-1.5"><Icono nombre="ubicacion" tamano={16} className="mt-0.5" />
              {mapa ? <a href={mapa} target="_blank" rel="noopener noreferrer" className="underline">{tienda.direccion}</a> : tienda.direccion}</p>
          )}
          {tienda?.telefono && (
            <p className="flex items-center gap-1.5"><Icono nombre="telefono" tamano={16} />
              {whatsapp ? <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="underline">WhatsApp {tienda.telefono}</a> : `Teléfono: ${tienda.telefono}`}</p>
          )}
          </div>
          {horario.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-[var(--texto)]">Horario</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {horario.map((h) => <div key={h.dias} className="contents"><dt>{h.dias}</dt><dd className="num">{h.horas}</dd></div>)}
              </dl>
            </div>
          )}
          <div className="flex flex-col gap-1">
          <p className="font-semibold text-[var(--texto)]">Ayuda</p>
          <nav aria-label="Pie de página" className="flex flex-col">
            <Link href="/tienda/ayuda" className="underline min-h-8 flex items-center">Cómo comprar</Link>
            <Link href="/tienda/categorias" className="underline min-h-8 flex items-center">Todas las categorías</Link>
            <Link href="/tienda/contacto" className="underline min-h-8 flex items-center">Contacto y horario</Link>
            <Link href="/tienda/privacidad" className="underline min-h-8 flex items-center">Privacidad y datos personales</Link>
          </nav>
          <p>Precios con IVA incluido. Pueden cambiar sin aviso y rigen los del local.</p>
          {tienda?.fotosDeOpenFoodFacts && (
            <p className="text-xs">
              Algunas fotos de productos son de{' '}
              <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer" className="underline">Open Food Facts</a>
              {' '}(<a href="https://creativecommons.org/licenses/by-sa/3.0/deed.es" target="_blank" rel="noopener noreferrer" className="underline">CC BY-SA</a>).
            </p>
          )}
          </div>
        </div>
      </footer>

      <PestanasAbajo />
    </div>
  );
}
