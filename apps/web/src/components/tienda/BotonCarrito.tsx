'use client';

import Link from 'next/link';
import { Icono } from '@/components/Icono';
import { useCarrito } from '@/lib/tienda/carrito';

/** El carrito de la cabecera, con cuántas unidades lleva. */
export function BotonCarrito() {
  const unidades = useCarrito().reduce((s, l) => s + l.cantidad, 0);
  return (
    <Link href="/tienda/carrito" className="relative tap grid place-items-center rounded-xl hover:bg-white/10"
      aria-label={`Carrito, ${unidades} ${unidades === 1 ? 'producto' : 'productos'}`}>
      <Icono nombre="vender" tamano={28} />
      <span className="absolute top-0.5 right-0 min-w-5 h-5 px-1 rounded-full bg-acento-500 text-marca-900 text-xs font-bold grid place-items-center num">
        {unidades}
      </span>
    </Link>
  );
}
