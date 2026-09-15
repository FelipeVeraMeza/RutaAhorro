'use client';

import { useState } from 'react';
import { formatCLP, change, parseCLP } from '@rutaahorro/core';

type Metodo = 'efectivo' | 'debito' | 'credito' | 'transferencia';

const METODOS: Array<{ id: Metodo; label: string; icon: string }> = [
  { id: 'efectivo',      label: 'Efectivo',      icon: '💵' },
  { id: 'debito',        label: 'Débito',        icon: '💳' },
  { id: 'credito',       label: 'Crédito',       icon: '💳' },
  { id: 'transferencia', label: 'Transferencia', icon: '📱' },
];

/** Montos frecuentes para cobrar en efectivo sin teclear. */
function sugerencias(total: number): number[] {
  const billetes = [1000, 2000, 5000, 10000, 20000];
  const opciones = new Set<number>([total]);
  for (const b of billetes) {
    const redondeo = Math.ceil(total / b) * b;
    if (redondeo >= total) opciones.add(redondeo);
  }
  return [...opciones].sort((a, b) => a - b).slice(0, 4);
}

export function Cobro({
  total, onCancel, onConfirm,
}: {
  total: number;
  onCancel: () => void;
  onConfirm: (payments: Array<{ method: string; amount: number; received_amount?: number }>) => void;
}) {
  const [metodo, setMetodo] = useState<Metodo>('efectivo');
  const [recibido, setRecibido] = useState('');
  const [enviando, setEnviando] = useState(false);

  const montoRecibido = parseCLP(recibido) ?? 0;
  const vuelto = change(montoRecibido, total);
  const faltante = Math.max(total - montoRecibido, 0);
  const puedeConfirmar = metodo !== 'efectivo' || montoRecibido >= total;

  function confirmar() {
    if (!puedeConfirmar || enviando) return;
    setEnviando(true);
    onConfirm([
      metodo === 'efectivo'
        ? { method: 'efectivo', amount: total, received_amount: montoRecibido }
        : { method: metodo, amount: total },
    ]);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" role="dialog" aria-modal="true" aria-label="Cobrar">
      <div className="w-full bg-white rounded-t-2xl p-4 pb-6" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Cobrar</h2>
          <button onClick={onCancel} className="tap px-3 text-sm text-[var(--texto-suave)]">
            Cancelar
          </button>
        </div>

        <p className="text-center num text-3xl font-bold mb-4">{formatCLP(total)}</p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {METODOS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMetodo(m.id)}
              aria-pressed={metodo === m.id}
              className={`tap py-3 rounded-xl text-sm font-medium border-2 flex items-center justify-center gap-1.5 ${
                metodo === m.id
                  ? 'border-marca-500 bg-marca-50 text-marca-900'
                  : 'border-[var(--borde)] bg-white'
              }`}
            >
              <span aria-hidden>{m.icon}</span>
              {m.label}
              {metodo === m.id && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>

        {metodo === 'efectivo' && (
          <div className="mb-4">
            <label htmlFor="recibido" className="block text-sm font-medium mb-1.5">
              ¿Con cuánto paga?
            </label>
            <input
              id="recibido"
              type="text"
              inputMode="numeric"
              value={recibido}
              onChange={(e) => setRecibido(e.target.value)}
              placeholder="0"
              className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] text-xl num text-right"
            />

            <div className="flex gap-2 mt-2 overflow-x-auto sin-scrollbar">
              {sugerencias(total).map((monto) => (
                <button
                  key={monto}
                  onClick={() => setRecibido(String(monto))}
                  className="tap px-3 py-2 rounded-lg border border-[var(--borde)] text-sm num whitespace-nowrap"
                >
                  {formatCLP(monto)}
                </button>
              ))}
            </div>

            <div className="mt-3 px-4 py-3 rounded-xl bg-[var(--fondo)] flex items-center justify-between">
              {faltante > 0 ? (
                <>
                  <span className="text-sm text-[var(--color-aviso)]">Falta</span>
                  <span className="num text-lg font-bold text-[var(--color-aviso)]">
                    {formatCLP(faltante)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm">Vuelto</span>
                  <span className="num text-2xl font-bold text-marca-700">{formatCLP(vuelto)}</span>
                </>
              )}
            </div>
          </div>
        )}

        <button
          onClick={confirmar}
          disabled={!puedeConfirmar || enviando}
          className="tap w-full py-4 rounded-xl bg-marca-500 text-white font-bold text-lg active:bg-marca-600 disabled:opacity-40"
        >
          {enviando ? 'Registrando…' : 'Confirmar venta'}
        </button>
      </div>
    </div>
  );
}
