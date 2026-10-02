'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCLP, toUserMessage, validarMonto, validarCombo, coincide, validarCantidadVenta } from '@rutaahorro/core';
import { repoCombos, type ComboEditable } from '@/lib/datos/combos';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { repoProductos, type Producto } from '@/lib/productos';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { Encabezado } from '@/components/Encabezado';
import { Icono } from '@/components/Icono';

/**
 * Combos entre productos distintos (0023): «2 bebidas + 1 pan por $3.000».
 *
 * El POS los aplica solos cuando el carrito tiene los productos, las veces
 * que quepan. No se suman a las ofertas ni al precio de cliente: el combo
 * solo rebaja lo que todavía no estaba rebajado.
 */
export function CombosClient() {
  const config = useConfiguracion();
  const [combos, setCombos] = useState<ComboEditable[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [editando, setEditando] = useState<ComboEditable | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const [cs, ps] = await Promise.all([
        repoCombos().listar(),
        repoProductos().listar({ soloActivos: true, limite: 5000 }, false),
      ]);
      setCombos(cs);
      setProductos(ps);
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const normal = (c: Pick<ComboEditable, 'items'>) =>
    Math.round(c.items.reduce((s, i) => s + (porId.get(i.productId)?.precioVenta ?? 0) * i.cantidad, 0));

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-4" aria-busy={cargando}>
      <Encabezado
        titulo="Combos"
        volver={{ href: '/productos/ofertas', texto: 'Ofertas' }}
        descripcion="Varios productos a un precio (ej. 2 bebidas + 1 pan por $3.000). Vender lo aplica solo."
        acciones={
          <button onClick={() => setEditando('nuevo')} className="btn btn-primario btn-chico">
            <Icono nombre="agregar" tamano={16} /> Nuevo combo
          </button>
        }
      />

      {!config.ofertasActivas && (
        <p role="status" className="text-sm px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
          <strong>Las ofertas están apagadas en todo el local:</strong> los combos tampoco se aplican.
        </p>
      )}
      {aviso && (
        <p role={aviso.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm px-3 py-2 rounded-lg ${aviso.tipo === 'error' ? 'bg-red-50 text-red-900' : 'bg-marca-100 text-marca-900'}`}>
          {aviso.texto}
        </p>
      )}

      <ul className="space-y-2" aria-label="Combos">
        {combos.map((c) => {
          const n = normal(c);
          return (
            <li key={c.id}>
              <button onClick={() => setEditando(c)}
                      className={`tap w-full tarjeta px-3 py-2.5 text-left ${c.activo ? '' : 'opacity-60'}`}>
                <span className="flex justify-between gap-2">
                  <span className="font-medium">🎁 {c.nombre}</span>
                  <span className="num font-semibold">{formatCLP(c.precio)}</span>
                </span>
                <span className="block text-xs text-[var(--texto-suave)]">
                  {c.items.map((i) => `${String(i.cantidad).replace('.', ',')} × ${porId.get(i.productId)?.nombre ?? 'producto desactivado'}`).join(' + ')}
                </span>
                <span className="block text-xs text-marca-700 num">
                  Por separado {formatCLP(n)} · ahorra {formatCLP(Math.max(n - c.precio, 0))}
                  {c.vigenteHasta && ` · hasta el ${c.vigenteHasta.split('-').reverse().join('-')}`}
                  {!c.activo && ' · desactivado'}
                </span>
              </button>
            </li>
          );
        })}
        {!cargando && combos.length === 0 && (
          <li className="tarjeta p-4 text-sm text-[var(--texto-suave)]">
            Todavía no hay combos. Ej.: 2 bebidas + 1 pan por $3.000.
          </li>
        )}
      </ul>

      {editando && (
        <EditarCombo
          combo={editando === 'nuevo' ? null : editando}
          productos={productos}
          onCerrar={() => setEditando(null)}
          onGuardado={async (texto) => { setEditando(null); setAviso({ tipo: 'ok', texto }); await cargar(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function EditarCombo({ combo, productos, onCerrar, onGuardado }: {
  combo: ComboEditable | null;
  productos: Producto[];
  onCerrar: () => void;
  onGuardado: (texto: string) => void;
}) {
  const [nombre, setNombre] = useState(combo?.nombre ?? '');
  const [precio, setPrecio] = useState(combo ? combo.precio.toLocaleString('es-CL') : '');
  const [items, setItems] = useState<{ productId: string; cantidad: string }[]>(
    combo?.items.map((i) => ({ productId: i.productId, cantidad: String(i.cantidad).replace('.', ',') })) ?? []);
  const [conFechas, setConFechas] = useState(Boolean(combo?.vigenteDesde || combo?.vigenteHasta));
  const [desde, setDesde] = useState(combo?.vigenteDesde ?? '');
  const [hasta, setHasta] = useState(combo?.vigenteHasta ?? '');
  const [activo, setActivo] = useState(combo?.activo ?? true);
  const [buscar, setBuscar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const candidatos = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (q.length < 2) return [];
    return productos.filter((p) => !items.some((i) => i.productId === p.id) && coincide(p.nombre, q)).slice(0, 8);
  }, [productos, buscar, items]);

  const vPrecio = validarMonto(precio, { etiqueta: 'precio del combo', permiteCero: false, maximo: 50_000_000 });
  // Un producto que se vende por unidad no entra "1,5" al combo: con
  // validarCantidad a secas se aceptaba y el combo no se aplicaba nunca bien.
  const cantidades = items.map((i) => validarCantidadVenta(i.cantidad, porId.get(i.productId)?.unidad));
  const normal = Math.round(items.reduce((s, i, k) =>
    s + (porId.get(i.productId)?.precioVenta ?? 0) * (cantidades[k].valido ? cantidades[k].valor : 0), 0));

  async function guardar() {
    setError(null);
    // Apagar un combo no lo revalida (la base tampoco, 0037): si un producto
    // bajó de precio o se desactivó, el combo ya no "sale más barato" y antes
    // no había cómo dejar de aplicarlo.
    if (combo && !activo) {
      setGuardando(true);
      try {
        await repoCombos().guardar({ ...combo, activo: false });
        onGuardado(`Combo "${combo.nombre}" desactivado`);
      } catch (e) {
        setError(toUserMessage(e));
      } finally {
        setGuardando(false);
      }
      return;
    }
    const malo = cantidades.findIndex((c) => !c.valido);
    if (malo >= 0) { setError(`${porId.get(items[malo].productId)?.nombre}: ${cantidades[malo].error}`); return; }
    if (!vPrecio.valido) { setError(vPrecio.error); return; }
    const datos = {
      nombre: nombre.trim(), precio: vPrecio.valor, activo,
      vigenteDesde: conFechas ? desde || null : null, vigenteHasta: conFechas ? hasta || null : null,
      items: items.map((i, k) => ({ productId: i.productId, cantidad: cantidades[k].valor })),
    };
    const problema = validarCombo(datos, (id) => porId.get(id)?.precioVenta);
    if (problema) { setError(problema); return; }
    setGuardando(true);
    try {
      await repoCombos().guardar({ ...datos, id: combo?.id ?? null });
      onGuardado(`Combo "${datos.nombre}" guardado`);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={combo ? `Combo ${combo.nombre}` : 'Nuevo combo'} encabezado="visible" onCerrar={onCerrar} bloqueado={guardando}>
      <div className="p-4 space-y-3">
        <Campo etiqueta="Nombre del combo" obligatorio ayuda="Así aparece en el POS y en el ticket. Ej.: Once.">
          {(p) => <input {...p} value={nombre} onChange={(e) => setNombre(e.target.value)}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />}
        </Campo>

        <div>
          <p className="text-sm font-medium">Productos del combo</p>
          <ul className="space-y-2 mt-1">
            {items.map((i, k) => {
              const p = porId.get(i.productId);
              return (
                <li key={i.productId} className="flex items-center gap-2">
                  <input inputMode="decimal" value={i.cantidad}
                         aria-label={`Cantidad de ${p?.nombre ?? 'producto'}`}
                         onChange={(e) => setItems((xs) => xs.map((x, j) => (j === k ? { ...x, cantidad: e.target.value } : x)))}
                         className="tap w-16 px-2 rounded-lg border border-[var(--borde)] num text-right" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate">× {p?.nombre ?? 'Producto desactivado'}</span>
                    {p && <span className="block text-xs text-[var(--texto-suave)] num">{formatCLP(p.precioVenta)} c/u</span>}
                  </span>
                  <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== k))}
                          aria-label={`Sacar ${p?.nombre ?? 'producto'} del combo`}
                          className="tap px-2 text-sm text-[var(--color-alerta)]">Sacar</button>
                </li>
              );
            })}
          </ul>
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)}
                 placeholder="Agregar producto…" aria-label="Buscar producto para el combo"
                 className="tap w-full mt-2 px-3 rounded-lg border border-[var(--borde)]" />
          {candidatos.length > 0 && (
            <ul className="tarjeta mt-1 divide-y divide-[var(--borde)]">
              {candidatos.map((p) => (
                <li key={p.id}>
                  <button type="button" className="tap w-full px-3 text-left text-sm flex justify-between gap-2"
                          onClick={() => { setItems((xs) => [...xs, { productId: p.id, cantidad: '1' }]); setBuscar(''); }}>
                    <span className="truncate">{p.nombre}</span>
                    <span className="num text-[var(--texto-suave)]">{formatCLP(p.precioVenta)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Campo etiqueta="Precio del combo" obligatorio error={precio !== '' && !vPrecio.valido ? vPrecio.error : null}>
          {(p) => <input {...p} inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)}
                         className="tap w-36 px-3 rounded-lg border border-[var(--borde)] num text-right" />}
        </Campo>
        {items.length > 0 && (
          <p className={`text-sm num ${vPrecio.valido && vPrecio.valor < normal ? 'text-marca-700' : 'text-[var(--texto-suave)]'}`}>
            Por separado {formatCLP(normal)}
            {vPrecio.valido && vPrecio.valor < normal && ` · el cliente ahorra ${formatCLP(normal - vPrecio.valor)}`}
          </p>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[44px]">
          <input type="checkbox" checked={conFechas} onChange={(e) => setConFechas(e.target.checked)}
                 className="w-5 h-5 accent-[var(--color-marca-500)]" />
          Solo entre fechas
        </label>
        {conFechas && (
          <div className="grid grid-cols-2 gap-2">
            <label><span className="block text-xs mb-1">Desde el</span>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                     className="tap w-full px-2 rounded-lg border border-[var(--borde)] text-sm" /></label>
            <label><span className="block text-xs mb-1">Hasta el</span>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                     className="tap w-full px-2 rounded-lg border border-[var(--borde)] text-sm" /></label>
          </div>
        )}
        {combo && (
          <label className="flex items-center gap-3 text-sm min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)}
                   className="w-5 h-5 accent-[var(--color-marca-500)]" />
            Activo (desmarcar para dejar de aplicarlo)
          </label>
        )}
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void guardar()} disabled={guardando}
                className="tap w-full py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Guardar combo'}
        </button>
      </div>
    </Modal>
  );
}
