import Link from 'next/link';
import { precioTienda, rebajaMaximaPct, type ProductoTienda } from '@rutaahorro/core';
import { Icono } from '@/components/Icono';
import { iconoProducto } from '@/lib/tienda/iconos';
import { AgregarAlCarrito } from './AgregarAlCarrito';

/**
 * La foto del producto o, mientras no tenga (`image_url` todavía no se carga
 * desde Productos, RT-50), el ícono de su categoría sobre un fondo suave.
 */
export function FotoProducto({ producto, grande = false }: { producto: ProductoTienda; grande?: boolean }) {
  if (producto.imagen) {
    // eslint-disable-next-line @next/next/no-img-element -- fotos de Supabase Storage, sin dominios fijos aún
    return <img src={producto.imagen} alt="" loading="lazy" className="w-full aspect-square object-contain bg-white p-3" />;
  }
  return (
    <div aria-hidden className="w-full aspect-square grid place-items-center bg-marca-50 text-marca-300">
      <Icono nombre={iconoProducto(producto.grupo, producto.nombre)} tamano={grande ? 120 : 64} />
    </div>
  );
}

export function TarjetaProducto({ producto }: { producto: ProductoTienda }) {
  const rebaja = producto.disponible ? rebajaMaximaPct(producto.precio, producto.tramos) : 0;
  return (
    <article className="tarjeta overflow-hidden flex flex-col w-full">
      <Link href={`/tienda/p/${producto.id}`} className="flex flex-col flex-1 focus-visible:outline-2 focus-visible:outline-marca-500 group">
        <div className="p-3 pb-0 relative">
          <div className={`rounded-xl overflow-hidden ${producto.disponible ? '' : 'opacity-50'}`}><FotoProducto producto={producto} /></div>
          {rebaja > 0 && (
            <span className="absolute top-5 left-5 rounded-lg bg-acento-500 text-marca-900 text-sm font-extrabold px-2 py-0.5 num">
              <span className="sr-only">Oferta: hasta </span>-{rebaja}%
            </span>
          )}
          {!producto.disponible && (
            <span className="absolute top-5 left-5 insignia insignia-neutra border border-[var(--borde)]">Agotado</span>
          )}
        </div>
        <div className="px-3 pt-3 flex flex-col gap-0.5 flex-1">
          <h2 className="font-semibold leading-snug line-clamp-2 group-hover:underline">{producto.nombre}</h2>
          {producto.descripcion && <p className="text-sm text-[var(--texto-suave)] line-clamp-1">{producto.descripcion}</p>}
          <div className="mt-auto pt-2">
            {producto.precio != null
              ? <p className="text-2xl font-extrabold num">{precioTienda(producto.precio)}</p>
              : <p className="text-base font-bold text-marca-700 py-1">{precioTienda(null)}</p>}
            {producto.ofertas[0] && <p className="text-sm font-semibold text-acento-700">{producto.ofertas[0]}</p>}
          </div>
        </div>
      </Link>
      <div className="p-3">
        <AgregarAlCarrito producto={producto} />
      </div>
    </article>
  );
}
