'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ORDENES_TIENDA } from '@rutaahorro/core';

/** "Ordenar por": cambia la dirección y vuelve a la página 1. */
export function SelectorOrden() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const actual = params.get('orden') ?? 'nombre';
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--texto-suave)] shrink-0">
      Ordenar por
      <select value={actual} className="h-11 px-2 rounded-xl border border-[var(--borde)] bg-[var(--superficie)] text-[var(--texto)] font-semibold"
        onChange={(e) => {
          const p = new URLSearchParams(params.toString());
          if (e.target.value === 'nombre') p.delete('orden'); else p.set('orden', e.target.value);
          p.delete('pagina');
          const s = p.toString();
          router.push(s ? `${path}?${s}` : path);
        }}>
        {ORDENES_TIENDA.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
    </label>
  );
}
