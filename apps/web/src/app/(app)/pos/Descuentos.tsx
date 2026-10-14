'use client';

import { useEffect, useState } from 'react';
import { formatCLP, formatCantidad, formatPct, toUserMessage, validarMonto, validarCantidad, type CartLine } from '@rutaahorro/core';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { repoAutorizaciones, type Autorizador } from '@/lib/datos/autorizaciones';

/** La autorización que dio John o María José para esta venta (0036). */
export interface AutorizacionVigente {
  id: string;
  pct: number;
  nombre: string;
}

/**
 * Descuento a una línea (RQ-15), en pesos o en porcentaje. Si pasa el tope de
 * quien vende, se pide autorización al cobrar: acá no se bloquea, porque el
 * descuento lo decide el que autoriza, no el vendedor.
 */
export function DescuentoLinea({ linea, onAplicar, onCerrar }: {
  linea: CartLine;
  onAplicar: (monto: number) => void;
  onCerrar: () => void;
}) {
  const bruto = Math.round(linea.unitPrice * linea.quantity);
  const [modo, setModo] = useState<'pesos' | 'pct'>('pesos');
  const [texto, setTexto] = useState(linea.discountAmount ? String(linea.discountAmount) : '');
  const vPesos = validarMonto(texto, { etiqueta: 'descuento', permiteVacio: true, maximo: bruto });
  const vPct = validarCantidad(texto, { permiteVacio: true, maximo: 100 });
  const monto = modo === 'pesos'
    ? (vPesos.valido ? vPesos.valor : 0)
    : (vPct.valido ? Math.round((bruto * vPct.valor) / 100) : 0);
  const error = texto.trim() === '' ? null : modo === 'pesos' ? (vPesos.valido ? null : vPesos.error) : (vPct.valido ? null : vPct.error);

  return (
    <Modal titulo={`Descuento · ${linea.name}`} encabezado="visible" onCerrar={onCerrar}>
      <div className="p-5 space-y-3">
        <p className="text-sm text-[var(--texto-suave)] num">
          {formatCantidad(linea.quantity)} × {formatCLP(linea.unitPrice)} = {formatCLP(bruto)}
        </p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Descuento en">
          {([['pesos', 'En pesos ($)'], ['pct', 'En porcentaje (%)']] as const).map(([id, t]) => (
            <button key={id} type="button" role="radio" aria-checked={modo === id} onClick={() => { setModo(id); setTexto(''); }}
                    className={`tap rounded-xl border text-sm ${modo === id ? 'border-marca-500 bg-marca-50 font-medium' : 'border-[var(--borde)]'}`}>
              {t}
            </button>
          ))}
        </div>
        <Campo etiqueta={modo === 'pesos' ? 'Cuánto se descuenta ($)' : 'Cuánto se descuenta (%)'} error={error}>
          {(p) => <input {...p} inputMode="numeric" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus
                         className="tap w-full px-3 rounded-xl border border-[var(--borde)] num text-right text-lg" />}
        </Campo>
        {monto > 0 && !error && (
          <p role="status" className="text-sm num">
            Queda en <strong>{formatCLP(bruto - monto)}</strong> ({formatPct((monto * 100) / bruto)} menos)
          </p>
        )}
        <div className="flex gap-2">
          {(linea.discountAmount ?? 0) > 0 && (
            <button type="button" onClick={() => onAplicar(0)} className="tap px-4 rounded-xl border border-[var(--borde)] text-sm">
              Quitar descuento
            </button>
          )}
          <button type="button" disabled={Boolean(error) || monto <= 0} onClick={() => onAplicar(monto)}
                  className="tap flex-1 py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-40">
            Aplicar descuento
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * RQ-17 · John o María José escriben su PIN en el celular del vendedor, sin
 * que él cierre su sesión. La autorización sirve para esta venta y por 15
 * minutos (0036).
 */
export function PedirAutorizacion({ pct, tope, onAutorizado, onCerrar }: {
  pct: number;
  tope: number;
  onAutorizado: (a: AutorizacionVigente) => void;
  onCerrar: () => void;
}) {
  const [autorizadores, setAutorizadores] = useState<Autorizador[] | null>(null);
  const [quien, setQuien] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Hacia arriba, a la centésima: la base compara con el porcentaje exacto.
  const pedido = Math.ceil(pct * 100) / 100;

  useEffect(() => {
    void repoAutorizaciones().autorizadores()
      .then((l) => { setAutorizadores(l); if (l.length === 1) setQuien(l[0].id); })
      .catch((e) => { setAutorizadores([]); setError(toUserMessage(e)); });
  }, []);

  async function autorizar() {
    setError(null);
    if (!navigator.onLine) { setError('Para autorizar se necesita internet: el PIN se revisa en el sistema'); return; }
    if (!quien) { setError('Elige quién autoriza'); return; }
    if (!/^\d{4,6}$/.test(pin)) { setError('El PIN son 4 a 6 números'); return; }
    setEnviando(true);
    try {
      const id = await repoAutorizaciones().autorizar({ autorizadorId: quien, pin, pct: pedido });
      onAutorizado({ id, pct: pedido, nombre: autorizadores?.find((a) => a.id === quien)?.nombre ?? '' });
    } catch (e) {
      setPin('');
      setError(toUserMessage(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Autorizar descuento" encabezado="visible" onCerrar={onCerrar} bloqueado={enviando}>
      <div className="p-5 space-y-3">
        <p className="text-sm">
          El descuento es de <strong className="num">{formatPct(pct)}</strong> y tu tope es{' '}
          <strong className="num">{formatPct(tope)}</strong>. Que lo autorice el administrador o un supervisor con su PIN.
        </p>
        {autorizadores === null ? (
          <p className="text-sm text-[var(--texto-suave)]">Cargando…</p>
        ) : autorizadores.length === 0 ? (
          <p className="text-sm text-[var(--color-aviso)]">
            Nadie tiene PIN todavía. El administrador lo crea en Mi cuenta → "PIN para autorizar descuentos".
          </p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Quién autoriza" className="space-y-2">
              {autorizadores.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={quien === a.id} onClick={() => setQuien(a.id)}
                        disabled={a.tope + 0.01 < pedido}
                        className={`tap w-full px-3 rounded-xl border text-left text-sm disabled:opacity-50 ${quien === a.id ? 'border-marca-500 bg-marca-50 font-medium' : 'border-[var(--borde)]'}`}>
                  {a.nombre}
                  <span className="text-xs text-[var(--texto-suave)] num"> · autoriza hasta {formatPct(a.tope)}</span>
                </button>
              ))}
            </div>
            <Campo etiqueta="PIN de quien autoriza">
              {(p) => <input {...p} type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                             value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                             onKeyDown={(e) => { if (e.key === 'Enter') void autorizar(); }}
                             className="tap w-full px-3 rounded-xl border border-[var(--borde)] num text-lg tracking-widest" />}
            </Campo>
          </>
        )}
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button type="button" onClick={() => void autorizar()} disabled={enviando || !autorizadores?.length}
                className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-40">
          {enviando ? 'Revisando…' : `Autorizar ${formatPct(pedido)} y cobrar`}
        </button>
      </div>
    </Modal>
  );
}
