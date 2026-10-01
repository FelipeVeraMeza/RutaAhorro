'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  sugerirCompra, costoEstimado, textoPedido, formatCLP, formatCantidad, toUserMessage, aCSV,
  type LineaSugerida, validarCantidadStock
} from '@rutaahorro/core';
import { repoProductos } from '@/lib/productos';
import { ultimoProveedorPorProducto } from '@/lib/datos/proveedores';
import { EstadoVacio } from '@/components/Encabezado';
import { Icono } from '@/components/Icono';

/**
 * Orden de compra sugerida (RF-M3-11): lo que está bajo el mínimo y cuánto
 * pedir para quedar holgado, listo para copiar o mandar por WhatsApp.
 *
 * Antes el Inicio decía "bajo stock mínimo" y ahí terminaba: el pedido se
 * armaba a mano mirando la lista, y lo que no cabía en las ocho filas del
 * panel se olvidaba.
 */
export function QueComprar({ local, verCostos }: { local: string; verCostos: boolean }) {
  const [lineas, setLineas] = useState<LineaSugerida[] | null>(null);
  const [fuera, setFuera] = useState<Set<string>>(new Set());
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  // RF-M3-12 · el proveedor de la última recepción de cada producto.
  const [proveedorDe, setProveedorDe] = useState<Map<string, { id: string; nombre: string }>>(new Map());
  const [proveedorElegido, setProveedorElegido] = useState('');
  useEffect(() => { void ultimoProveedorPorProducto().then(setProveedorDe).catch(() => {}); }, []);

  useEffect(() => {
    void repoProductos().listar({ soloActivos: true, limite: 5000 }, verCostos)
      .then((ps) => setLineas(sugerirCompra(ps.map((p) => ({
        id: p.id, nombre: p.nombre, stock: p.stock, minimo: p.stockMinimo, unidad: p.unidad,
        costo: typeof p.costoPromedio === 'number' ? p.costoPromedio : null,
      })))))
      .catch((e) => setError(toUserMessage(e)));
  }, [verCostos]);

  // Lo que se va a pedir: las marcadas, con la cantidad que haya escrito.
  const enVista = useMemo(() => (lineas ?? [])
    .filter((l) => !proveedorElegido || (proveedorElegido === 'sin' ? !proveedorDe.has(l.id) : proveedorDe.get(l.id)?.id === proveedorElegido)),
  [lineas, proveedorElegido, proveedorDe]);
  const pedido = useMemo(() => enVista
    .filter((l) => !fuera.has(l.id))
    .flatMap((l) => {
      // Lo escrito manda: con 0, vacío o mal escrito antes se mandaba igual la
      // cantidad sugerida, y el proveedor traía lo que no se pidió.
      if (cantidades[l.id] === undefined) return [l];
      const v = validarCantidadStock(cantidades[l.id], l.unidad);
      return v.valido && v.valor > 0 ? [{ ...l, pedir: v.valor }] : [];
    }), [enVista, fuera, cantidades]);

  const proveedores = useMemo(() => {
    const m = new Map<string, { nombre: string; n: number }>();
    for (const l of lineas ?? []) {
      const p = proveedorDe.get(l.id);
      if (p) m.set(p.id, { nombre: p.nombre, n: (m.get(p.id)?.n ?? 0) + 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [lineas, proveedorDe]);

  if (error) return <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>;
  if (!lineas) return <p className="text-sm text-[var(--texto-suave)] py-6 text-center">Revisando el stock…</p>;
  if (lineas.length === 0) {
    return (
      <EstadoVacio icono="listo" titulo="No hay nada bajo el mínimo"
        texto="Cuando un producto baje de su stock mínimo aparece acá con cuánto pedir. El mínimo se pone en cada producto." />
    );
  }

  const texto = textoPedido(pedido, local);
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2500); }
    catch { setError('No se pudo copiar. Mantén presionado el texto para copiarlo.'); }
  }
  function exportar() {
    const csv = aCSV(pedido, [
      { titulo: 'producto', valor: (l) => l.nombre },
      { titulo: 'stock', valor: (l) => l.stock },
      { titulo: 'minimo', valor: (l) => l.minimo },
      { titulo: 'pedir', valor: (l) => l.pedir },
      { titulo: 'unidad', valor: (l) => l.unidad ?? 'unidad' },
      ...(verCostos ? [{ titulo: 'costo_estimado', valor: (l: LineaSugerida) => Math.round((l.costo ?? 0) * l.pedir) }] : []),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `pedido-sugerido.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--texto-suave)]">
        Lo que está bajo su mínimo, con lo que falta para llegar al doble del mínimo. Cambia la cantidad
        si quieres, o desmarca lo que no vas a pedir.
      </p>
      {proveedores.length > 0 && (
        <label className="block text-sm">
          <span className="text-[var(--texto-suave)]">Pedido para</span>
          <select value={proveedorElegido} onChange={(e) => setProveedorElegido(e.target.value)}
            className="tap w-full mt-1 px-3 rounded-xl border border-[var(--borde)] bg-white">
            <option value="">Todos los proveedores</option>
            {proveedores.map(([id, p]) => <option key={id} value={id}>{p.nombre} ({p.n})</option>)}
            <option value="sin">Sin proveedor conocido</option>
          </select>
        </label>
      )}
      <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
        {enVista.map((l) => {
          const incluido = !fuera.has(l.id);
          return (
            <li key={l.id} className={`px-3 py-2.5 flex items-center gap-3 ${incluido ? '' : 'opacity-50'}`}>
              <input type="checkbox" checked={incluido} aria-label={`Pedir ${l.nombre}`} className="w-5 h-5 shrink-0"
                onChange={() => setFuera((f) => { const n = new Set(f); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{l.nombre}</p>
                {proveedorDe.get(l.id) && <p className="text-[11px] text-[var(--texto-suave)]">Último proveedor: {proveedorDe.get(l.id)!.nombre}</p>}
                <p className="text-xs num">
                  <span className={`insignia ${l.stock <= 0 ? 'insignia-alerta' : 'insignia-aviso'}`}>{l.stock <= 0 ? 'Agotado' : 'Bajo'}</span>
                  <span className="text-[var(--texto-suave)]"> hay {formatCantidad(l.stock)} · mínimo {formatCantidad(l.minimo)}</span>
                </p>
              </div>
              <label className="shrink-0 text-right">
                <span className="block text-[11px] text-[var(--texto-suave)]">Pedir</span>
                <input inputMode="decimal" value={cantidades[l.id] ?? formatCantidad(l.pedir)} disabled={!incluido}
                  onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: e.target.value }))}
                  aria-label={`Cantidad a pedir de ${l.nombre}`}
                  className="tap w-20 px-2 rounded-lg border border-[var(--borde)] num text-right" />
                {incluido && cantidades[l.id] !== undefined && !(validarCantidadStock(cantidades[l.id], l.unidad).valor > 0) && (
                  <span role="alert" className="block text-[11px] text-[var(--color-alerta)] max-w-[7rem]">No va en el pedido</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="tarjeta p-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <strong>{pedido.length}</strong> {pedido.length === 1 ? 'producto' : 'productos'} en el pedido
          {verCostos && costoEstimado(pedido) > 0 && <> · costo estimado <strong className="num">{formatCLP(costoEstimado(pedido))}</strong></>}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer"
           className={`btn btn-primario ${pedido.length ? '' : 'pointer-events-none opacity-50'}`}>
          Enviar por WhatsApp
        </a>
        <button onClick={() => void copiar()} disabled={!pedido.length} className="btn btn-secundario">
          <Icono nombre="copiar" tamano={18} /> {copiado ? 'Copiado ✓' : 'Copiar el pedido'}
        </button>
        <button onClick={exportar} disabled={!pedido.length} className="btn btn-secundario">
          <Icono nombre="descargar" tamano={18} /> Exportar a Excel
        </button>
      </div>
    </div>
  );
}
