'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  formatCLP, change, validarMonto, formatRut, isValidRut,
  documentosDisponibles, validarDocumento, normalizarReceptor, NOMBRE_DOCUMENTO, montoRecibidoAtipico,
  redondeoEfectivo,
  type TipoDocumento, type DocumentoVenta, type ClienteConPrecios,
} from '@rutaahorro/core';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { clientesParaVender } from '@/lib/datos/clientes';
import { cuentaDe, type CuentaCliente } from '@/lib/datos/fiado';
import { DEMO_ACTIVO } from '@/lib/demo';

type Metodo = 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'fiado';

const METODOS: Array<{ id: Metodo; label: string; icon: string }> = [
  { id: 'efectivo',      label: 'Efectivo',      icon: '💵' },
  { id: 'debito',        label: 'Débito',        icon: '💳' },
  { id: 'credito',       label: 'Crédito',       icon: '💳' },
  { id: 'transferencia', label: 'Transferencia', icon: '📱' },
];
/** RF-M5-30 · solo aparece con un cliente que tiene crédito en el local. */
const FIADO = { id: 'fiado' as const, label: 'Fiado', icon: '📒' };

/** Qué se le entrega al cliente con cada documento, en sus palabras. */
const QUE_SE_ENTREGA: Record<TipoDocumento, string> = {
  boleta: 'Se entrega boleta y ticket.',
  factura: 'Se emite factura a nombre del cliente.',
  voucher: 'El documento sale de la máquina de tarjetas. Acá solo se imprime el ticket.',
};

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
  total, tarjetaEmiteDocumento = true, redondear = false, cliente = null, onCancel, onConfirm, error = null,
}: {
  total: number;
  /** Por qué no se registró la venta (stock, rechazo de la base). Se muestra acá adentro. */
  error?: string | null;
  /** RF-M5-28 · `tenants.settings.redondeo_efectivo` (lo pone 0029). */
  redondear?: boolean;
  /** Del local: `tenants.settings.tarjeta_emite_documento`. */
  tarjetaEmiteDocumento?: boolean;
  /** El cliente elegido en el POS (0022): sus datos llenan la factura. */
  cliente?: ClienteConPrecios | null;
  onCancel: () => void;
  /** Resuelve false si la venta no se pudo registrar: el cobro vuelve a quedar disponible. */
  onConfirm: (
    payments: Array<{ method: string; amount: number; received_amount?: number }>,
    documento: DocumentoVenta,
  ) => Promise<boolean>;
}) {
  const [metodo, setMetodo] = useState<Metodo>('efectivo');
  const [recibido, setRecibido] = useState('');
  const [enviando, setEnviando] = useState(false);
  // RF-M5-26 · un "100.000" por "10.000" se confirma dos veces.
  const [atipicoConfirmado, setAtipicoConfirmado] = useState(false);

  // Documento (reunión 2026-09-19). Por omisión, el que corresponde al medio
  // de pago: boleta con efectivo o transferencia, voucher con tarjeta.
  const opciones = useMemo(() => ({ tarjetaEmiteDocumento }), [tarjetaEmiteDocumento]);
  const pagos = useMemo(() => [{ metodo }], [metodo]);
  const disponibles = useMemo(
    () => documentosDisponibles(pagos, opciones), [pagos, opciones]);
  const [tipo, setTipo] = useState<TipoDocumento>(disponibles[0]);

  // RF-M5-30 · La cuenta del cliente elegido: si tiene tope, se le puede fiar
  // hasta lo que le queda. Se lee al abrir el cobro (necesita conexión).
  const [cuenta, setCuenta] = useState<CuentaCliente | null>(null);
  useEffect(() => {
    if (!cliente) return;
    let vivo = true;
    void cuentaDe(cliente.id).then((c) => { if (vivo) setCuenta(c); }).catch(() => {});
    return () => { vivo = false; };
  }, [cliente]);
  const conRed = DEMO_ACTIVO || (typeof navigator === 'undefined' || navigator.onLine);
  const metodos = cuenta && cuenta.tope > 0 ? [...METODOS, FIADO] : METODOS;
  const fiadoAlcanza = !!cuenta && cuenta.disponible >= total;
  const [rut, setRut] = useState(cliente?.rut ?? '');
  const [razonSocial, setRazonSocial] = useState(cliente?.rut ? cliente.nombre : '');
  const [giro, setGiro] = useState(cliente?.giro ?? '');
  const [direccion, setDireccion] = useState(cliente?.direccion ?? '');

  // RQ-20 · Un RUT que ya facturó trae sus datos: antes se escribían cada vez.
  const [conocidos, setConocidos] = useState<ClienteConPrecios[]>([]);
  useEffect(() => { void clientesParaVender().then(setConocidos).catch(() => {}); }, []);
  function completarPorRut(valor: string) {
    if (!isValidRut(valor)) return;
    const limpio = (r: string | null | undefined) => (r ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
    const c = conocidos.find((x) => limpio(x.rut) === limpio(valor));
    if (!c) return;
    setRazonSocial((v) => v || c.nombre);
    setGiro((v) => v || c.giro || '');
    setDireccion((v) => v || c.direccion || '');
  }

  // Cambiar de medio de pago cambia qué documentos existen: quedarse en uno
  // que ya no corresponde dejaría al cajero confirmando algo imposible.
  useEffect(() => {
    setTipo((actual) => (disponibles.includes(actual) ? actual : disponibles[0]));
  }, [disponibles]);

  const documento: DocumentoVenta = useMemo(() => (
    tipo === 'factura'
      ? { tipo, receptor: normalizarReceptor({ rut, razonSocial, giro, direccion }) }
      : { tipo }
  ), [tipo, rut, razonSocial, giro, direccion]);

  const revision = validarDocumento(documento, pagos, opciones);
  // RF-M5-28 · Ley 20.956: todo en efectivo se cobra redondeado a la decena.
  // El total de la venta (y de la boleta) no cambia; la base guarda el ajuste.
  const aCobrar = metodo === 'efectivo' && redondear ? redondeoEfectivo(total) : total;
  const ajuste = aCobrar - total;
  // validarMonto y no parseCLP (regla 9): "20000,5" se leía $200.005.
  const vRecibido = validarMonto(recibido, { etiqueta: 'monto recibido', permiteVacio: true, maximo: 10_000_000 });
  const montoRecibido = vRecibido.valido ? vRecibido.valor : 0;
  const vuelto = change(montoRecibido, aCobrar);
  const faltante = Math.max(aCobrar - montoRecibido, 0);
  const puedeConfirmar =
    (metodo !== 'efectivo' || montoRecibido >= aCobrar)
    && (metodo !== 'fiado' || (fiadoAlcanza && conRed))
    && revision.valido;

  // El error del RUT solo se muestra cuando hay algo escrito: marcarlo en rojo
  // antes de que el cajero alcance a teclear es ruido, no ayuda.
  const errorRut = rut.trim() !== '' && !isValidRut(rut) ? 'Revisa el RUT' : null;

  const atipico = metodo === 'efectivo' && montoRecibidoAtipico(montoRecibido, aCobrar);
  useEffect(() => { setAtipicoConfirmado(false); }, [recibido, metodo]);

  async function confirmar() {
    if (!puedeConfirmar || enviando) return;
    if (atipico && !atipicoConfirmado) { setAtipicoConfirmado(true); return; }
    setEnviando(true);
    const registrada = await onConfirm([
      metodo === 'efectivo'
        ? { method: 'efectivo', amount: aCobrar, received_amount: montoRecibido }
        : { method: metodo, amount: total },
    ], documento).catch(() => false);
    if (!registrada) setEnviando(false);
  }

  // Con <Modal> y no un diálogo hecho a mano: Escape cierra, el foco queda
  // adentro y vuelve al salir (regla 10). Mientras se registra, no se cierra:
  // cancelar a medias no cancela la venta en la base.
  return (
    <Modal titulo="Cobrar" encabezado="visible" onCerrar={onCancel} bloqueado={enviando}>
      <div className="p-4 pb-6">

        <p className="text-center num text-3xl font-bold" aria-live="polite">{formatCLP(aCobrar)}</p>
        {ajuste !== 0 ? (
          <p className="text-center text-xs text-[var(--texto-suave)] mb-4" data-redondeo>
            Total {formatCLP(total)} · redondeo del efectivo {ajuste > 0 ? '+' : '−'}{formatCLP(Math.abs(ajuste))} (Ley 20.956)
          </p>
        ) : <div className="mb-4" />}

        <div className="grid grid-cols-2 gap-2 mb-4">
          {metodos.map((m) => (
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

        {/* ------------------------------------------------------- DOCUMENTO */}
        <fieldset className="mb-4">
          <legend className="block text-sm font-medium mb-1.5">Documento</legend>
          <div className="flex gap-2">
            {disponibles.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setTipo(d)}
                aria-pressed={tipo === d}
                className={`tap flex-1 py-2.5 rounded-xl text-sm font-medium border-2 ${
                  tipo === d
                    ? 'border-marca-500 bg-marca-50 text-marca-900'
                    : 'border-[var(--borde)] bg-white'
                }`}
              >
                {NOMBRE_DOCUMENTO[d]}
                {tipo === d && <span aria-hidden> ✓</span>}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--texto-suave)] mt-1.5">{QUE_SE_ENTREGA[tipo]}</p>
        </fieldset>

        {tipo === 'factura' && (
          <div className="mb-4 space-y-3 p-3 rounded-xl bg-[var(--fondo)]">
            <Campo etiqueta="RUT del cliente" obligatorio error={errorRut}>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={rut}
                  onChange={(e) => setRut(e.target.value)}
                  onBlur={() => { if (isValidRut(rut)) { setRut(formatRut(rut)); completarPorRut(rut); } }}
                  placeholder="76.086.428-5"
                  className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white num"
                />
              )}
            </Campo>
            <Campo etiqueta="Nombre o razón social" obligatorio>
              {(p) => (
                <input
                  {...p}
                  type="text"
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                  placeholder="Comercial Los Andes SpA"
                  className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white"
                />
              )}
            </Campo>
            <div className="grid grid-cols-2 gap-2">
              <Campo etiqueta="Giro">
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    value={giro}
                    onChange={(e) => setGiro(e.target.value)}
                    className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white"
                  />
                )}
              </Campo>
              <Campo etiqueta="Dirección">
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                    className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white"
                  />
                )}
              </Campo>
            </div>
          </div>
        )}

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
              {sugerencias(aCobrar).map((monto) => (
                <button
                  key={monto}
                  onClick={() => setRecibido(String(monto))}
                  className="tap px-3 py-2 rounded-lg border border-[var(--borde)] text-sm num whitespace-nowrap"
                >
                  {formatCLP(monto)}
                </button>
              ))}
            </div>

            {recibido.trim() !== '' && !vRecibido.valido && (
              <p role="alert" className="text-sm text-[var(--color-alerta)] mt-2">{vRecibido.error}</p>
            )}
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

        {metodo === 'fiado' && cuenta && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[var(--fondo)] text-sm" data-fiado>
            <p>
              <strong>{cliente?.nombre}</strong> debe <span className="num">{formatCLP(cuenta.saldo)}</span> de un
              tope de <span className="num">{formatCLP(cuenta.tope)}</span>.
            </p>
            {fiadoAlcanza ? (
              <p className="text-[var(--texto-suave)]">
                Queda debiendo <span className="num font-semibold">{formatCLP(cuenta.saldo + total)}</span>. No entra a la caja: se cobra con un abono.
              </p>
            ) : (
              <p role="alert" className="text-[var(--color-alerta)]">
                Le quedan {formatCLP(cuenta.disponible)} de crédito: no alcanza para {formatCLP(total)}.
              </p>
            )}
            {!conRed && (
              <p role="alert" className="text-[var(--color-alerta)]">Fiar necesita conexión para revisar la cuenta.</p>
            )}
          </div>
        )}

        {atipico && (
          <p role="alert" className="text-sm text-[var(--color-aviso)] bg-amber-50 px-3 py-2 rounded-lg mb-3">
            ¿Recibiste <strong className="num">{formatCLP(montoRecibido)}</strong>? Es mucho más que el total: revisa que
            no sobre un cero. {atipicoConfirmado ? 'Toca otra vez para confirmar.' : ''}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-900 bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>
        )}

        {/* Por qué no se puede confirmar, antes de que lo intente. */}
        {!revision.valido && (
          <p role="alert" className="text-sm text-[var(--color-alerta)] mb-3">
            {revision.error}
          </p>
        )}

        <button
          onClick={confirmar}
          disabled={!puedeConfirmar || enviando}
          className="tap w-full py-4 rounded-xl bg-marca-500 text-white font-bold text-lg active:bg-marca-600 disabled:opacity-40"
        >
          {enviando ? 'Registrando…' : atipico && atipicoConfirmado ? `Sí, recibí ${formatCLP(montoRecibido)}` : 'Confirmar venta'}
        </button>
      </div>
    </Modal>
  );
}
