'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCLP, validarMonto, toUserMessage } from '@rutaahorro/core';
import { supabase } from '@/lib/supabase/client';
import { Campo } from '@/components/Campo';
import { Modal } from '@/components/Modal';
import { useFormatoFecha } from '@/lib/formatoFecha';

interface Session { id: string; opened_at: string; opening_amount: number }
interface Movimiento { id: string; type: string; amount: number; reason: string; created_at: string }
interface Cierre {
  session_id: string; full_name: string | null; opened_at: string;
  closed_at: string | null; difference: number | null; sales_total: number | null;
}

/** Caja abierta por otra persona. Solo la ve quien puede cerrarla. */
interface CajaAjena {
  session_id: string; full_name: string | null; opened_at: string;
  sales_total: number | null; expected_amount: number | null;
}


export function CajaClient({
  session, resumen, movimientos, historial, cajasAjenas = [],
}: {
  session: Session | null;
  resumen: Record<string, unknown> | null;
  movimientos: Movimiento[];
  historial: Cierre[];
  /** Cajas abiertas de otras personas. Vacío si quien mira no puede cerrarlas. */
  cajasAjenas?: CajaAjena[];
}) {
  const { hora, fecha } = useFormatoFecha();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [montoInicial, setMontoInicial] = useState('');
  const [vistaMovimiento, setVistaMovimiento] = useState<'ingreso' | 'egreso' | null>(null);
  const [movMonto, setMovMonto] = useState('');
  const [movMotivo, setMovMotivo] = useState('');
  const [cerrando, setCerrando] = useState(false);
  const [contado, setContado] = useState('');
  const [nota, setNota] = useState('');

  const [forzando, setForzando] = useState<CajaAjena | null>(null);
  const [contadoAjeno, setContadoAjeno] = useState('');
  const [notaAjena, setNotaAjena] = useState('');

  const esperado = Number(resumen?.expected_amount ?? 0);

  // Los tres campos de dinero pasan por `validarMonto` y no por `parseCLP`:
  // parseCLP acepta el signo menos, y un monto negativo aquí descuadra el
  // arqueo sin dejar rastro de que alguien escribió un "−". Ver docs/21 A-3.
  const inicial = validarMonto(montoInicial, { etiqueta: 'efectivo inicial', maximo: 5_000_000 });
  const cont = validarMonto(contado, { etiqueta: 'efectivo contado', maximo: 50_000_000 });
  const mov = validarMonto(movMonto, { permiteCero: false, maximo: 50_000_000 });
  const contAjeno = validarMonto(contadoAjeno, { etiqueta: 'efectivo contado', maximo: 50_000_000 });

  const diferencia = cont.valor - esperado;

  /** El query builder de Supabase es un thenable, no una Promise: por eso PromiseLike. */
  async function accion(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setCargando(true);
    setError(null);
    // Un corte de red lanza en vez de devolver `error`: sin el catch la
    // pantalla se quedaba en "Abriendo…" para siempre, sin decir nada, y la
    // caja no se había abierto.
    let e: { message: string } | null;
    try {
      ({ error: e } = await fn());
    } catch (err) {
      e = { message: err instanceof Error ? err.message : String(err) };
    }
    setCargando(false);
    if (e) { setError(toUserMessage(e)); return false; }
    router.refresh();
    return true;
  }

  // El diálogo de cierre forzado se arma una vez y se muestra en las dos vistas.
  // Antes solo existía en la vista de "caja abierta": un administrador sin su
  // propia caja abierta —el caso normal cuando viene a cerrar la de otro— veía
  // el botón "Cerrarla" y no pasaba nada. Encontrado con tools/ui/m6-caja.mjs.
  const dialogoForzar = forzando && (
    <Modal
      titulo={`Cerrar la caja de ${forzando.full_name ?? 'otro usuario'}`}
      encabezado="visible"
      onCerrar={() => setForzando(null)}
      bloqueado={cargando}
    >
      <div className="p-5 space-y-3">
        <p className="text-sm">
          Abierta el {fecha(forzando.opened_at)} a las {hora(forzando.opened_at)}
          {/* sin punto: la hora ya termina en "p. m." y quedaba "p. m.." */}
          {typeof forzando.expected_amount === 'number' && (
            <> Debería haber <strong className="num">{formatCLP(forzando.expected_amount)}</strong> en
            efectivo.</>
          )}
        </p>
        <p className="text-xs text-[var(--texto-suave)]">
          Cuenta el efectivo que hay ahora. El cierre queda a tu nombre y con tu
          explicación: quien abrió la caja no está para contarla, así que la diferencia
          tiene que poder justificarse después.
        </p>

        <Campo
          etiqueta="Efectivo contado"
          error={contadoAjeno.trim() !== '' && !contAjeno.valido ? contAjeno.error : null}
        >
          {(props) => (
            <input
              {...props}
              inputMode="numeric" value={contadoAjeno}
              onChange={(e) => setContadoAjeno(e.target.value)}
              className="tap w-full px-3 py-3 rounded-xl border border-[var(--borde)] num text-right text-lg"
              autoFocus
            />
          )}
        </Campo>

        <Campo etiqueta="Por qué la cierras tú" ayuda="Queda en el cierre.">
          {(props) => (
            <input
              {...props}
              value={notaAjena} onChange={(e) => setNotaAjena(e.target.value)}
              placeholder="Quedó abierta de ayer"
              className="tap w-full px-3 py-3 rounded-xl border border-[var(--borde)]"
            />
          )}
        </Campo>

        <div className="space-y-2 pt-1">
          <button
            disabled={cargando || !contAjeno.valido || notaAjena.trim() === ''}
            onClick={async () => {
              const ok = await accion(() =>
                supabase().rpc('fn_close_cash_session', {
                  p_session_id: forzando.session_id,
                  p_counted_amount: contAjeno.valor,
                  p_notes: notaAjena.trim(),
                }),
              );
              if (ok) setForzando(null);
            }}
            className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50"
          >
            {cargando ? 'Cerrando…' : 'Cerrar esa caja'}
          </button>
          <button
            onClick={() => setForzando(null)} disabled={cargando}
            className="tap w-full py-3 rounded-xl border border-[var(--borde)] disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );

  // ---------------------------------------------------------------- abrir
  if (!session) {
    return (
      <div className="px-4 py-6">
        <h1 className="text-lg font-semibold mb-1">Abrir caja</h1>
        <p className="text-sm text-[var(--texto-suave)] mb-5">
          Cuenta el efectivo con el que partes y decláralo. Es lo que permite saber al cierre si la caja cuadra.
        </p>

        <div className="tarjeta p-4">
          <label htmlFor="inicial" className="block text-sm font-medium mb-1.5">
            Efectivo inicial
          </label>
          <input
            id="inicial"
            type="text"
            inputMode="numeric"
            value={montoInicial}
            onChange={(e) => setMontoInicial(e.target.value)}
            placeholder="0"
            className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] text-xl num text-right"
          />
          {montoInicial !== '' && inicial.error && (
            <p role="alert" className="text-sm text-[var(--color-alerta)] mt-2">{inicial.error}</p>
          )}
          {error && <p role="alert" className="text-sm text-[var(--color-alerta)] mt-2">{error}</p>}
          <button
            disabled={cargando || !inicial.valido}
            onClick={() =>
              accion(() =>
                supabase().rpc('fn_open_cash_session', {
                  p_opening_amount: inicial.valor,
                }),
              )
            }
            className="tap w-full mt-4 py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50"
          >
            {cargando ? 'Abriendo…' : 'Abrir caja'}
          </button>
        </div>

        {cajasAjenas.length > 0 && (
          <CajasAjenas cajas={cajasAjenas} onCerrar={(c) => {
            setForzando(c); setContadoAjeno(''); setNotaAjena('');
          }} />
        )}
        {historial.length > 0 && <Historial cierres={historial} />}
        {dialogoForzar}
      </div>
    );
  }

  // ---------------------------------------------------------------- cerrar
  if (cerrando) {
    const necesitaNota = cont.valido && cont.valor !== esperado;
    return (
      <div className="px-4 py-6">
        <h1 className="text-lg font-semibold mb-1">Cerrar caja</h1>
        <p className="text-sm text-[var(--texto-suave)] mb-3">
          Cuenta el efectivo que hay ahora en la caja.
        </p>

        {/* El cierre es irreversible por diseño (ADR-006: el arqueo es un
            hecho del negocio, no un borrador). La pantalla no lo decía en
            ninguna parte y el botón se ve igual que cualquier otro. docs/21 M-2. */}
        <div className="flex gap-2.5 px-3 py-2.5 rounded-xl bg-amber-50 border border-[var(--color-aviso)]/30 mb-4">
          <span aria-hidden className="text-base leading-tight">⚠️</span>
          <p className="text-xs text-[var(--color-aviso)] leading-relaxed">
            <strong>El cierre no se puede deshacer.</strong> Una vez cerrada, la
            caja queda registrada con el monto contado y ya no admite ventas ni
            movimientos: para seguir operando hay que abrir una caja nueva.
          </p>
        </div>

        <div className="tarjeta p-4 space-y-4">
          <div>
            <label htmlFor="contado" className="block text-sm font-medium mb-1.5">
              Efectivo contado
            </label>
            <input
              id="contado"
              type="text"
              inputMode="numeric"
              value={contado}
              onChange={(e) => setContado(e.target.value)}
              placeholder="0"
              className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] text-xl num text-right"
            />
          </div>

          {contado !== '' && cont.error && (
            <p role="alert" className="text-sm text-[var(--color-alerta)]">{cont.error}</p>
          )}

          {contado !== '' && cont.valido && (
            <div className={`px-4 py-3 rounded-xl ${
              diferencia === 0 ? 'bg-marca-50' : 'bg-amber-50'
            }`}>
              <div className="flex justify-between text-sm">
                <span>Esperado</span>
                <span className="num">{formatCLP(esperado)}</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span>Contado</span>
                <span className="num">{formatCLP(cont.valor)}</span>
              </div>
              <div className="flex justify-between font-bold mt-2 pt-2 border-t border-black/10">
                <span>{diferencia === 0 ? 'Cuadra' : diferencia < 0 ? 'Faltante' : 'Sobrante'}</span>
                <span className="num">{formatCLP(Math.abs(diferencia))}</span>
              </div>
            </div>
          )}

          {necesitaNota && (
            <div>
              <label htmlFor="nota" className="block text-sm font-medium mb-1.5">
                ¿A qué se debe la diferencia? <span className="text-[var(--color-alerta)]">*</span>
              </label>
              <textarea
                id="nota"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-xl border border-[var(--borde)]"
                placeholder="Ej: se dio un vuelto de más en la mañana"
              />
            </div>
          )}

          {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => { setCerrando(false); setError(null); }}
              className="tap px-4 py-3.5 rounded-xl border border-[var(--borde)] font-medium"
            >
              Volver
            </button>
            <button
              disabled={cargando || !cont.valido || (necesitaNota && nota.trim() === '')}
              onClick={async () => {
                const ok = await accion(() =>
                  supabase().rpc('fn_close_cash_session', {
                    p_session_id: session.id,
                    p_counted_amount: cont.valor,
                    p_notes: nota.trim() || null,
                  }),
                );
                if (ok) { setCerrando(false); setContado(''); setNota(''); }
              }}
              className="tap flex-1 py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-40"
            >
              {cargando ? 'Cerrando…' : 'Cerrar caja'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- abierta
  const r = resumen ?? {};
  return (
    <div className="px-4 py-5 space-y-4">
      <div className="tarjeta p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-semibold">Caja abierta</h1>
            <p className="text-xs text-[var(--texto-suave)]">desde las {hora(session.opened_at)}</p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-marca-100 text-marca-900 text-xs font-medium">
            Activa
          </span>
        </div>

        <dl className="space-y-1.5 text-sm">
          <Fila label="Efectivo inicial" value={Number(r.opening_amount ?? 0)} />
          <Fila label="Ventas en efectivo" value={Number(r.cash_sales ?? 0)} />
          {Number(r.cash_in ?? 0) > 0 && <Fila label="Ingresos" value={Number(r.cash_in)} />}
          {Number(r.cash_out ?? 0) > 0 && <Fila label="Egresos" value={-Number(r.cash_out)} />}
          <div className="flex justify-between pt-2 mt-2 border-t border-[var(--borde)] font-bold text-base">
            <dt>Debería haber</dt>
            <dd className="num">{formatCLP(esperado)}</dd>
          </div>
        </dl>

        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <Metrica label="Ventas" value={String(r.sales_count ?? 0)} />
          <Metrica label="Total" value={formatCLP(Number(r.sales_total ?? 0))} />
          <Metrica label="Ticket prom." value={formatCLP(Number(r.average_ticket ?? 0))} />
        </div>
      </div>

      {/* Movimientos */}
      <div className="tarjeta p-4">
        <h2 className="font-semibold text-sm mb-3">Movimientos de caja</h2>

        {vistaMovimiento ? (
          <div className="space-y-3">
            {/* Un movimiento mal ingresado no se puede corregir dentro del
                sistema (docs/21 M-1). Mientras eso siga así, lo mínimo es
                decirlo antes y no después. */}
            <p className="text-xs text-[var(--color-aviso)] bg-amber-50 px-3 py-2 rounded-lg">
              Revisa el monto antes de registrar: un movimiento de caja no se
              puede editar ni borrar después.
            </p>
            <Campo
              etiqueta={vistaMovimiento === 'ingreso' ? 'Monto que entra' : 'Monto que sale'}
              obligatorio
              error={movMonto !== '' ? mov.error : null}
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  inputMode="numeric"
                  value={movMonto}
                  onChange={(e) => setMovMonto(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] num text-right"
                />
              )}
            </Campo>
            <Campo etiqueta="Motivo" obligatorio>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  value={movMotivo}
                  onChange={(e) => setMovMotivo(e.target.value)}
                  placeholder={vistaMovimiento === 'egreso' ? 'Ej: compra de bolsas' : 'Ej: vuelto del día anterior'}
                  className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)]"
                />
              )}
            </Campo>
            {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setVistaMovimiento(null); setMovMonto(''); setMovMotivo(''); setError(null); }}
                className="tap px-4 py-3 rounded-xl border border-[var(--borde)] text-sm"
              >
                Cancelar
              </button>
              <button
                disabled={cargando || !movMotivo.trim() || !mov.valido}
                onClick={async () => {
                  const ok = await accion(() =>
                    supabase().rpc('fn_add_cash_movement', {
                      p_type: vistaMovimiento,
                      p_amount: mov.valor,
                      p_reason: movMotivo.trim(),
                    }),
                  );
                  if (ok) { setVistaMovimiento(null); setMovMonto(''); setMovMotivo(''); }
                }}
                className="tap flex-1 py-3 rounded-xl bg-marca-500 text-white font-semibold disabled:opacity-40"
              >
                Registrar {vistaMovimiento}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setVistaMovimiento('ingreso')}
              className="tap flex-1 py-3 rounded-xl border border-[var(--borde)] text-sm font-medium"
            >
              + Ingreso
            </button>
            <button
              onClick={() => setVistaMovimiento('egreso')}
              className="tap flex-1 py-3 rounded-xl border border-[var(--borde)] text-sm font-medium"
            >
              − Egreso
            </button>
          </div>
        )}

        {movimientos.length > 0 && (
          <ul className="mt-3 divide-y divide-[var(--borde)] text-sm">
            {movimientos.map((m) => (
              <li key={m.id} className="py-2 flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">{m.reason}</span>
                  <span className="text-xs text-[var(--texto-suave)]">{hora(m.created_at)}</span>
                </span>
                <span className={`num whitespace-nowrap ${m.type === 'egreso' ? 'text-[var(--color-alerta)]' : 'text-marca-700'}`}>
                  {m.type === 'egreso' ? '−' : '+'}{formatCLP(m.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={() => setCerrando(true)}
        className="tap w-full py-3.5 rounded-xl border-2 border-marca-500 text-marca-700 font-bold"
      >
        Cerrar caja
      </button>

      {cajasAjenas.length > 0 && (
        <CajasAjenas cajas={cajasAjenas} onCerrar={(c) => {
          setForzando(c); setContadoAjeno(''); setNotaAjena('');
        }} />
      )}
      {historial.length > 0 && <Historial cierres={historial} />}

      {dialogoForzar}
    </div>
  );
}

/**
 * Cajas que quedaron abiertas de otra persona (RF-M6-10).
 *
 * `fn_close_cash_session` deja que un admin o un supervisor cierre la caja de
 * otro desde el primer día, y no había ninguna pantalla que lo permitiera. Una
 * caja que alguien dejó abierta ayer impide abrir la de hoy —no se puede tener
 * dos abiertas— y la única salida era el panel de Supabase.
 */
function CajasAjenas({
  cajas, onCerrar,
}: {
  cajas: CajaAjena[];
  onCerrar: (c: CajaAjena) => void;
}) {
  const { hora, fecha } = useFormatoFecha();
  return (
    <section className="tarjeta p-4 mt-4 border-[var(--color-aviso)]">
      <h2 className="font-semibold text-sm mb-1">
        ⚠ {cajas.length === 1 ? 'Una caja quedó abierta' : `${cajas.length} cajas quedaron abiertas`}
      </h2>
      <p className="text-xs text-[var(--texto-suave)] mb-2">
        Mientras siga abierta, quien la abrió no puede abrir otra.
      </p>
      <ul className="divide-y divide-[var(--borde)]">
        {cajas.map((c) => (
          <li key={c.session_id} className="py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm truncate">{c.full_name ?? 'Sin nombre'}</p>
              <p className="text-xs text-[var(--texto-suave)] num">
                desde el {fecha(c.opened_at)} a las {hora(c.opened_at)}
                {typeof c.sales_total === 'number' && ` · ${formatCLP(c.sales_total)} vendidos`}
              </p>
            </div>
            <button
              onClick={() => onCerrar(c)}
              className="tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)] shrink-0"
            >
              Cerrarla
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Fila({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--texto-suave)]">{label}</dt>
      <dd className="num">{formatCLP(value)}</dd>
    </div>
  );
}

function Metrica({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-2 rounded-lg bg-[var(--fondo)]">
      <p className="num text-sm font-bold truncate">{value}</p>
      <p className="text-[10px] text-[var(--texto-suave)]">{label}</p>
    </div>
  );
}

function Historial({ cierres }: { cierres: Cierre[] }) {
  const { fecha } = useFormatoFecha();
  return (
    <div className="tarjeta p-4 mt-4">
      <h2 className="font-semibold text-sm mb-3">Últimos cierres</h2>
      <ul className="divide-y divide-[var(--borde)] text-sm">
        {cierres.map((c) => (
          <li key={c.session_id} className="py-2 flex justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">{c.full_name ?? 'Sin nombre'}</span>
              <span className="text-xs text-[var(--texto-suave)]">
                {c.closed_at ? fecha(c.closed_at) : '—'} · {formatCLP(c.sales_total ?? 0)} vendidos
              </span>
            </span>
            <span
              className={`num whitespace-nowrap font-medium ${
                (c.difference ?? 0) === 0 ? 'text-marca-700' : 'text-[var(--color-aviso)]'
              }`}
            >
              {(c.difference ?? 0) === 0 ? 'cuadró' : formatCLP(c.difference ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
