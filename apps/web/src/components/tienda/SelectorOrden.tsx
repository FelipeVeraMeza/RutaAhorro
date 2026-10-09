'use client';

import { useRouter } from 'next/navigation';
import { ORDENES_TIENDA } from '@rutaahorro/core';

/**
 * "Ordenar por": cambia la dirección y vuelve a la página 1.
 *
 * Es un formulario GET de verdad (RNF-T40): sin JavaScript, el botón
 * "Ordenar" de <noscript> lo envía con los demás filtros; con JavaScript,
 * cambiar la opción basta. Los filtros llegan del servidor y no de
 * `useSearchParams`: eso obligaba a envolverlo en <Suspense>, y sin
 * JavaScript el selector quedaba escondido.
 */
export function SelectorOrden({ ruta, actual, ocultos }: {
  ruta: string;
  actual: string;
  /** Los demás filtros de la dirección, sin `orden` ni `pagina`. */
  ocultos: Array<[string, string]>;
}) {
  const router = useRouter();
  return (
    <form action={ruta} method="get" className="flex items-center gap-2 shrink-0">
      {ocultos.map(([k, v], i) => <input key={`${k}-${i}`} type="hidden" name={k} value={v} />)}
      <label className="flex items-center gap-2 text-sm text-[var(--texto-suave)]">
        Ordenar por
        <select key={actual} name="orden" defaultValue={actual} className="h-11 px-2 rounded-xl border border-[var(--borde)] bg-[var(--superficie)] text-[var(--texto)] font-semibold"
          onChange={(e) => {
            const p = new URLSearchParams(ocultos);
            if (e.target.value !== 'relevantes') p.set('orden', e.target.value);
            const s = p.toString();
            router.push(s ? `${ruta}?${s}` : ruta);
          }}>
          {ORDENES_TIENDA.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </select>
      </label>
      <noscript><button className="btn btn-secundario btn-chico">Ordenar</button></noscript>
    </form>
  );
}
