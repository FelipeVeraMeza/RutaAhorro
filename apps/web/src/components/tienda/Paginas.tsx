import Link from 'next/link';
import { paginasVisibles } from '@rutaahorro/core';

/**
 * RF-T67 · Páginas con número: 1 … 4 5 6 … 20, además de Anterior y
 * Siguiente. Son enlaces: funcionan sin JavaScript y "atrás" vuelve.
 */
export function Paginas({ actual, total, enlace }: { actual: number; total: number; enlace: (n: number) => string }) {
  if (total <= 1) return null;
  return (
    <nav aria-label="Páginas" className="flex items-center justify-center gap-1.5 md:gap-2 pt-2 flex-wrap">
      {actual > 1
        ? <Link className="btn btn-secundario btn-chico" href={enlace(actual - 1)} rel="prev">Anterior</Link>
        : <span className="btn btn-secundario btn-chico opacity-45" aria-disabled>Anterior</span>}
      <ul className="hidden sm:flex items-center gap-1">
        {paginasVisibles(actual, total).map((n, i) => (
          <li key={n ?? `salto-${i}`}>
            {n == null
              ? <span aria-hidden className="px-1 text-[var(--texto-suave)]">…</span>
              : <Link href={enlace(n)} aria-current={n === actual ? 'page' : undefined} aria-label={`Página ${n}`}
                  className={`grid place-items-center min-w-11 h-11 px-2 rounded-lg font-semibold num
                    ${n === actual ? 'bg-marca-500 text-white' : 'hover:bg-[var(--fondo)]'}`}>{n}</Link>}
          </li>
        ))}
      </ul>
      <span className="sm:hidden text-sm num">Página {actual} de {total}</span>
      {actual < total
        ? <Link className="btn btn-secundario btn-chico" href={enlace(actual + 1)} rel="next">Siguiente</Link>
        : <span className="btn btn-secundario btn-chico opacity-45" aria-disabled>Siguiente</span>}
    </nav>
  );
}
