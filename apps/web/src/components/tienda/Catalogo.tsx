import Link from 'next/link';
import type { PaginaTienda, ProductoTienda } from '@rutaahorro/core';
import { Icono } from '@/components/Icono';
import { iconoProducto } from '@/lib/tienda/iconos';
import { TarjetaProducto } from './TarjetaProducto';
import { SelectorOrden } from './SelectorOrden';

/** Piezas que comparten Inicio, Productos y Ofertas. */

export function Buscador({ accion, q = '', ocultos = {} }: {
  accion: string; q?: string; ocultos?: Record<string, string | undefined>;
}) {
  return (
    <form action={accion} method="get" role="search" className="flex gap-2 md:gap-3">
      {Object.entries(ocultos).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <label htmlFor="buscar" className="sr-only">Buscar productos</label>
      <div className="relative flex-1 min-w-0">
        <Icono nombre="buscar" tamano={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--texto-suave)] pointer-events-none" />
        <input id="buscar" name="q" type="search" defaultValue={q} placeholder="Buscar productos, marcas o categorías…"
          className="w-full h-12 md:h-13 pl-11 pr-3 rounded-xl border border-[var(--borde)] bg-[var(--superficie)] focus:outline-2 focus:outline-marca-500" />
      </div>
      <button className="btn btn-primario px-5 md:px-8 h-12 md:h-13">Buscar</button>
    </form>
  );
}

const CHIP = 'shrink-0 inline-flex items-center gap-2 min-h-11 px-4 rounded-full border font-medium transition-colors';
const CHIP_NORMAL = `${CHIP} bg-[var(--superficie)] border-[var(--borde)] hover:border-marca-300`;
const CHIP_ACTIVO = `${CHIP} bg-marca-500 border-marca-500 text-white`;

/** Las categorías como botones redondos con ícono. Llevan a Productos filtrado. */
export function Categorias({ categorias, activa, conTodo = false }: { categorias: string[]; activa?: string; conTodo?: boolean }) {
  if (!categorias.length) return null;
  return (
    <nav aria-label="Categorías" className="flex gap-2 md:gap-3 overflow-x-auto sin-scrollbar -mx-4 px-4 py-0.5">
      {conTodo && (
        <Link href="/tienda/productos" className={!activa ? CHIP_ACTIVO : CHIP_NORMAL} aria-current={!activa ? 'page' : undefined}>
          Todo
        </Link>
      )}
      {categorias.map((c) => (
        <Link key={c} href={activa === c ? '/tienda/productos' : `/tienda/productos?categoria=${encodeURIComponent(c)}`}
          className={activa === c ? CHIP_ACTIVO : CHIP_NORMAL} aria-current={activa === c ? 'page' : undefined}>
          <Icono nombre={iconoProducto(c, '')} tamano={18} /> {c}
        </Link>
      ))}
    </nav>
  );
}

export function Grilla({ productos }: { productos: ProductoTienda[] }) {
  return (
    <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
      {productos.map((p) => <li key={p.id} className="flex"><TarjetaProducto producto={p} /></li>)}
    </ul>
  );
}

/** La lista con su conteo y sus páginas. `enlace(n)` arma la dirección de la página n. */
export function Resultados({ r, q, vacio, enlace, orden, sugeridos = [] }: {
  r: PaginaTienda; q?: string; vacio: string; enlace: (pagina: number) => string;
  /** "Ordenar por": la ruta, el orden actual y los demás filtros de la dirección. */
  orden?: { ruta: string; actual: string; ocultos: Array<[string, string]> };
  /** Qué mostrar si no hay resultados, para que la página no quede vacía. */
  sugeridos?: ProductoTienda[];
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap -mb-1">
        <p className="text-[var(--texto-suave)]" aria-live="polite">
          {r.total === 0
            ? q ? `No encontramos "${q}".` : vacio
            : `${r.total.toLocaleString('es-CL')} ${r.total === 1 ? 'producto' : 'productos'}${q ? ` para "${q}"` : ''}`}
        </p>
        {orden && r.total > 1 && <SelectorOrden {...orden} />}
      </div>
      {r.total === 0 && q && (
        <div className="tarjeta p-4 flex flex-col gap-2">
          <p>Revisa cómo está escrito o prueba con una palabra más corta (por ejemplo, la marca).</p>
          <Link href="/tienda/productos" className="btn btn-secundario self-start">Ver todos los productos</Link>
        </div>
      )}
      {r.total === 0 && sugeridos.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-extrabold tracking-tight">Te puede interesar</h2>
          <Grilla productos={sugeridos} />
        </section>
      )}
      {r.productos.length > 0 && <Grilla productos={r.productos} />}
      {r.paginas > 1 && (
        <nav aria-label="Páginas" className="flex items-center justify-center gap-3 py-2">
          {r.pagina > 1
            ? <Link className="btn btn-secundario" href={enlace(r.pagina - 1)}>Anterior</Link>
            : <span className="btn btn-secundario opacity-45" aria-disabled>Anterior</span>}
          <span className="text-sm num">Página {r.pagina} de {r.paginas}</span>
          {r.pagina < r.paginas
            ? <Link className="btn btn-secundario" href={enlace(r.pagina + 1)}>Siguiente</Link>
            : <span className="btn btn-secundario opacity-45" aria-disabled>Siguiente</span>}
        </nav>
      )}
    </>
  );
}

/** Arma "/ruta?a=1&b=2" sin los vacíos. */
export function conParametros(ruta: string, params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && !(k === 'pagina' && Number(v) <= 1)) p.set(k, String(v));
  const s = p.toString();
  return s ? `${ruta}?${s}` : ruta;
}

export function TiendaCerrada() {
  return (
    <div className="text-center py-16">
      <h1 className="text-xl font-bold mb-2">La tienda todavía no está abierta</h1>
      <p className="text-[var(--texto-suave)]">Vuelve pronto.</p>
    </div>
  );
}
