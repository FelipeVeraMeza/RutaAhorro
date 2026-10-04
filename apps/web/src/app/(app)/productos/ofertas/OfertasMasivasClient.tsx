'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatCLP, toUserMessage, validarMonto, validarCantidad, validarCantidadStock, validarTramos,
  precioDelTramo, describirTramo, type TramoPrecio, coincide
} from '@rutaahorro/core';
import { repoPrecios } from '@/lib/datos/precios';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { repoProductos, type Categoria, type Producto } from '@/lib/productos';
import { Modal } from '@/components/Modal';
import { Encabezado } from '@/components/Encabezado';

/**
 * La misma oferta a muchos productos a la vez (0021).
 *
 * Pedido de Felipe, 2026-09-27: hasta 0018 las ofertas se cargaban producto
 * por producto, y «todas las cervezas, desde 6, 10 % menos» eran cuarenta
 * formularios. Acá se escribe la oferta una vez, se eligen los productos (por
 * categoría, búsqueda o a mano) y se ve, antes de guardar, a cuánto queda
 * cada uno y cuáles se saltan.
 *
 * Por porcentaje es lo que conviene para muchos productos: cada uno queda con
 * su precio, y la oferta sigue al producto cuando sube.
 */

const MOTIVOS: Record<string, string> = {
  OFERTA_NO_ES_MAS_BARATA: 'la oferta no es más barata que su precio normal',
  PRODUCTO_INACTIVO: 'está desactivado',
};

type Tipo = 'pct' | 'precio';

export function OfertasMasivasClient({ esAdmin }: { esAdmin: boolean }) {
  const config = useConfiguracion();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [ofertas, setOfertas] = useState<Map<string, TramoPrecio[]>>(new Map());
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [categoriaId, setCategoriaId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [soloConOferta, setSoloConOferta] = useState(false);

  const [desde, setDesde] = useState('6');
  const [tipo, setTipo] = useState<Tipo>('pct');
  const [valor, setValor] = useState('');
  const [conFechas, setConFechas] = useState(false);
  const [vDesdeFecha, setVDesdeFecha] = useState('');
  const [vHastaFecha, setVHastaFecha] = useState('');

  const [confirmando, setConfirmando] = useState<'aplicar' | 'quitar' | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const [ps, cs, of] = await Promise.all([
        repoProductos().listar({ soloActivos: true, limite: 5000 }, false),
        repoProductos().categorias(),
        repoPrecios().tramosPorProducto(),
      ]);
      setProductos(ps);
      setCategorias(cs);
      setOfertas(of);
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  // La oferta escrita, o el primer problema en palabras. Lo que depende de
  // cada producto (que sea más barata que su precio) se ve en la lista.
  const oferta = useMemo((): { tramo: TramoPrecio | null; error: string | null } => {
    // Por unidad (0032): "desde 2,5" no existe y se cobraba igual que desde 3.
    const vD = validarCantidadStock(desde, 'unidad', { maximo: 1_000_000 });
    if (!vD.valido) return { tramo: null, error: `Desde cuántas unidades: ${vD.error}` };
    if (valor.trim() === '') return { tramo: null, error: null };
    let tramo: TramoPrecio;
    if (tipo === 'pct') {
      const vP = validarCantidad(valor, { maximo: 99.99 });
      if (!vP.valido) return { tramo: null, error: vP.error };
      tramo = { desde: vD.valor, descuentoPct: vP.valor };
    } else {
      const vM = validarMonto(valor, { etiqueta: 'precio de la oferta', permiteCero: false, maximo: 50_000_000 });
      if (!vM.valido) return { tramo: null, error: vM.error };
      tramo = { desde: vD.valor, precio: vM.valor };
    }
    if (conFechas) {
      tramo.vigenteDesde = vDesdeFecha || null;
      tramo.vigenteHasta = vHastaFecha || null;
    }
    // Contra un precio altísimo, lo único que puede fallar es la oferta misma.
    const errores = validarTramos([tramo], Number.MAX_SAFE_INTEGER);
    return errores.length ? { tramo: null, error: errores[0].mensaje } : { tramo, error: null };
  }, [desde, tipo, valor, conFechas, vDesdeFecha, vHastaFecha]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) =>
      (!categoriaId || p.categoriaId === categoriaId)
      && (!q || coincide(p.nombre, q))
      && (!soloConOferta || (ofertas.get(p.id)?.length ?? 0) > 0));
  }, [productos, categoriaId, busqueda, soloConOferta, ofertas]);

  const alternar = (id: string) => setMarcados((m) => {
    const n = new Set(m);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const todosVisibles = visibles.length > 0 && visibles.every((p) => marcados.has(p.id));

  /** A cuánto queda un producto con la oferta, o por qué se salta. */
  const vistaPrevia = (p: Producto): { precio: number } | { salta: string } | null => {
    if (!oferta.tramo) return null;
    if (validarTramos([oferta.tramo], p.precioVenta).length) return { salta: MOTIVOS.OFERTA_NO_ES_MAS_BARATA };
    return { precio: precioDelTramo(oferta.tramo, p.precioVenta) };
  };
  const elegidos = productos.filter((p) => marcados.has(p.id));
  const seSaltan = elegidos.filter((p) => { const v = vistaPrevia(p); return v && 'salta' in v; }).length;
  const conOfertaElegidos = elegidos.filter((p) => (ofertas.get(p.id)?.length ?? 0) > 0).length;

  async function aplicar() {
    if (!oferta.tramo) return;
    setGuardando(true);
    setAviso(null);
    try {
      const r = await repoPrecios().aplicarOfertaMasiva([...marcados], oferta.tramo);
      const saltados = r.omitidos.length
        ? ` Se saltaron ${r.omitidos.length}: ${r.omitidos.slice(0, 5).map((o) => `${o.nombre} (${MOTIVOS[o.motivo] ?? toUserMessage(o.motivo)})`).join(', ')}${r.omitidos.length > 5 ? '…' : ''}.`
        : '';
      setAviso({
        tipo: 'ok',
        texto: `Oferta "desde ${String(oferta.tramo.desde).replace('.', ',')}, ${describirTramo(oferta.tramo)}" aplicada a ${r.aplicados} ${r.aplicados === 1 ? 'producto' : 'productos'}.${saltados}`,
      });
      setMarcados(new Set());
      await cargar();
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setGuardando(false);
      setConfirmando(null);
    }
  }

  async function quitar() {
    setGuardando(true);
    setAviso(null);
    try {
      const n = await repoPrecios().quitarOfertas([...marcados]);
      setAviso({ tipo: 'ok', texto: `Se quitaron las ofertas de ${n} ${n === 1 ? 'producto' : 'productos'}.` });
      setMarcados(new Set());
      await cargar();
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setGuardando(false);
      setConfirmando(null);
    }
  }

  const campo = 'tap w-full px-3 py-2 rounded-lg border border-[var(--borde)] bg-white';

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-5 pb-36" aria-busy={cargando}>
      <header>
        <Encabezado
          titulo="Ofertas a varios productos"
          volver={{ href: '/productos', texto: 'Productos' }}
          descripcion="Escribe la oferta una vez y elige a qué productos se aplica."
        />
        <Link href="/productos/combos"
              className="tap mt-2 flex items-center justify-between tarjeta px-3 text-sm font-medium">
          🎁 Combos: varios productos a un precio <span aria-hidden>›</span>
        </Link>
      </header>

      {!config.ofertasActivas && (
        <p role="status" className="text-sm px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
          <strong>Las ofertas están apagadas en todo el local:</strong> se cobra el precio normal.
          Puedes prepararlas igual.{' '}
          {esAdmin
            ? <Link href="/configuracion" className="underline">Encenderlas en Configuración</Link>
            : 'El administrador las enciende en Configuración.'}
        </p>
      )}

      {aviso && (
        <p role={aviso.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm px-3 py-2 rounded-lg ${aviso.tipo === 'error' ? 'bg-red-50 text-red-900' : 'bg-marca-100 text-marca-900'}`}>
          {aviso.texto}
        </p>
      )}

      {/* 1 · La oferta -------------------------------------------------------- */}
      <section aria-labelledby="t-oferta" className="tarjeta p-3 space-y-3">
        <h2 id="t-oferta" className="font-semibold">1 · La oferta</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de oferta">
          {([['pct', '% menos'], ['precio', 'Precio fijo c/u']] as const).map(([t, etiqueta]) => (
            <button key={t} type="button" role="radio" aria-checked={tipo === t}
                    onClick={() => { setTipo(t); setValor(''); }}
                    className={`tap rounded-lg border text-sm font-medium ${tipo === t
                      ? 'border-marca-500 bg-marca-100 text-marca-900' : 'border-[var(--borde)]'}`}>
              {etiqueta}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--texto-suave)]">
          {tipo === 'pct'
            ? 'Cada producto queda con su precio menos el porcentaje, y la oferta sigue al producto si sube de precio. Lo que conviene para muchos productos.'
            : 'Todos los elegidos quedan al mismo precio. Sirve para productos que cuestan lo mismo (todas las latas de 350 cc).'}
        </p>
        <div className="flex gap-2">
          <label className="flex-1 min-w-0">
            <span className="block text-xs mb-1">Desde (unidades)</span>
            <input inputMode="numeric" value={desde} onChange={(e) => setDesde(e.target.value)}
                   aria-label="Desde cuántas unidades" className={`${campo} num text-right`} />
          </label>
          <label className="flex-1 min-w-0">
            <span className="block text-xs mb-1">{tipo === 'pct' ? '% menos' : 'Precio c/u'}</span>
            <input inputMode={tipo === 'pct' ? 'decimal' : 'numeric'} value={valor}
                   onChange={(e) => setValor(e.target.value)}
                   aria-label={tipo === 'pct' ? 'Porcentaje de rebaja' : 'Precio de cada unidad'}
                   placeholder={tipo === 'pct' ? '10' : '1.400'}
                   className={`${campo} num text-right`} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[44px]">
          <input type="checkbox" checked={conFechas} onChange={(e) => setConFechas(e.target.checked)}
                 className="w-5 h-5 accent-[var(--color-marca-500)]" />
          Solo entre fechas (promoción)
        </label>
        {conFechas && (
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="block text-xs mb-1">Desde el</span>
              <input type="date" value={vDesdeFecha} onChange={(e) => setVDesdeFecha(e.target.value)}
                     className={`${campo} text-sm`} />
            </label>
            <label>
              <span className="block text-xs mb-1">Hasta el</span>
              <input type="date" value={vHastaFecha} onChange={(e) => setVHastaFecha(e.target.value)}
                     className={`${campo} text-sm`} />
            </label>
          </div>
        )}
        {oferta.error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{oferta.error}</p>}
        <p className="text-xs text-[var(--texto-suave)]">
          Si un producto ya tiene una oferta desde la misma cantidad (y las mismas fechas), se reemplaza.
          Sus otras ofertas quedan igual.
        </p>
      </section>

      {/* 2 · Los productos ---------------------------------------------------- */}
      <section aria-labelledby="t-productos" className="space-y-3">
        <h2 id="t-productos" className="font-semibold">2 · Los productos</h2>
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}
                aria-label="Filtrar por categoría" className={campo}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
               placeholder="Buscar producto…" aria-label="Buscar producto" className={campo} />
        <label className="flex items-center gap-3 text-sm min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={soloConOferta} onChange={(e) => setSoloConOferta(e.target.checked)}
                 className="w-5 h-5 accent-[var(--color-marca-500)]" />
          Ver solo los que ya tienen oferta
        </label>
        <label className="flex items-center gap-3 text-sm font-medium min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={todosVisibles}
                 onChange={() => setMarcados((m) => {
                   const n = new Set(m);
                   for (const p of visibles) { if (todosVisibles) n.delete(p.id); else n.add(p.id); }
                   return n;
                 })}
                 className="w-5 h-5 accent-[var(--color-marca-500)]" />
          {todosVisibles ? 'Desmarcar' : 'Marcar'} los {visibles.length} de la lista
        </label>

        <ul className="divide-y divide-[var(--borde)] tarjeta" aria-label="Productos">
          {visibles.map((p) => {
            const actuales = ofertas.get(p.id) ?? [];
            const v = marcados.has(p.id) ? vistaPrevia(p) : null;
            return (
              <li key={p.id}>
                <label className="flex items-start gap-3 px-3 py-2 min-h-[52px] cursor-pointer">
                  <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)}
                         aria-label={p.nombre}
                         className="mt-1 w-5 h-5 shrink-0 accent-[var(--color-marca-500)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{p.nombre}</span>
                    <span className="block text-xs text-[var(--texto-suave)] num">
                      {formatCLP(p.precioVenta)}
                      {actuales.length > 0 && ` · hoy: ${actuales.map((t) =>
                        `desde ${String(t.desde).replace('.', ',')} ${describirTramo(t)}`).join('; ')}`}
                    </span>
                    {v && 'precio' in v && oferta.tramo && (
                      <span className="block text-xs text-marca-700 font-medium num">
                        → desde {String(oferta.tramo.desde).replace('.', ',')}: {formatCLP(v.precio)} c/u
                      </span>
                    )}
                    {v && 'salta' in v && (
                      <span className="block text-xs text-[var(--color-alerta)]">Se salta: {v.salta}</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
          {visibles.length === 0 && !cargando && (
            <li className="p-4 text-sm text-[var(--texto-suave)]">No hay productos con ese filtro.</li>
          )}
        </ul>
      </section>

      {/* Acciones, siempre a mano en el celular. Encima de la barra inferior de
          navegación (lg:hidden, fixed bottom-0), no debajo de ella. ---------- */}
      <div data-acciones className="fixed inset-x-0 lg:left-60 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:bottom-0 z-30 bg-white border-t border-[var(--borde)] px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-2">
          <button
            onClick={() => setConfirmando('quitar')}
            disabled={guardando || conOfertaElegidos === 0}
            className="tap px-3 rounded-xl border border-[var(--borde)] text-sm font-medium disabled:opacity-50">
            Quitar ofertas
          </button>
          <button
            onClick={() => setConfirmando('aplicar')}
            disabled={guardando || !oferta.tramo || marcados.size === 0 || seSaltan === marcados.size}
            className="tap flex-1 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
            Aplicar a {marcados.size - seSaltan} {marcados.size - seSaltan === 1 ? 'producto' : 'productos'}
          </button>
        </div>
      </div>

      {confirmando === 'aplicar' && oferta.tramo && (
        <Modal titulo="¿Aplicar la oferta?" encabezado="visible" onCerrar={() => setConfirmando(null)} bloqueado={guardando}>
          <div className="p-5 space-y-3 text-sm">
            <p>
              <strong>Desde {String(oferta.tramo.desde).replace('.', ',')} unidades, {describirTramo(oferta.tramo)}</strong>
              {oferta.tramo.vigenteDesde || oferta.tramo.vigenteHasta
                ? `, del ${oferta.tramo.vigenteDesde ?? 'hoy'} al ${oferta.tramo.vigenteHasta ?? 'sin término'}` : ''}
              {' '}a {marcados.size - seSaltan} {marcados.size - seSaltan === 1 ? 'producto' : 'productos'}.
            </p>
            {seSaltan > 0 && <p>Se saltan {seSaltan}: la oferta no es más barata que su precio normal.</p>}
            <button onClick={() => void aplicar()} disabled={guardando}
                    className="tap w-full py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
              {guardando ? 'Aplicando…' : 'Sí, aplicar'}
            </button>
          </div>
        </Modal>
      )}
      {confirmando === 'quitar' && (
        <Modal titulo="¿Quitar las ofertas?" encabezado="visible" onCerrar={() => setConfirmando(null)} bloqueado={guardando}>
          <div className="p-5 space-y-3 text-sm">
            <p>
              Se quitan <strong>todas</strong> las ofertas de {conOfertaElegidos}{' '}
              {conOfertaElegidos === 1 ? 'producto' : 'productos'}, y vuelven a su precio normal.
            </p>
            <button onClick={() => void quitar()} disabled={guardando}
                    className="tap w-full py-3 rounded-xl bg-[var(--color-alerta)] text-white font-bold disabled:opacity-50">
              {guardando ? 'Quitando…' : 'Sí, quitar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
