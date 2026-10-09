'use client';

import Link from 'next/link';
import type { ProductoTienda } from '@rutaahorro/core';
import { Icono } from '@/components/Icono';
import { agregarAlCarrito, cambiarCantidad, useCarrito } from '@/lib/tienda/carrito';

/**
 * "Agregar al carrito", o el − cantidad + cuando ya está en el carrito: así se
 * ve desde la lista cuánto lleva de cada cosa sin abrir el carrito.
 */
export function AgregarAlCarrito({ producto, grande = false }: { producto: ProductoTienda; grande?: boolean }) {
  const lineas = useCarrito();
  const enCarrito = lineas.find((l) => l.id === producto.id)?.cantidad ?? 0;
  const alto = grande ? 'btn-grande' : 'btn-chico';

  if (producto.precio == null) {
    return (
      <Link href={`/tienda/p/${producto.id}`} className={`btn btn-secundario ${alto} w-full`}>
        Ver producto
      </Link>
    );
  }
  if (!producto.disponible) {
    return <button type="button" disabled className={`btn btn-secundario ${alto} w-full`}>Agotado</button>;
  }
  if (enCarrito > 0) {
    return (
      <div className="flex items-center gap-2" role="group" aria-label={`Cantidad de ${producto.nombre}`}>
        <button type="button" className={`btn btn-secundario ${alto} px-0 w-11`} aria-label="Quitar uno"
          onClick={() => cambiarCantidad(producto.id, enCarrito - 1)}>−</button>
        <span className="flex-1 text-center font-bold num" aria-live="polite">
          {enCarrito}<span className={grande ? '' : 'sr-only sm:not-sr-only'}> en el carrito</span>
        </span>
        <button type="button" className={`btn btn-primario ${alto} px-0 w-11`} aria-label="Agregar uno"
          onClick={() => cambiarCantidad(producto.id, enCarrito + 1)}>+</button>
      </div>
    );
  }
  return (
    <button type="button" className={`btn btn-primario ${alto} w-full`} onClick={() => agregarAlCarrito(producto)}>
      <Icono nombre="vender" tamano={18} />
      <span>Agregar<span className={grande ? '' : 'hidden sm:inline'}> al carrito</span></span>
    </button>
  );
}
