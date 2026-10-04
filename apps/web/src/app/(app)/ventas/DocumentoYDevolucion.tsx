'use client';

import { useMemo, useState } from 'react';
import {
  formatCLP, formatCantidad, toUserMessage, NOMBRE_DTE, construirXmlDte, desdeRegistro, montosDevolucion,
  validarCantidad, type RegistroDte, type TipoDte, redondeoEfectivo
} from '@rutaahorro/core';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { Timbre } from '@/components/Timbre';
import {
  repoVentas, ETIQUETA_PAGO,
  type VentaDetallada, type Reembolso, type ResultadoDevolucion,
} from '@/lib/datos/ventas';

/** "Boleta electrónica N° 12", el nombre con que se habla de un documento. */
export function nombreDocumento(d: { tipo: number; folio: number | string }): string {
  return `${NOMBRE_DTE[Number(d.tipo) as TipoDte]} N° ${d.folio}`;
}

/**
 * La representación impresa de una boleta, factura o nota de crédito (0019),
 * armada desde lo que quedó registrado en la base, con su timbre PDF417.
 * Es lo que se reimprime o se le manda al cliente que pide su boleta después.
 */
export function DocumentoTributario({ doc, onCerrar, pdfUrl }: {
  doc: RegistroDte;
  onCerrar: () => void;
  /** El PDF que entregó el SII (factura emitida por el portal, 0026). */
  pdfUrl?: string | null;
}) {
  const simulado = doc.ambiente === 'simulacion';
  // Emitida por el portal del SII: el timbre válido está en el PDF del SII.
  // Dibujar uno acá sería inventar una firma que no es la del documento.
  const delPortal = (doc.emisor as { via?: string }).via === 'portal_sii';

  function descargarXml() {
    const xml = construirXmlDte(desdeRegistro(doc));
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `DTE-T${doc.tipo}-F${doc.folio}${simulado ? '-SIMULADO' : ''}.xml`;
    // Como en Reportes: revocar la URL en la misma vuelta que el clic
    // cancela la descarga en Safari de iPhone.
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Modal titulo={nombreDocumento(doc)} encabezado="visible" onCerrar={onCerrar} ancho="md">
      <div className="p-4 space-y-3">
        <div id="ticket" className="font-mono text-[12px] leading-5 text-black">
          <div className="text-center">
            <p className="font-bold text-[13px]">{doc.emisor.razon_social}</p>
            <p className="text-[11px]">{doc.emisor.giro}</p>
            <p className="text-[11px]">{doc.emisor.direccion}, {doc.emisor.comuna}</p>
            <div className="border-2 border-black inline-block px-3 py-1 my-2">
              <p className="font-bold">R.U.T. {doc.emisor.rut}</p>
              <p className="font-bold">{NOMBRE_DTE[Number(doc.tipo) as TipoDte].toUpperCase()}</p>
              <p className="font-bold">N° {doc.folio}</p>
            </div>
            {simulado && <p className="font-bold">SIMULADA · SIN VALIDEZ TRIBUTARIA</p>}
            {doc.emisor.configurado === false && (
              <p className="text-[10px]">(datos del emisor sin configurar)</p>
            )}
          </div>
          <p className="mt-2">Fecha: {doc.fecha_emision.split('-').reverse().join('-')}</p>
          {doc.receptor?.rut && (
            <p>Cliente: {doc.receptor.razon_social} · RUT {doc.receptor.rut}</p>
          )}
          {doc.receptor?.giro && <p className="text-[11px]">Giro: {doc.receptor.giro}</p>}
          {doc.receptor?.direccion && (
            <p className="text-[11px]">
              {doc.receptor.direccion}{(doc.receptor as { comuna?: string }).comuna ? `, ${(doc.receptor as { comuna?: string }).comuna}` : ''}
            </p>
          )}
          {doc.referencia && (
            <p className="text-[11px]">
              Referencia: {NOMBRE_DTE[Number(doc.referencia.tipo) as TipoDte] ?? `Tipo ${doc.referencia.tipo}`} N° {doc.referencia.folio}
              {' · '}{doc.referencia.codigo === 1 ? 'anula el documento' : 'corrige montos'} · {doc.referencia.razon}
            </p>
          )}
          <div className="border-t border-dashed border-black my-2" />
          {doc.detalle.map((l, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="truncate">{Number(l.cantidad) !== 1 || l.nombre !== 'Descuento' ? `${formatCantidad(Number(l.cantidad))} x ` : ''}{l.nombre}</span>
              <span className="shrink-0">{formatCLP(Number(l.monto))}</span>
            </div>
          ))}
          <div className="border-t border-dashed border-black my-2" />
          <Fila izq="Neto" der={formatCLP(doc.neto)} />
          <Fila izq={`IVA (${Number(doc.iva_pct)}%)`} der={formatCLP(doc.iva)} />
          {(doc.impuestos_detalle ?? []).map((a, i) => (
            <Fila key={i} izq={`Imp. adicional ${String(Number(a.tasa)).replace('.', ',')}%`} der={formatCLP(a.monto)} />
          ))}
          <div className="flex justify-between font-bold text-[14px] mt-1">
            <span>TOTAL</span><span>{formatCLP(doc.total)}</span>
          </div>
          {delPortal
            ? <p className="text-center text-[11px] mt-2">Timbre electrónico SII: ver el PDF del documento</p>
            : <Timbre dte={doc} />}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => window.print()} className="tap rounded-xl border border-[var(--borde)] font-medium">
            Imprimir
          </button>
          {delPortal ? (
            pdfUrl
              ? <a href={pdfUrl} target="_blank" rel="noreferrer"
                   className="tap inline-flex items-center justify-center rounded-xl border border-[var(--borde)] font-medium">
                  PDF del SII
                </a>
              : <span className="tap inline-flex items-center justify-center text-xs text-[var(--texto-suave)] text-center">
                  El PDF no se pudo bajar: está en el portal del SII
                </span>
          ) : (
            <button onClick={descargarXml} className="tap rounded-xl border border-[var(--borde)] font-medium">
              Descargar XML
            </button>
          )}
        </div>
        {simulado && (
          <p className="text-xs text-[var(--texto-suave)]">
            Documento simulado: tiene la forma del formato del SII, pero no está firmado ni
            enviado. Emitir de verdad necesita el certificado digital y los folios del SII.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Fila({ izq, der }: { izq: string; der: string }) {
  return <div className="flex justify-between gap-2"><span>{izq}</span><span>{der}</span></div>;
}

// ---------------------------------------------------------------------------

const MOTIVOS = ['Producto vencido o en mal estado', 'Cambio de producto', 'El cliente se arrepintió',
  'Cobro equivocado', 'Producto equivocado'];

/**
 * Devolución parcial o total (respuestas 16 y 17 del cuestionario, 0019).
 *
 * Se elige cuántas unidades de cada línea vuelven. El monto que se muestra lo
 * calcula core igual que la base (lo que se pagó por unidad, con su parte del
 * descuento), y la base es la que manda: si difiere, vale lo de la base.
 */
export function DevolverVenta({ venta, onCerrar, onHecho }: {
  venta: VentaDetallada;
  onCerrar: () => void;
  onHecho: (r: ResultadoDevolucion) => void;
}) {
  const lineas = venta.lineas.filter((l) => l.id);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('');
  const pagoOriginal = venta.pagos[0]?.metodo as Reembolso | undefined;
  // RF-M5-30 · lo fiado no se devuelve en plata: se rebaja de la cuenta (0029).
  const fiada = venta.pagos.some((p) => p.metodo === 'fiado');
  const [reembolso, setReembolso] = useState<Reembolso>(fiada ? 'fiado' : pagoOriginal ?? 'efectivo');
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  const quedan = (id: string) => {
    const l = lineas.find((x) => x.id === id)!;
    return l.cantidad - (l.devuelto ?? 0);
  };
  const pedido = useMemo(() => lineas
    .map((l) => ({ id: l.id!, v: validarCantidad(cantidades[l.id!] ?? '', { permiteVacio: true, maximo: 1_000_000 }) }))
    .filter((x) => x.v.valido && x.v.valor > 0)
    .map((x) => ({ id: x.id, cantidad: x.v.valor })), [cantidades, lineas]);

  // Una cantidad mal escrita ("2x", "-1") se ignoraba en silencio y se
  // devolvía solo lo demás.
  const malEscrita = lineas.find((l) => {
    const t = cantidades[l.id!] ?? '';
    return t.trim() !== '' && !validarCantidad(t, { permiteVacio: true, maximo: 1_000_000 }).valido;
  });

  const devueltoAntes = venta.devoluciones.reduce((s, d) => s + d.monto, 0);
  let estimado = 0;
  let errorCantidad: string | null = null;
  try {
    estimado = pedido.length
      ? montosDevolucion(
          lineas.map((l) => ({ id: l.id!, cantidad: l.cantidad, subtotal: l.subtotal, devuelto: l.devuelto ?? 0 })),
          venta.total, devueltoAntes, pedido).reduce((s, x) => s + x.monto, 0)
      : 0;
  } catch {
    errorCantidad = 'Hay una cantidad mayor que lo que queda por devolver';
  }
  if (malEscrita) errorCantidad = `Revisa la cantidad de ${malEscrita.productoNombre}`;  // RF-M5-28 · En efectivo no hay monedas de $1: se devuelve redondeado, como
  // hace la base (0029). La nota de crédito sigue por el monto exacto.
  const aDevolver = reembolso === 'efectivo' ? redondeoEfectivo(estimado) : estimado;


  const todo = () => setCantidades(Object.fromEntries(lineas.map((l) => [l.id!, String(quedan(l.id!)).replace('.', ',')])));

  async function confirmar() {
    setEnCurso(true);
    setError(null);
    try {
      const esTodo = lineas.every((l) => {
        const p = pedido.find((x) => x.id === l.id);
        return Math.abs((p?.cantidad ?? 0) - quedan(l.id!)) < 1e-9;
      });
      onHecho(await repoVentas().devolver(
        venta.id, esTodo ? null : pedido.map((p) => ({ lineaId: p.id, cantidad: p.cantidad })),
        motivo.trim(), reembolso));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <Modal titulo={`Devolver productos · venta folio ${venta.folio}`} encabezado="visible"
           onCerrar={onCerrar} bloqueado={enCurso} ancho="md">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">¿Qué vuelve?</p>
          <button onClick={todo} className="tap px-3 text-sm underline">Todo lo que queda</button>
        </div>
        <ul className="divide-y divide-[var(--borde)] tarjeta">
          {lineas.map((l) => {
            const q = quedan(l.id!);
            return (
              <li key={l.id} className="p-3 flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{l.productoNombre}</span>
                  <span className="block text-xs text-[var(--texto-suave)] num">
                    Vendidas {formatCantidad(l.cantidad)}{l.devuelto ? ` · ya devueltas ${formatCantidad(l.devuelto)}` : ''} · quedan {formatCantidad(q)}
                  </span>
                </span>
                <input
                  // Todo se vende por unidad desde 0032: el teclado numérico, sin coma.
                  inputMode="numeric" disabled={q <= 0}
                  value={cantidades[l.id!] ?? ''}
                  onChange={(e) => setCantidades((c) => ({ ...c, [l.id!]: e.target.value }))}
                  aria-label={`Unidades de ${l.productoNombre} que vuelven`}
                  placeholder="0"
                  className="tap w-20 px-2 rounded-lg border border-[var(--borde)] num text-right disabled:opacity-40"
                />
              </li>
            );
          })}
        </ul>

        <Campo etiqueta="Motivo" obligatorio ayuda="Va en la nota de crédito y en el historial.">
          {(p) => (
            <input {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} list="motivos-devolucion"
                   className="tap w-full px-3 rounded-xl border border-[var(--borde)]" />
          )}
        </Campo>
        <datalist id="motivos-devolucion">{MOTIVOS.map((m) => <option key={m} value={m} />)}</datalist>

        {fiada ? (
          <p className="tarjeta p-3 text-sm" data-devolucion-fiada>
            Esta venta fue <strong>fiada</strong>: lo devuelto se rebaja de lo que debe el cliente, no se le paga en plata.
          </p>
        ) : (
        <fieldset>
          <legend className="text-sm font-medium mb-1.5">¿Cómo se le devuelve la plata?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['efectivo', 'transferencia', 'debito', 'credito'] as Reembolso[]).map((r) => (
              <label key={r} className={`tap flex items-center gap-2 px-3 rounded-xl border cursor-pointer ${
                reembolso === r ? 'border-marca-500 bg-marca-50 font-semibold' : 'border-[var(--borde)]'}`}>
                <input type="radio" name="reembolso" checked={reembolso === r} onChange={() => setReembolso(r)}
                       className="accent-[var(--color-marca-500)]" />
                {ETIQUETA_PAGO[r] ?? r}
              </label>
            ))}
          </div>
          {reembolso === 'efectivo' && (
            <p className="text-xs text-[var(--texto-suave)] mt-1.5">Sale de tu caja abierta y queda como egreso en el arqueo.</p>
          )}
          {(reembolso === 'debito' || reembolso === 'credito') && (
            <p className="text-xs text-[var(--texto-suave)] mt-1.5">La reversa se hace en la máquina de tarjetas.</p>
          )}
        </fieldset>
        )}

        <div className="tarjeta p-3 flex items-center justify-between">
          <span className="text-sm">Se devuelve</span>
          <span className="text-xl font-bold num">{formatCLP(aDevolver)}</span>
        </div>
        {venta.documentos.some((d) => Number(d.tipo) !== 61) && (
          <p className="text-xs text-[var(--texto-suave)]">Se emite una nota de crédito que corrige la boleta o factura.</p>
        )}
        {(errorCantidad || error) && <p role="alert" className="text-sm text-[var(--color-alerta)]">{errorCantidad ?? error}</p>}

        <button
          onClick={() => void confirmar()}
          disabled={enCurso || !pedido.length || !!errorCantidad || !motivo.trim()}
          className="tap w-full py-3.5 rounded-xl bg-[var(--color-alerta)] text-white font-bold disabled:opacity-50"
        >
          {enCurso ? 'Devolviendo…' : `Devolver ${formatCLP(aDevolver)}`}
        </button>
      </div>
    </Modal>
  );
}
