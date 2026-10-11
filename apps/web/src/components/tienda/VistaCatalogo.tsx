import Link from 'next/link';
import {
  categoriasDelCatalogo, destacadosDelDia, diaLocal, filtrarCatalogo, formatCLP, marcasDelCatalogo, ORDENES_TIENDA,
  sugerenciaBusqueda, type OrdenTienda, type ProductoTienda,
} from '@rutaahorro/core';
import { Icono } from '@/components/Icono';
import { iconoProducto } from '@/lib/tienda/iconos';
import { Grilla } from './Grilla';
import { Paginas } from './Paginas';
import { SelectorOrden } from './SelectorOrden';

/**
 * El catálogo con barra lateral, como la maqueta de Felipe (2026-10-09):
 * franja de categorías arriba, y abajo Categorías · Precio · Marca a la
 * izquierda y los productos a la derecha. Lo usan Inicio y Productos.
 *
 * Todo va en la dirección (?categoria=…&min=…&marca=…): se puede compartir,
 * el botón "atrás" funciona y no hace falta JavaScript para filtrar.
 */

export type ParamsCatalogo = Record<string, string | string[] | undefined>;

export interface Filtros {
  q: string;
  categoria: string;
  orden?: OrdenTienda;
  min?: number;
  max?: number;
  marcas: string[];
  /** RF-T61 · Solo lo que hay. */
  disponibles: boolean;
  /** RF-T75 · Solo lo que tiene oferta hoy. */
  ofertas: boolean;
  pagina: number;
}

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const pesos = (v: string) => {
  const n = Number(v.replace(/\D/g, ''));
  return v.trim() && Number.isFinite(n) ? n : undefined;
};

export function leerFiltros(p: ParamsCatalogo): Filtros {
  const orden = uno(p.orden);
  const marcas = p.marca == null ? [] : Array.isArray(p.marca) ? p.marca : [p.marca];
  // "Mín. 5.000 / Máx. 1.000" no mostraba nada y no decía por qué: se dan vuelta.
  let min = pesos(uno(p.min));
  let max = pesos(uno(p.max));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return {
    q: uno(p.q).slice(0, 100),
    categoria: uno(p.categoria),
    orden: ORDENES_TIENDA.some((o) => o.valor === orden) ? (orden as OrdenTienda) : undefined,
    min,
    max,
    // Hasta 20 marcas de hasta 40 letras: una dirección armada a mano no hace trabajar de más al servidor.
    marcas: marcas.filter(Boolean).slice(0, 20).map((m) => m.slice(0, 40)),
    disponibles: uno(p.disponibles) === '1',
    ofertas: uno(p.ofertas) === '1',
    // ?pagina=-3 o 2.5 se tomaban tal cual.
    pagina: Math.max(1, Math.floor(Number(uno(p.pagina)) || 1)),
  };
}

/** La dirección con esos filtros, sin los vacíos. `marca` se repite por cada una. */
export function enlaceFiltros(ruta: string, f: Partial<Filtros>) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.categoria) p.set('categoria', f.categoria);
  if (f.orden && f.orden !== 'relevantes') p.set('orden', f.orden);
  if (f.min != null) p.set('min', String(f.min));
  if (f.max != null) p.set('max', String(f.max));
  for (const m of f.marcas ?? []) p.append('marca', m);
  if (f.disponibles) p.set('disponibles', '1');
  if (f.ofertas) p.set('ofertas', '1');
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina));
  const s = p.toString();
  return s ? `${ruta}?${s}` : ruta;
}

/** La franja blanca de categorías con ícono. Las que no caben van en "Más categorías". */
export function FranjaCategorias({ catalogo, ruta, activa }: { catalogo: readonly ProductoTienda[]; ruta: string; activa?: string }) {
  const categorias = categoriasDelCatalogo(catalogo);
  if (!categorias.length) return null;
  const visibles = categorias.slice(0, 6);
  return (
    <nav aria-label="Categorías destacadas" className="tarjeta p-2 md:p-3 flex gap-2 overflow-x-auto sin-scrollbar">
      {visibles.map((c) => {
        const on = activa === c;
        return (
          <Link key={c} href={enlaceFiltros(ruta, on ? {} : { categoria: c })} aria-current={on ? 'page' : undefined}
            className={`shrink-0 flex items-center gap-2.5 min-h-12 pl-2 pr-4 rounded-xl border transition-colors
              ${on ? 'border-marca-500 bg-marca-50' : 'border-transparent hover:border-[var(--borde)] hover:bg-[var(--fondo)]'}`}>
            <span className="grid place-items-center size-10 rounded-xl bg-[var(--fondo)] text-marca-700">
              <Icono nombre={iconoProducto(c, '')} tamano={22} />
            </span>
            <span className="font-medium whitespace-nowrap">{c}</span>
          </Link>
        );
      })}
      {categorias.length > visibles.length && (
        <Link href="/tienda/categorias" className="shrink-0 flex items-center gap-2.5 min-h-12 pl-2 pr-4 rounded-xl hover:bg-[var(--fondo)]">
          <span className="grid place-items-center size-10 rounded-xl bg-[var(--fondo)] text-marca-700">
            <Icono nombre="mas" tamano={22} />
          </span>
          <span className="font-medium whitespace-nowrap">Más categorías</span>
        </Link>
      )}
    </nav>
  );
}

function PanelFiltros({ catalogo, ruta, f, id }: { catalogo: readonly ProductoTienda[]; ruta: string; f: Filtros; id: string }) {
  const categorias = categoriasDelCatalogo(catalogo);
  const todasMarcas = marcasDelCatalogo(catalogo);
  const marcas = todasMarcas.slice(0, 10);
  const masMarcas = todasMarcas.slice(10);
  const titulo = 'text-base font-extrabold mb-2';
  const campo = 'w-full h-11 pl-6 pr-2 rounded-lg border border-[var(--borde)] bg-[var(--superficie)] num';
  const hayFiltros = Boolean(f.categoria || f.min != null || f.max != null || f.marcas.length || f.disponibles || f.ofertas);
  const casilla = (m: { marca: string; cuantos: number }) => (
    <li key={m.marca}>
      <label className="flex items-center gap-2.5 min-h-11 text-sm cursor-pointer">
        <input type="checkbox" name="marca" value={m.marca} defaultChecked={f.marcas.includes(m.marca)}
          className="size-4 accent-[var(--color-marca-500)]" />
        <span className="flex-1">{m.marca}</span>
        <span className="text-xs text-[var(--texto-suave)] num">{m.cuantos}</span>
      </label>
    </li>
  );
  return (
    <div className="flex flex-col gap-5">
      {categorias.length > 0 && (
        <section aria-labelledby={`${id}-cat`}>
          <h2 id={`${id}-cat`} className={titulo}>Categorías</h2>
          <ul className="flex flex-col">
            {[{ nombre: 'Todas las categorías', valor: '' }, ...categorias.map((c) => ({ nombre: c, valor: c }))].map((c) => {
              const on = f.categoria === c.valor;
              return (
                <li key={c.nombre}>
                  <Link href={enlaceFiltros(ruta, { ...f, categoria: c.valor, pagina: 1 })} aria-current={on ? 'page' : undefined}
                    className={`flex items-center min-h-11 pl-3 border-l-[3px] text-sm transition-colors
                      ${on ? 'border-acento-500 font-bold text-[var(--texto)]' : 'border-transparent text-[var(--texto-suave)] hover:text-[var(--texto)]'}`}>
                    {c.nombre}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form action={ruta} method="get" className="flex flex-col gap-5 border-t border-[var(--borde)] pt-5">
        {f.q && <input type="hidden" name="q" value={f.q} />}
        {f.categoria && <input type="hidden" name="categoria" value={f.categoria} />}
        {f.orden && f.orden !== 'relevantes' && <input type="hidden" name="orden" value={f.orden} />}
        <fieldset>
          <legend className={titulo}>Precio</legend>
          <div className="flex gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Precio mínimo</span>
              <span aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--texto-suave)]">$</span>
              <input name="min" inputMode="numeric" maxLength={9} placeholder="Mín." defaultValue={f.min ?? ''} className={campo} />
            </label>
            <label className="relative flex-1">
              <span className="sr-only">Precio máximo</span>
              <span aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--texto-suave)]">$</span>
              <input name="max" inputMode="numeric" maxLength={9} placeholder="Máx." defaultValue={f.max ?? ''} className={campo} />
            </label>
          </div>
        </fieldset>

        {marcas.length > 0 && (
          <fieldset>
            <legend className={titulo}>Marca</legend>
            <ul className="flex flex-col">{marcas.map(casilla)}</ul>
            {/* RF-T76 · Todas las marcas, no solo las 10 con más productos; sin JavaScript. */}
            {masMarcas.length > 0 && (
              <details open={masMarcas.some((m) => f.marcas.includes(m.marca))}>
                <summary className="min-h-11 flex items-center text-sm font-semibold text-marca-700 cursor-pointer">Ver {masMarcas.length} marcas más</summary>
                <ul className="flex flex-col">{masMarcas.map(casilla)}</ul>
              </details>
            )}
          </fieldset>
        )}

        <fieldset className="flex flex-col">
          <legend className={titulo}>Mostrar</legend>
          <label className="flex items-center gap-2.5 min-h-11 text-sm cursor-pointer">
            <input type="checkbox" name="disponibles" value="1" defaultChecked={f.disponibles} className="size-4 accent-[var(--color-marca-500)]" />
            Solo lo disponible
          </label>
          <label className="flex items-center gap-2.5 min-h-11 text-sm cursor-pointer">
            <input type="checkbox" name="ofertas" value="1" defaultChecked={f.ofertas} className="size-4 accent-[var(--color-marca-500)]" />
            Solo con oferta
          </label>
        </fieldset>

        <button className="btn btn-primario btn-chico w-full">Aplicar</button>
        {hayFiltros && (
          <Link href={enlaceFiltros(ruta, { q: f.q, orden: f.orden })} className="btn btn-fantasma btn-chico w-full -mt-3">
            Limpiar filtros
          </Link>
        )}
      </form>
    </div>
  );
}

export function VistaCatalogo({ catalogo, ruta, f }: { catalogo: readonly ProductoTienda[]; ruta: string; f: Filtros }) {
  const r = filtrarCatalogo(catalogo, {
    busqueda: f.q, categoria: f.categoria, orden: f.orden, precioMin: f.min, precioMax: f.max, marcas: f.marcas,
    soloDisponibles: f.disponibles, soloOfertas: f.ofertas, pagina: f.pagina,
  });
  const sugeridos = r.total === 0 ? destacadosDelDia(catalogo, diaLocal(new Date(), 'America/Santiago'), 4) : [];
  // RF-T65 · "¿Quisiste decir…?"
  const quisoDecir = r.total === 0 && f.q ? sugerenciaBusqueda(catalogo, f.q) : null;
  const activos = [f.categoria && 'categoría', (f.min != null || f.max != null) && 'precio', f.marcas.length && 'marca', f.disponibles, f.ofertas].filter(Boolean).length;
  // RF-T77 · Los filtros puestos, cada uno con su ✕ para sacarlo.
  const chips: Array<{ texto: string; sin: Partial<Filtros> }> = [
    ...(f.q ? [{ texto: `"${f.q}"`, sin: { q: '' } }] : []),
    ...(f.categoria ? [{ texto: f.categoria, sin: { categoria: '' } }] : []),
    ...(f.min != null || f.max != null ? [{
      texto: f.min != null && f.max != null ? `${formatCLP(f.min)} a ${formatCLP(f.max)}` : f.min != null ? `Desde ${formatCLP(f.min)}` : `Hasta ${formatCLP(f.max!)}`,
      sin: { min: undefined, max: undefined },
    }] : []),
    ...f.marcas.map((m) => ({ texto: m, sin: { marcas: f.marcas.filter((x) => x !== m) } })),
    ...(f.disponibles ? [{ texto: 'Solo disponibles', sin: { disponibles: false } }] : []),
    ...(f.ofertas ? [{ texto: 'Con oferta', sin: { ofertas: false } }] : []),
  ];

  return (
    <div id="categorias" className="flex flex-col gap-4 lg:grid lg:grid-cols-[260px_1fr] lg:items-start lg:gap-5 scroll-mt-24">
      {/* Computador: la barra lateral a la vista. Celular: detrás de "Filtros".
          UN solo panel: antes eran dos (uno escondido por tamaño de pantalla) y
          la portada pesaba 253 KB. El botón del celular es una casilla +
          etiqueta: se abre y se cierra sin JavaScript (RNF-T40). */}
      <aside className="tarjeta lg:p-5 lg:sticky lg:top-24">
        <input type="checkbox" id="ver-filtros" className="peer sr-only" />
        <label htmlFor="ver-filtros"
          className="lg:hidden cursor-pointer flex items-center justify-between min-h-12 px-4 font-semibold peer-focus-visible:outline-2 peer-focus-visible:outline-marca-500 rounded-[var(--radius-app)] [&_.flecha]:-rotate-90 peer-checked:[&_.flecha]:rotate-90">
          <span className="flex items-center gap-2">
            <Icono nombre="configuracion" tamano={20} /> Filtros
            {activos > 0 && <span className="insignia bg-acento-500 text-marca-900 num">{activos}</span>}
          </span>
          <Icono nombre="volver" tamano={20} className="flecha transition-transform" />
        </label>
        <div className="hidden peer-checked:block lg:block px-4 pb-4 lg:p-0">
          <PanelFiltros catalogo={catalogo} ruta={ruta} f={f} id="filtros" />
        </div>
      </aside>

      <section className="tarjeta p-3 md:p-4 flex flex-col gap-3 min-w-0" aria-label="Productos">
        <div className="flex items-center justify-between gap-3 flex-wrap px-1">
          <p className="text-sm text-[var(--texto-suave)]" aria-live="polite">
            {r.total === 0
              ? f.q ? `No encontramos "${f.q}".` : 'No hay productos con esos filtros.'
              : `${r.total.toLocaleString('es-CL')} ${r.total === 1 ? 'producto encontrado' : 'productos encontrados'}${f.q ? ` para "${f.q}"` : ''}`}
          </p>
          {r.total > 1 && (
            <SelectorOrden ruta={ruta} actual={f.orden ?? 'relevantes'}
              ocultos={[...new URLSearchParams(enlaceFiltros('', { ...f, orden: undefined, pagina: 1 }).replace(/^\?/, '')).entries()]} />
          )}
        </div>

        {chips.length > 0 && (
          <ul className="flex gap-2 flex-wrap px-1" aria-label="Filtros puestos">
            {chips.map((c) => (
              <li key={c.texto}>
                <Link href={enlaceFiltros(ruta, { ...f, ...c.sin, pagina: 1 })}
                  className="inline-flex items-center gap-1.5 min-h-9 pl-3 pr-2 rounded-full bg-marca-50 border border-marca-100 text-sm font-medium hover:border-marca-300"
                  aria-label={`Quitar el filtro ${c.texto}`}>
                  {c.texto} <span aria-hidden className="text-base leading-none">×</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {r.total === 0 && (
          <div className="rounded-xl bg-[var(--fondo)] p-4 flex flex-col gap-2">
            {quisoDecir && (
              <p className="text-lg">¿Quisiste decir <Link href={enlaceFiltros(ruta, { ...f, q: quisoDecir, pagina: 1 })} className="font-bold text-marca-700 underline">{quisoDecir}</Link>?</p>
            )}
            <p>{f.q ? 'Revisa cómo está escrito o prueba con una palabra más corta (por ejemplo, la marca).' : 'Prueba quitando algún filtro.'}</p>
            <Link href={ruta} className="btn btn-secundario btn-chico self-start">Ver todos los productos</Link>
          </div>
        )}
        {sugeridos.length > 0 && (
          <>
            <h2 className="text-lg font-extrabold px-1">Te puede interesar</h2>
            <Grilla productos={sugeridos} />
          </>
        )}
        {r.productos.length > 0 && <Grilla productos={r.productos} prioridad={4} />}

        <Paginas actual={r.pagina} total={r.paginas} enlace={(n) => enlaceFiltros(ruta, { ...f, pagina: n })} />
      </section>
    </div>
  );
}
