'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ProductoTienda } from '@rutaahorro/core';
import { useFavoritos, useVistos } from '@/lib/tienda/favoritos';
import { Grilla } from './Grilla';

/**
 * Favoritos (RF-T73) o vistos hace poco (RF-T74): los id viven en este
 * navegador; los productos se piden como están hoy.
 */
export function ProductosGuardados({ cual, titulo, excluir, vacio, id }: {
  cual: 'favoritos' | 'vistos'; titulo: string; excluir?: string; vacio?: React.ReactNode; id?: string;
}) {
  const fav = useFavoritos();
  const vis = useVistos();
  const { valor, listo } = cual === 'favoritos' ? fav : vis;
  const ids = valor.filter((x) => x !== excluir);
  const clave = ids.join(',');
  const [productos, setProductos] = useState<ProductoTienda[] | null>(null);

  useEffect(() => {
    if (!listo) return;
    if (!clave) { setProductos([]); return; }
    let vivo = true;
    fetch(`/api/tienda/productos?completo=1&ids=${clave}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { productos: [] }))
      .then((d: { productos: ProductoTienda[] }) => { if (vivo) setProductos(d.productos); })
      .catch(() => { if (vivo) setProductos([]); });
    return () => { vivo = false; };
  }, [listo, clave]);

  if (!productos) return null;
  const mostrar = cual === 'vistos' ? productos.slice(0, 4) : productos;
  if (!mostrar.length && !vacio) return null;
  return (
    <section id={id} className="flex flex-col gap-3 scroll-mt-24" aria-label={titulo}>
      <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">{titulo}</h2>
      {mostrar.length ? <Grilla productos={mostrar} /> : <div className="tarjeta p-4 text-[var(--texto-suave)]">{vacio}</div>}
      {cual === 'favoritos' && mostrar.length > 0 && (
        <p className="text-sm text-[var(--texto-suave)]">Toca el corazón de un producto para guardarlo o quitarlo. <Link href="/tienda/productos" className="underline">Ver productos</Link></p>
      )}
    </section>
  );
}
