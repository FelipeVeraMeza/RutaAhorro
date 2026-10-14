'use client';

import { Icono } from '@/components/Icono';
import { alternarFavorito, useFavoritos } from '@/lib/tienda/favoritos';

/** El corazón de cada producto (RF-T73). Guarda en este navegador. */
export function BotonFavorito({ id, nombre, grande = false }: { id: string; nombre: string; grande?: boolean }) {
  const { valor, listo } = useFavoritos();
  const es = listo && valor.includes(id);
  return (
    <button type="button" onClick={() => alternarFavorito(id)} aria-pressed={es}
      aria-label={es ? `Quitar ${nombre} de favoritos` : `Guardar ${nombre} en favoritos`}
      className={`grid place-items-center rounded-full bg-[var(--superficie)]/90 border border-[var(--borde)] shrink-0
        ${grande ? 'size-12' : 'size-11'} ${es ? 'text-acento-600' : 'text-[var(--texto-suave)] hover:text-acento-600'}`}>
      <Icono nombre="corazon" tamano={grande ? 24 : 20} className={es ? 'fill-current' : ''} />
    </button>
  );
}
