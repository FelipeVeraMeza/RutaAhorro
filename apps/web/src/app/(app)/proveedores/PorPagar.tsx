'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { diaLocal, sumarDias, formatCLP, toUserMessage, validarMonto } from '@rutaahorro/core';
import {
  facturasProveedor, registrarFacturaProveedor, pagarFacturaProveedor, anularFacturaProveedor,
  diasParaVencer, NOMBRE_METODO_PROVEEDOR,
  type FacturaProveedor, type MetodoPagoProveedor,
} from '@/lib/datos/porPagar';
import type { Proveedor } from '@/lib/datos/proveedores';
import { useConfiguracion } from '@/lib/datos/configuracion';
import { useFormatoFecha } from '@/lib/formatoFecha';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';

/**
 * Compras → Por pagar (RF-M3-13): las facturas de proveedores con su
 * vencimiento. Lo vencido y lo que vence esta semana va primero y se marca.
 */
export function PorPagar({ proveedores, puedeAnular, onCambio }: {
  proveedores: Proveedor[];
  puedeAnular: boolean;
  onCambio?: (pendientes: number) => void;
}) {
  const { zonaHoraria } = useConfiguracion();
  const { fecha } = useFormatoFecha();
  const [facturas, setFacturas] = useState<FacturaProveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [verPagadas, setVerPagadas] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [pagando, setPagando] = useState<FacturaProveedor | null>(null);
  const [anulando, setAnulando] = useState<FacturaProveedor | null>(null);

  const cargar = useCallback(async () => {
    try {
      const l = await facturasProveedor();
      setFacturas(l);
      onCambio?.(l.filter((f) => !f.pagadaEn && !f.anulada).length);
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setCargando(false);
    }
  }, [onCambio]);
  useEffect(() => { void cargar(); }, [cargar]);

  const hoy = diaLocal(new Date(), zonaHoraria);
  const pendientes = useMemo(() => facturas.filter((f) => !f.pagadaEn && !f.anulada), [facturas]);
  const todasPagadas = useMemo(() => facturas.filter((f) => f.pagadaEn && !f.anulada).length, [facturas]);
  const pagadas = useMemo(() => facturas.filter((f) => f.pagadaEn && !f.anulada)
    .sort((a, b) => (b.pagadaEn ?? '').localeCompare(a.pagadaEn ?? '')).slice(0, 30), [facturas]);
  const totalPendiente = pendientes.reduce((s, f) => s + f.monto, 0);
  const porProveedor = useMemo(() => {
    // Por proveedor (su id), no por nombre: dos con el mismo nombre se sumaban
    // en una sola fila.
    const m = new Map<string, { nombre: string; monto: number }>();
    for (const f of pendientes) {
      const x = m.get(f.proveedorId) ?? { nombre: f.proveedor, monto: 0 };
      x.monto += f.monto;
      m.set(f.proveedorId, x);
    }
    return [...m.entries()].sort((a, b) => b[1].monto - a[1].monto);
  }, [pendientes]);

  async function listo(texto: string) {
    setNueva(false); setPagando(null); setAnulando(null);
    setAviso({ tipo: 'ok', texto });
    await cargar();
  }

  const estado = (f: FacturaProveedor) => {
    const d = diasParaVencer(f.vence, hoy);
    if (d < 0) return { texto: `Vencida hace ${-d} ${d === -1 ? 'día' : 'días'}`, clase: 'text-[var(--color-alerta)] font-semibold' };
    if (d === 0) return { texto: 'Vence hoy', clase: 'text-[var(--color-alerta)] font-semibold' };
    if (d <= 7) return { texto: `Vence en ${d} ${d === 1 ? 'día' : 'días'}`, clase: 'text-[var(--color-aviso)] font-semibold' };
    return { texto: `Vence el ${fecha(`${f.vence}T12:00:00`)}`, clase: 'text-[var(--texto-suave)]' };
  };

  return (
    <div className="space-y-3" aria-busy={cargando}>
      {aviso && (
        <p role={aviso.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm px-3 py-2 rounded-lg ${aviso.tipo === 'error' ? 'bg-red-50 text-red-900' : 'bg-marca-100 text-marca-900'}`}>
          {aviso.texto}
        </p>
      )}

      <div className="tarjeta p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">Por pagar</span>
          <span className="num text-xl font-bold" data-total-por-pagar>{formatCLP(totalPendiente)}</span>
        </div>
        {porProveedor.length > 1 && (
          <ul className="mt-2 text-xs text-[var(--texto-suave)] space-y-0.5" aria-label="Adeudado por proveedor">
            {porProveedor.map(([id, x]) => (
              <li key={id} className="flex justify-between gap-2"><span className="truncate">{x.nombre}</span><span className="num">{formatCLP(x.monto)}</span></li>
            ))}
          </ul>
        )}
        <button onClick={() => setNueva(true)} className="btn btn-secundario btn-chico mt-3">Registrar factura</button>
      </div>

      <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden" aria-label="Facturas por pagar">
        {pendientes.map((f) => {
          const e = estado(f);
          return (
            <li key={f.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{f.proveedor}</p>
                  <p className="text-xs text-[var(--texto-suave)]">Factura N° {f.numero}{f.nota && ` · ${f.nota}`}</p>
                  <p className={`text-xs ${e.clase}`}>{e.texto}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="num font-semibold">{formatCLP(f.monto)}</p>
                  <div className="flex gap-1 justify-end mt-1">
                    <button onClick={() => setPagando(f)} className="btn btn-primario btn-chico"
                            aria-label={`Marcar pagada la factura ${f.numero} de ${f.proveedor}`}>
                      Pagada
                    </button>
                    {puedeAnular && (
                      <button onClick={() => setAnulando(f)} className="btn btn-fantasma btn-chico"
                              aria-label={`Anular la factura ${f.numero} de ${f.proveedor}`}>
                        Anular
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
        {!cargando && pendientes.length === 0 && (
          <li className="p-4 text-sm text-[var(--texto-suave)]">
            No hay facturas por pagar. Se registran al recibir mercadería con factura, o con “Registrar factura”.
          </li>
        )}
      </ul>

      {pagadas.length > 0 && (
        <div>
          <button onClick={() => setVerPagadas((v) => !v)} aria-expanded={verPagadas} className="btn btn-fantasma btn-chico">
            {/* Se muestran las 30 más recientes: con 45 pagadas decía "(30)". */}
            {verPagadas ? 'Ocultar' : 'Ver'} pagadas ({todasPagadas > pagadas.length ? `las ${pagadas.length} últimas de ${todasPagadas}` : todasPagadas})
          </button>
          {verPagadas && (
            <ul className="tarjeta divide-y divide-[var(--borde)] mt-2 text-sm" aria-label="Facturas pagadas">
              {pagadas.map((f) => (
                <li key={f.id} className="px-4 py-2 flex justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate">{f.proveedor} · N° {f.numero}</span>
                    <span className="block text-xs text-[var(--texto-suave)]">
                      Pagada el {fecha(f.pagadaEn!)}{f.metodo && ` · ${NOMBRE_METODO_PROVEEDOR[f.metodo]}`}
                    </span>
                  </span>
                  <span className="num">{formatCLP(f.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {nueva && <NuevaFactura proveedores={proveedores} hoy={hoy} onCerrar={() => setNueva(false)} onListo={listo} />}
      {pagando && <Pagar factura={pagando} onCerrar={() => setPagando(null)} onListo={listo} />}
      {anulando && <Anular factura={anulando} onCerrar={() => setAnulando(null)} onListo={listo} />}
    </div>
  );
}

function NuevaFactura({ proveedores, hoy, onCerrar, onListo }: {
  proveedores: Proveedor[]; hoy: string; onCerrar: () => void; onListo: (t: string) => void;
}) {
  const [proveedorId, setProveedorId] = useState('');
  const [numero, setNumero] = useState('');
  const [monto, setMonto] = useState('');
  const [emitida, setEmitida] = useState(hoy);
  const [vence, setVence] = useState(sumarDias(hoy, 30));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = validarMonto(monto, { etiqueta: 'monto', maximo: 100_000_000 });
  // Como en Facturas recibidas: una factura no puede venir emitida mañana
  // (un año mal tecleado la dejaba "por vencer" en otra fecha).
  const emitidaFutura = !!emitida && emitida > hoy;
  // Escrita a mano, la fecha podía quedar antes de la emisión ("min" solo
  // limita el calendario): la factura nacía vencida.
  const venceAntes = !!vence && !!emitida && vence < emitida;
  const listo = proveedorId && numero.trim() && v.valido && v.valor > 0 && vence && !emitidaFutura && !venceAntes;

  async function guardar() {
    if (!listo || enviando) return;
    setEnviando(true); setError(null);
    try {
      await registrarFacturaProveedor({ proveedorId, numero: numero.trim(), monto: v.valor, emitida, vence });
      onListo(`Factura N° ${numero.trim()} registrada: vence el ${vence.split('-').reverse().join('-')}.`);
    } catch (e) {
      setError(toUserMessage(e));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Registrar factura de proveedor" encabezado="visible" onCerrar={onCerrar} bloqueado={enviando}>
      <div className="p-4 space-y-3">
        <Campo etiqueta="Proveedor" obligatorio>
          {(p) => (
            <select {...p} value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}
                    className="tap w-full px-3 rounded-lg border border-[var(--borde)] bg-white">
              <option value="">Elige…</option>
              {proveedores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          )}
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="N° de factura" obligatorio>
            {(p) => <input {...p} value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric"
                           className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />}
          </Campo>
          <Campo etiqueta="Monto total" obligatorio error={monto !== '' ? v.error : null}>
            {(p) => <input {...p} value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="numeric"
                           className="tap w-full px-3 rounded-lg border border-[var(--borde)] num text-right" />}
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Emitida el" error={emitidaFutura ? 'No puede ser una fecha futura' : null}>
            {(p) => <input {...p} type="date" value={emitida} max={hoy} onChange={(e) => setEmitida(e.target.value)}
                           className="tap w-full px-2 rounded-lg border border-[var(--borde)]" />}
          </Campo>
          <Campo etiqueta="Vence el" obligatorio error={venceAntes ? 'No puede vencer antes de emitirse' : null}>
            {(p) => <input {...p} type="date" value={vence} min={emitida || undefined} onChange={(e) => setVence(e.target.value)}
                           className="tap w-full px-2 rounded-lg border border-[var(--borde)]" />}
          </Campo>
        </div>
        <div className="flex flex-wrap gap-2">
          {[15, 30, 45, 60].map((d) => (
            <button key={d} type="button" onClick={() => setVence(sumarDias(emitida || hoy, d))} className="btn btn-secundario btn-chico">
              {d} días
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void guardar()} disabled={!listo || enviando} className="btn btn-primario w-full">
          {enviando ? 'Guardando…' : 'Registrar factura'}
        </button>
      </div>
    </Modal>
  );
}

function Pagar({ factura, onCerrar, onListo }: {
  factura: FacturaProveedor; onCerrar: () => void; onListo: (t: string) => void;
}) {
  const [metodo, setMetodo] = useState<MetodoPagoProveedor>('transferencia');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pagar() {
    setEnviando(true); setError(null);
    try {
      await pagarFacturaProveedor(factura.id, metodo);
      onListo(`Factura N° ${factura.numero} de ${factura.proveedor} marcada pagada${metodo === 'efectivo_caja' ? ': salió como egreso de tu caja' : ''}.`);
    } catch (e) {
      setError(toUserMessage(e));
      setEnviando(false);
    }
  }
  return (
    <Modal titulo={`Pagar factura N° ${factura.numero}`} encabezado="visible" onCerrar={onCerrar} bloqueado={enviando}>
      <div className="p-4 space-y-3">
        <p className="text-sm">{factura.proveedor} · <strong className="num">{formatCLP(factura.monto)}</strong></p>
        <fieldset>
          <legend className="text-sm font-medium mb-1.5">Cómo se pagó</legend>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(NOMBRE_METODO_PROVEEDOR) as MetodoPagoProveedor[]).map((m) => (
              <button key={m} type="button" onClick={() => setMetodo(m)} aria-pressed={metodo === m}
                      className={`tap rounded-xl border-2 text-sm font-medium px-2 ${metodo === m ? 'border-marca-500 bg-marca-50 text-marca-900' : 'border-[var(--borde)] bg-white'}`}>
                {NOMBRE_METODO_PROVEEDOR[m]}{metodo === m && <span aria-hidden> ✓</span>}
              </button>
            ))}
          </div>
          {metodo === 'efectivo_caja' && (
            <p className="text-xs text-[var(--texto-suave)] mt-1.5">Sale de tu caja abierta como egreso, para que el cierre cuadre.</p>
          )}
        </fieldset>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void pagar()} disabled={enviando} className="btn btn-primario w-full">
          {enviando ? 'Guardando…' : 'Marcar pagada'}
        </button>
        <p className="text-xs text-[var(--texto-suave)]">Una factura pagada no se puede desmarcar.</p>
      </div>
    </Modal>
  );
}

function Anular({ factura, onCerrar, onListo }: {
  factura: FacturaProveedor; onCerrar: () => void; onListo: (t: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function anular() {
    if (!motivo.trim()) return;
    setEnviando(true); setError(null);
    try {
      await anularFacturaProveedor(factura.id, motivo.trim());
      onListo(`Factura N° ${factura.numero} anulada.`);
    } catch (e) {
      setError(toUserMessage(e));
      setEnviando(false);
    }
  }
  return (
    <Modal titulo={`Anular factura N° ${factura.numero}`} encabezado="visible" onCerrar={onCerrar} bloqueado={enviando}>
      <div className="p-4 space-y-3">
        <p className="text-sm">Para una factura mal ingresada. No se borra: queda anulada con el motivo.</p>
        <Campo etiqueta="Motivo" obligatorio>
          {(p) => <input {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />}
        </Campo>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void anular()} disabled={!motivo.trim() || enviando} className="btn btn-peligro w-full">
          Anular factura
        </button>
      </div>
    </Modal>
  );
}
