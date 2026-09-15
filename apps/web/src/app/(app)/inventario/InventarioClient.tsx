'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCLP, toUserMessage } from '@rutaahorro/core';
import { repoProductos, type Producto } from '@/lib/productos';
import {
  repoInventario, ETIQUETA_MOVIMIENTO, MOTIVOS_SUGERIDOS, type Movimiento,
} from '@/lib/datos/inventario';

type Vista = 'stock' | 'kardex' | 'toma';

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Santiago',
  });

export function InventarioClient({
  puedeAjustar, verCostos,
}: {
  puedeAjustar: boolean;
  verCostos: boolean;
}) {
  const [vista, setVista] = useState<Vista>('stock');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [ajustando, setAjustando] = useState<Producto | null>(null);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [aplicandoToma, setAplicandoToma] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [ps, ms] = await Promise.all([
        repoProductos().listar({ busqueda }, verCostos),
        repoInventario().kardex(null, 80),
      ]);
      setProductos(ps);
      setMovimientos(ms);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setCargando(false);
    }
  }, [busqueda, verCostos]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 200);
    return () => clearTimeout(t);
  }, [cargar]);

  const valorTotal = productos.reduce(
    (s, p) => s + Math.round(p.stock * (p.costoPromedio ?? 0)), 0,
  );
  const bajoMinimo = productos.filter((p) => p.stockMinimo > 0 && p.stock <= p.stockMinimo).length;

  async function aplicarToma() {
    const items = Object.entries(conteo)
      .filter(([, v]) => v.trim() !== '')
      .map(([productoId, v]) => ({ productoId, contado: Number(v) }))
      .filter((i) => Number.isFinite(i.contado));

    if (items.length === 0) return;
    setAplicandoToma(true);
    setError(null);
    try {
      const r = await repoInventario().aplicarToma(items);
      setExito(
        r.diferencias === 0
          ? 'El conteo cuadró con el sistema: no hubo diferencias'
          : `${r.diferencias} ${r.diferencias === 1 ? 'producto ajustado' : 'productos ajustados'} · ${formatCLP(Math.abs(r.valorDiferencia))} de diferencia`,
      );
      setConteo({});
      setVista('stock');
      await cargar();
      setTimeout(() => setExito(null), 8000);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setAplicandoToma(false);
    }
  }

  const contados = Object.values(conteo).filter((v) => v.trim() !== '').length;

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg font-semibold mb-3">Inventario</h1>

      <div className="flex gap-2 mb-4 overflow-x-auto sin-scrollbar" role="tablist">
        {([
          ['stock', 'Stock'],
          ['kardex', 'Movimientos'],
          ...(puedeAjustar ? [['toma', 'Toma de inventario'] as const] : []),
        ] as const).map(([id, label]) => (
          <button
            key={id} role="tab" aria-selected={vista === id}
            onClick={() => setVista(id as Vista)}
            className={`tap px-4 py-2 rounded-lg text-sm border shrink-0 ${
              vista === id
                ? 'border-marca-500 bg-marca-50 text-marca-900 font-medium'
                : 'border-[var(--borde)] bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {exito && (
        <p role="status" className="text-sm bg-marca-50 text-marca-900 px-3 py-2 rounded-lg mb-3">
          ✅ {exito}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------ STOCK */}
      {vista === 'stock' && (
        <>
          {verCostos && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="tarjeta p-3">
                <p className="text-[11px] text-[var(--texto-suave)]">Valor al costo</p>
                <p className="num text-lg font-bold">{formatCLP(valorTotal)}</p>
              </div>
              <div className="tarjeta p-3">
                <p className="text-[11px] text-[var(--texto-suave)]">Bajo mínimo</p>
                <p className={`num text-lg font-bold ${bajoMinimo > 0 ? 'text-[var(--color-aviso)]' : ''}`}>
                  {bajoMinimo}
                </p>
              </div>
            </div>
          )}

          <input
            type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto…"
            className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white mb-3"
          />

          {cargando ? (
            <p className="text-sm text-[var(--texto-suave)] text-center py-6">Cargando…</p>
          ) : (
            <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
              {productos.map((p) => {
                const agotado = p.stock <= 0;
                const bajo = !agotado && p.stockMinimo > 0 && p.stock <= p.stockMinimo;
                return (
                  <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.nombre}</p>
                      <p className={`text-xs num ${
                        agotado ? 'text-[var(--color-alerta)]'
                        : bajo ? 'text-[var(--color-aviso)]'
                        : 'text-[var(--texto-suave)]'
                      }`}>
                        {agotado ? '🔴 Agotado' : bajo ? '🟠 Bajo' : '🟢 Normal'}
                        {' · '}{p.stock} {p.unidad}
                        {p.stockMinimo > 0 && ` (mín. ${p.stockMinimo})`}
                        {verCostos && typeof p.costoPromedio === 'number' &&
                          ` · ${formatCLP(Math.round(p.stock * p.costoPromedio))}`}
                      </p>
                    </div>
                    {puedeAjustar && (
                      <button
                        onClick={() => setAjustando(p)}
                        className="tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)] shrink-0"
                      >
                        Ajustar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* ----------------------------------------------------------- KARDEX */}
      {vista === 'kardex' && (
        <>
          <p className="text-xs text-[var(--texto-suave)] mb-3">
            Historial completo e inmutable. Un movimiento nunca se edita ni se borra:
            si algo se corrige, se agrega el movimiento contrario.
          </p>
          {movimientos.length === 0 ? (
            <p className="text-center text-sm text-[var(--texto-suave)] py-8">
              Todavía no hay movimientos registrados
            </p>
          ) : (
            <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
              {movimientos.map((m) => (
                <li key={m.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{m.productoNombre}</p>
                      <p className="text-xs text-[var(--texto-suave)]">
                        {ETIQUETA_MOVIMIENTO[m.tipo]} · {fechaHora(m.fecha)}
                        {m.usuario && ` · ${m.usuario}`}
                      </p>
                      {m.motivo && (
                        <p className="text-xs text-[var(--texto-suave)] italic truncate">{m.motivo}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`num font-semibold ${
                        m.cantidad < 0 ? 'text-[var(--color-alerta)]' : 'text-marca-700'
                      }`}>
                        {m.cantidad > 0 ? '+' : ''}{m.cantidad}
                      </p>
                      <p className="text-[11px] text-[var(--texto-suave)] num">saldo {m.saldo}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ------------------------------------------------------------- TOMA */}
      {vista === 'toma' && (
        <>
          <p className="text-xs text-[var(--texto-suave)] mb-3">
            Cuenta físicamente y anota lo que encuentres. Los productos que dejes en
            blanco no se tocan, así que puedes contar por partes.
          </p>

          <input
            type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Filtrar productos a contar…"
            className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white mb-3"
          />

          <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden mb-4">
            {productos.map((p) => {
              const valor = conteo[p.id] ?? '';
              const dif = valor.trim() === '' ? null : Number(valor) - p.stock;
              return (
                <li key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{p.nombre}</p>
                    <p className="text-xs text-[var(--texto-suave)] num">
                      Sistema: {p.stock} {p.unidad}
                      {dif !== null && dif !== 0 && (
                        <span className={dif < 0 ? 'text-[var(--color-alerta)]' : 'text-[var(--color-aviso)]'}>
                          {' · '}{dif > 0 ? '+' : ''}{dif}
                        </span>
                      )}
                      {dif === 0 && <span className="text-marca-700"> · cuadra</span>}
                    </p>
                  </div>
                  <input
                    inputMode="decimal" value={valor}
                    onChange={(e) => setConteo((c) => ({ ...c, [p.id]: e.target.value }))}
                    placeholder="—"
                    className="tap w-20 px-2 py-2 rounded-lg border border-[var(--borde)] num text-right shrink-0"
                    aria-label={`Conteo de ${p.nombre}`}
                  />
                </li>
              );
            })}
          </ul>

          <div className="sticky bottom-20 lg:bottom-4">
            <button
              onClick={() => void aplicarToma()}
              disabled={contados === 0 || aplicandoToma}
              className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-40 shadow-lg"
            >
              {aplicandoToma
                ? 'Aplicando…'
                : contados === 0
                  ? 'Anota al menos un conteo'
                  : `Aplicar toma de ${contados} ${contados === 1 ? 'producto' : 'productos'}`}
            </button>
          </div>
        </>
      )}

      {ajustando && (
        <DialogoAjuste
          producto={ajustando}
          onListo={() => { setAjustando(null); void cargar(); }}
          onCancelar={() => setAjustando(null)}
        />
      )}
    </div>
  );
}

function DialogoAjuste({
  producto, onListo, onCancelar,
}: {
  producto: Producto;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [cantidad, setCantidad] = useState(String(producto.stock));
  const [motivo, setMotivo] = useState('');
  const [esMerma, setEsMerma] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nueva = Number(cantidad);
  const delta = Number.isFinite(nueva) ? nueva - producto.stock : 0;

  async function guardar() {
    setError(null);
    if (motivo.trim() === '') { setError('El motivo es obligatorio'); return; }
    if (delta === 0) { setError('La cantidad es la misma: no hay nada que ajustar'); return; }

    setGuardando(true);
    try {
      await repoInventario().ajustar({
        productoId: producto.id,
        nuevaCantidad: nueva,
        tipo: esMerma ? 'merma' : delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo',
        motivo: motivo.trim(),
      });
      onListo();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
           style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Ajustar stock</h2>
          <button onClick={onCancelar} className="tap px-3 text-sm text-[var(--texto-suave)]">Cancelar</button>
        </div>

        <p className="text-sm">{producto.nombre}</p>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Cantidad real <span className="text-[var(--texto-suave)] font-normal">(sistema: {producto.stock})</span>
          </label>
          <input
            inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)}
            className="tap w-full px-3 py-3 rounded-xl border border-[var(--borde)] num text-right text-lg"
            autoFocus
          />
          {delta !== 0 && Number.isFinite(nueva) && (
            <p className={`text-sm num mt-1.5 ${delta < 0 ? 'text-[var(--color-alerta)]' : 'text-marca-700'}`}>
              {delta > 0 ? 'Se sumarán' : 'Se restarán'} {Math.abs(delta)} {producto.unidad}
            </p>
          )}
        </div>

        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox" checked={esMerma} onChange={(e) => setEsMerma(e.target.checked)}
            className="w-5 h-5 accent-[var(--color-marca-500)]"
          />
          Registrar como <strong>merma</strong> (producto perdido)
        </label>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Motivo <span className="text-[var(--color-alerta)]">*</span>
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {MOTIVOS_SUGERIDOS.map((m) => (
              <button
                key={m} onClick={() => setMotivo(m)}
                className={`tap px-2.5 py-1.5 rounded-lg text-xs border ${
                  motivo === m ? 'border-marca-500 bg-marca-50' : 'border-[var(--borde)]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="…o escribe otro motivo"
            className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button
          onClick={() => void guardar()} disabled={guardando}
          className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Registrar ajuste'}
        </button>

        <p className="text-[11px] text-[var(--texto-suave)]">
          El ajuste queda en el historial con tu nombre y el motivo. No se puede
          editar ni borrar después.
        </p>
      </div>
    </div>
  );
}
