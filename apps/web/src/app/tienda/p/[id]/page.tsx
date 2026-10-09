import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { enlaceWhatsApp, formatCLP, precioDelTramo, precioTienda, relacionados } from '@rutaahorro/core';
import { datosTienda } from '@/lib/tienda/catalogo';
import { sitioTienda } from '@/lib/tienda/sitio';
import { FotoProducto } from '@/components/tienda/TarjetaProducto';
import { AgregarAlCarrito } from '@/components/tienda/AgregarAlCarrito';
import { Compartir } from '@/components/tienda/Compartir';
import { Grilla } from '@/components/tienda/Catalogo';

type Params = Promise<{ id: string }>;

async function buscar(id: string) {
  const tienda = await datosTienda();
  const producto = tienda?.catalogo.find((p) => p.id === id);
  return tienda && producto ? { tienda, producto } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const r = await buscar((await params).id).catch(() => null);
  if (!r) return { title: 'Producto no encontrado' };
  const { producto } = r;
  const descripcion = `${producto.nombre}${producto.precio != null ? ` a ${precioTienda(producto.precio)}` : ''}${producto.descripcion ? `. ${producto.descripcion}` : ''}`;
  return {
    title: producto.nombre,
    description: descripcion,
    // Lo que muestra WhatsApp o Facebook al compartir el enlace.
    openGraph: { title: producto.nombre, description: descripcion, ...(producto.imagen ? { images: [producto.imagen] } : {}) },
  };
}

export default async function ProductoPage({ params }: { params: Params }) {
  const r = await buscar((await params).id);
  if (!r) notFound();
  const { tienda, producto } = r;
  const { base } = await sitioTienda();
  const vendible = producto.precio != null && producto.disponible;
  // Para preguntar antes de comprar, o por lo que no tiene precio.
  const whatsapp = enlaceWhatsApp(tienda.telefono, producto.precio != null
    ? `Hola, quiero consultar por: ${producto.nombre} (${precioTienda(producto.precio)})`
    : `Hola, ¿qué precio tiene: ${producto.nombre}?`);
  const parecidos = relacionados(tienda.catalogo, producto, 4);

  // RT-53 · Datos del producto para Google (precio y disponibilidad en el resultado).
  const datosGoogle = producto.precio != null ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: producto.nombre,
    ...(producto.descripcion ? { description: producto.descripcion } : {}),
    ...(producto.imagen ? { image: producto.imagen } : {}),
    offers: {
      '@type': 'Offer',
      url: `${base}/p/${producto.id}`,
      priceCurrency: 'CLP',
      price: producto.precio,
      availability: producto.disponible ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  } : null;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Ruta" className="text-sm flex items-center gap-1.5 flex-wrap text-[var(--texto-suave)]">
        <Link href="/tienda/productos" className="font-semibold text-marca-700 hover:underline tap inline-flex items-center">Productos</Link>
        {producto.grupo && (
          <>
            <span aria-hidden>›</span>
            <Link href={`/tienda/productos?categoria=${encodeURIComponent(producto.grupo)}`}
              className="font-semibold text-marca-700 hover:underline tap inline-flex items-center">{producto.grupo}</Link>
          </>
        )}
      </nav>

      <article className="tarjeta overflow-hidden md:grid md:grid-cols-[minmax(0,400px)_1fr] md:gap-2">
        <div className={`p-4 md:p-5 ${producto.disponible ? '' : 'opacity-50'}`}>
          <div className="rounded-xl overflow-hidden max-w-[200px] md:max-w-none mx-auto"><FotoProducto producto={producto} grande /></div>
        </div>
        <div className="p-4 pt-0 md:p-6 md:pl-2 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight leading-tight">{producto.nombre}</h1>
            <Compartir titulo={producto.nombre} />
          </div>
          {producto.descripcion && <p className="text-[var(--texto-suave)]">{producto.descripcion}</p>}

          {producto.precio != null
            ? <p className="text-4xl font-extrabold num">{precioTienda(producto.precio)}</p>
            : <p className="text-2xl font-bold text-marca-700">{precioTienda(null)}</p>}

          {producto.precio != null && producto.tramos.length > 0 && (
            <div className="rounded-xl bg-acento-50 border border-acento-100 p-3">
              <p className="font-bold text-acento-700 mb-1">Ofertas de hoy</p>
              <ul className="flex flex-col gap-0.5">
                {producto.tramos.map((t, i) => {
                  const unidad = precioDelTramo(t, producto.precio!);
                  if (unidad >= producto.precio!) return null;
                  return (
                    <li key={i} className="num">
                      {t.desde <= 1 ? 'Precio oferta' : `Llevando ${t.desde} o más`}: <strong>{formatCLP(unidad)} c/u</strong>
                      <span className="text-[var(--texto-suave)]"> (ahorras {formatCLP(producto.precio! - unidad)} en cada uno)</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm text-[var(--texto-suave)] mt-1">Se aplica sola en el carrito.</p>
            </div>
          )}

          <p>
            {producto.disponible
              ? <span className="insignia insignia-ok">Disponible</span>
              : <span className="insignia insignia-neutra">Agotado por ahora</span>}
          </p>

          {vendible && <div className="mt-1 md:max-w-sm"><AgregarAlCarrito producto={producto} grande /></div>}
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer"
              className={`btn btn-grande md:max-w-sm ${vendible ? 'btn-secundario' : 'btn-acento'}`}>
              {producto.precio != null ? 'Consultar por WhatsApp' : 'Preguntar el precio por WhatsApp'}
            </a>
          )}
          {!vendible && !whatsapp && (
            <p className="rounded-xl bg-[var(--fondo)] p-3 text-sm">
              {producto.precio == null ? 'Pregunta el precio en el local' : 'Pregunta en el local cuándo vuelve'}
              {tienda.direccion ? `: ${tienda.direccion}` : '.'}
            </p>
          )}
          {vendible && tienda.direccion && (
            <p className="text-sm text-[var(--texto-suave)]">También puedes comprarlo en el local: {tienda.direccion}</p>
          )}
        </div>
      </article>

      {parecidos.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">También te puede interesar</h2>
            <Link href={`/tienda/productos?categoria=${encodeURIComponent(producto.grupo!)}`}
              className="font-semibold text-marca-700 hover:underline shrink-0">Ver más →</Link>
          </div>
          <Grilla productos={parecidos} />
        </section>
      )}

      {datosGoogle && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datosGoogle).replace(/</g, '\\u003c') }} />
      )}
    </div>
  );
}
