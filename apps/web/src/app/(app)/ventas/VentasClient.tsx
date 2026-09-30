'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCLP, toUserMessage, NOMBRE_DOCUMENTO } from '@rutaahorro/core';
import {
  repoVentas, ETIQUETA_PAGO,
  type Venta, type VentaDetallada, type ResumenVentas,
} from '@/lib/datos/ventas';
import { hoyLocal, hace } from '@/lib/datos/reportes';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { useFormatoFecha } from '@/lib/formatoFecha';
import type { RegistroDte } from '@rutaahorro/core';
import { DocumentoTributario, DevolverVenta, nombreDocumento } from './DocumentoYDevolucion';

/**
 * Historial de ventas y anulación (RF-M5-15).
 *
 * `fn_void_sale` existía, probada, sin ninguna pantalla que la llamara: una
 * venta mal cobrada no tenía arreglo dentro del sistema. El almacenero cobraba
 * de más, se daba cuenta enseguida, y lo único que podía hacer era un ajuste
 * de inventario por un lado y un egreso de caja por el otro, sin nada que los
 * relacionara. Al cuadrar el día, el descuadre no se podía explicar.
 */

const MOTIVOS_SUGERIDOS = [
  'Cobro equivocado',
  'El cliente se arrepintió',
  'Producto equivocado',
  'Cantidad equivocada',
  'Error de digitación',
  'Venta duplicada',
];

/** De a cuántas se traen. "Ver más" pide otras tantas. */
const POR_PAGINA = 50;

export function VentasClient({ puedeAnular, soloPropias = false }: {
  puedeAnular: boolean;
  /** Vendedor: la base le entrega solo las suyas; la pantalla lo dice. */
  soloPropias?: boolean;
}) {
  const { fechaHora, zona } = useFormatoFecha();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [desde, setDesde] = useState(hoyLocal(zona));
  const [hasta, setHasta] = useState(hoyLocal(zona));
  // Recalculado cuando llega la zona del local (una vez, al entrar).
  useEffect(() => { setDesde(hoyLocal(zona)); setHasta(hoyLocal(zona)); }, [zona]);
  const [folio, setFolio] = useState('');
  const [incluirAnuladas, setIncluirAnuladas] = useState(true);

  const [cargando, setCargando] = useState(true);
  const [limite, setLimite] = useState(POR_PAGINA);
  const [resumen, setResumen] = useState<ResumenVentas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [detalle, setDetalle] = useState<VentaDetallada | null>(null);
  const [anulando, setAnulando] = useState<Venta | null>(null);
  const [verDoc, setVerDoc] = useState<RegistroDte | null>(null);
  const [devolviendo, setDevolviendo] = useState<VentaDetallada | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enCurso, setEnCurso] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const n = Number(folio.trim());
      const porFolio = folio.trim() !== '' && Number.isFinite(n);
      const [lista, res] = await Promise.all([
        repoVentas().listar({
          desde, hasta, incluirAnuladas, limite,
          ...(porFolio ? { folio: n } : {}),
        }),
        porFolio ? Promise.resolve(null) : repoVentas().resumen(desde, hasta),
      ]);
      setVentas(lista);
      setResumen(res);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, folio, incluirAnuladas, limite]);

  // Otro filtro vuelve a la primera página.
  useEffect(() => { setLimite(POR_PAGINA); }, [desde, hasta, folio, incluirAnuladas]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 200);
    return () => clearTimeout(t);
  }, [cargar]);

  async function confirmarAnulacion() {
    if (!anulando) return;
    setEnCurso(true);
    setError(null);
    try {
      await repoVentas().anular(anulando.id, motivo.trim());
      setExito(`Venta ${anulando.folio} anulada. El stock volvió al inventario.`);
      setAnulando(null);
      setDetalle(null);
      await cargar();
      setTimeout(() => setExito(null), 8000);
    } catch (e) {
      setError(toUserMessage(e));
      setAnulando(null);
    } finally {
      setEnCurso(false);
    }
  }

  const totalMostrado = ventas.filter((v) => !v.anulada).reduce((s, v) => s + v.total, 0);
  const anuladas = ventas.filter((v) => v.anulada).length;
  const hayMas = ventas.length >= limite;
  const medios = Object.entries(resumen?.porMedio ?? {}).filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg font-semibold">{soloPropias ? 'Mis ventas' : 'Ventas'}</h1>
      <p className="text-xs text-[var(--texto-suave)] mb-3">
        {soloPropias
          ? 'Solo las que cobraste tú. Para anular o devolver, pídeselo a un supervisor.'
          : 'Toca una venta para ver el detalle, sus documentos, devolverla o anularla.'}
      </p>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="text-xs text-[var(--texto-suave)]">
          Desde
          <input
            type="date" value={desde} max={hasta}
            onChange={(e) => setDesde(e.target.value)}
            disabled={folio.trim() !== ''}
            className="tap w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white text-sm num disabled:opacity-50"
          />
        </label>
        <label className="text-xs text-[var(--texto-suave)]">
          Hasta
          <input
            type="date" value={hasta} min={desde} max={hoyLocal(zona)}
            onChange={(e) => setHasta(e.target.value)}
            disabled={folio.trim() !== ''}
            className="tap w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white text-sm num disabled:opacity-50"
          />
        </label>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          type="search" inputMode="numeric" value={folio}
          onChange={(e) => setFolio(e.target.value.replace(/\D/g, ''))}
          placeholder="Buscar por folio…"
          aria-label="Buscar una venta por su folio"
          className="tap flex-1 px-4 py-3 rounded-xl border border-[var(--borde)] bg-white num"
        />
        <button
          onClick={() => { setDesde(hace(6, zona)); setHasta(hoyLocal(zona)); setFolio(''); }}
          className="tap px-3 py-3 rounded-xl border border-[var(--borde)] text-xs shrink-0"
        >
          7 días
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm mb-3">
        <input
          type="checkbox" checked={incluirAnuladas}
          onChange={(e) => setIncluirAnuladas(e.target.checked)}
          className="w-5 h-5"
        />
        Mostrar las anuladas
      </label>

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

      {/* El resumen sale de la base, no de sumar la lista: la lista trae de a
          50 y no resta devoluciones. Con folio, el resumen es la venta misma. */}
      {!cargando && resumen && (resumen.ventas > 0 || resumen.total !== 0) && (
        <div className="mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="tarjeta p-3">
              <p className="num text-lg font-bold">{formatCLP(resumen.total)}</p>
              <p className="text-[11px] text-[var(--texto-suave)]">Vendido (sin anuladas ni devoluciones)</p>
            </div>
            <div className="tarjeta p-3">
              <p className="num text-lg font-bold">{resumen.ventas}</p>
              <p className="text-[11px] text-[var(--texto-suave)]">
                Ventas{resumen.ventas > 0 && ` · ticket ${formatCLP(Math.round(resumen.total / resumen.ventas))}`}
              </p>
            </div>
          </div>
          {medios.length > 0 && (
            <div className="tarjeta p-3">
              <p className="text-[11px] text-[var(--texto-suave)] mb-1">Cobrado por medio de pago</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {medios.map(([m, monto]) => (
                  <li key={m} className="num">
                    {ETIQUETA_PAGO[m] ?? m} <strong>{formatCLP(monto)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {anuladas > 0 && (
            <p className="text-xs text-[var(--texto-suave)]">
              {anuladas} {anuladas === 1 ? 'anulada' : 'anuladas'} en la lista (no suman).
            </p>
          )}
        </div>
      )}
      {!cargando && !resumen && ventas.length > 0 && (
        <div className="tarjeta p-3 mb-3">
          <p className="num text-lg font-bold">{formatCLP(totalMostrado)}</p>
          <p className="text-[11px] text-[var(--texto-suave)]">Folio {folio}</p>
        </div>
      )}

      {cargando ? (
        <p className="text-sm text-[var(--texto-suave)] text-center py-8">Cargando…</p>
      ) : ventas.length === 0 ? (
        <p className="text-center text-sm text-[var(--texto-suave)] py-10">
          {folio.trim() !== ''
            ? `No hay ninguna venta con folio ${folio}.`
            : 'No hay ventas en estas fechas.'}
        </p>
      ) : (
        <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
          {ventas.map((v) => (
            <li key={v.id} className={v.anulada ? 'opacity-60' : ''}>
              <button
                onClick={async () => {
                  setError(null);
                  try { setDetalle(await repoVentas().detalle(v.id)); }
                  catch (e) { setError(toUserMessage(e)); }
                }}
                // El relleno va en el botón y no en la fila: toda la fila se
                // toca, y mide lo que pide RNF-16 (44 px) también en celular.
                className="tap w-full px-4 py-3 text-left flex items-center justify-between gap-3 active:bg-marca-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    Folio <span className="num">{v.folio}</span>
                    {/* Estado con texto, nunca solo con la opacidad (RNF-46) */}
                    {v.anulada && (
                      <span className="ml-2 text-xs font-normal text-[var(--color-alerta)]">
                        · anulada
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--texto-suave)]">
                    {NOMBRE_DOCUMENTO[v.documento.tipo]}
                    {' · '}{fechaHora(v.fecha)}
                    {v.vendedor && ` · ${v.vendedor}`}
                  </p>
                  {v.anulada && v.motivoAnulacion && (
                    <p className="text-xs text-[var(--texto-suave)] italic truncate">
                      {v.motivoAnulacion}
                    </p>
                  )}
                </div>
                <p className={`num font-semibold shrink-0 ${v.anulada ? 'line-through' : ''}`}>
                  {formatCLP(v.total)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!cargando && hayMas && (
        <button
          onClick={() => setLimite((l) => l + POR_PAGINA)}
          className="tap w-full mt-3 py-3 rounded-xl border border-[var(--borde)] text-sm font-medium"
        >
          Ver {POR_PAGINA} más antiguas
        </button>
      )}

      {detalle && (
        <Modal
          titulo={`Venta folio ${detalle.folio}`}
          encabezado="visible"
          onCerrar={() => setDetalle(null)}
          ancho="md"
        >
          <div className="p-5 space-y-3">
            <p className="text-xs text-[var(--texto-suave)]">
              {NOMBRE_DOCUMENTO[detalle.documento.tipo]}
              {' · '}{fechaHora(detalle.fecha)}
              {detalle.vendedor && ` · ${detalle.vendedor}`}
            </p>

            {detalle.documento.receptor && (
              <p className="text-sm bg-[var(--fondo)] px-3 py-2 rounded-lg">
                Factura a <strong>{detalle.documento.receptor.razonSocial}</strong>
                {' · '}<span className="num">{detalle.documento.receptor.rut}</span>
              </p>
            )}

            {detalle.anulada && (
              <p className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
                Anulada{detalle.anuladaEn && ` el ${fechaHora(detalle.anuladaEn)}`}
                {detalle.motivoAnulacion && `: ${detalle.motivoAnulacion}`}
              </p>
            )}

            <ul className="divide-y divide-[var(--borde)] text-sm">
              {detalle.lineas.map((l, i) => (
                <li key={`${l.productoNombre}-${i}`} className="py-2 flex justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate">{l.productoNombre}</span>
                    <span className="text-xs text-[var(--texto-suave)] num">
                      {l.cantidad} × {formatCLP(l.precioUnitario)}
                      {l.descuento > 0 && ` · desc. ${formatCLP(l.descuento)}`}
                    </span>
                  </span>
                  <span className="num shrink-0">{formatCLP(l.subtotal)}</span>
                </li>
              ))}
            </ul>

            <div className="border-t border-[var(--borde)] pt-2 space-y-1 text-sm">
              {detalle.descuento > 0 && (
                <div className="flex justify-between text-[var(--texto-suave)]">
                  <span>Descuento</span>
                  <span className="num">−{formatCLP(detalle.descuento)}</span>
                </div>
              )}
              <div className="flex justify-between text-[var(--texto-suave)] text-xs">
                <span>IVA incluido</span>
                <span className="num">{formatCLP(detalle.iva)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span className="num">{formatCLP(detalle.total)}</span>
              </div>
            </div>

            {detalle.pagos.length > 0 && (
              <p className="text-xs text-[var(--texto-suave)]">
                Pagado con {detalle.pagos.map((p) =>
                  `${ETIQUETA_PAGO[p.metodo] ?? p.metodo} ${formatCLP(p.monto)}`).join(' + ')}
              </p>
            )}

            {/* Documentos tributarios de la venta (0019) */}
            {detalle.documentos.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Documentos</p>
                {detalle.documentos.map((d) => (
                  <button key={d.id} onClick={() => setVerDoc(d)}
                          className="tap w-full px-3 rounded-lg border border-[var(--borde)] text-left text-sm flex items-center justify-between gap-2">
                    <span>
                      {nombreDocumento(d)}
                      {d.ambiente === 'simulacion' && <span className="text-xs text-[var(--texto-suave)]"> · simulada</span>}
                    </span>
                    <span className="num shrink-0">{formatCLP(d.total)} · Ver</span>
                  </button>
                ))}
              </div>
            )}
            {detalle.documentos.length === 0 && detalle.documento.tipo === 'voucher' && (
              <p className="text-xs text-[var(--texto-suave)]">Pagada con tarjeta: el documento es el voucher de la máquina.</p>
            )}

            {detalle.devoluciones.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Devoluciones</p>
                {detalle.devoluciones.map((d) => (
                  <p key={d.numero} className="text-xs bg-[var(--fondo)] px-3 py-2 rounded-lg">
                    N° {d.numero} · {fechaHora(d.fecha)} · <strong className="num">{formatCLP(d.monto)}</strong>
                    {' '}en {ETIQUETA_PAGO[d.reembolso] ?? d.reembolso} · {d.motivo}
                  </p>
                ))}
              </div>
            )}

            {puedeAnular && !detalle.anulada && detalle.lineas.some((l) => l.cantidad > (l.devuelto ?? 0)) && (
              <button
                onClick={() => setDevolviendo(detalle)}
                className="tap w-full py-3 rounded-xl border border-[var(--borde)] font-medium"
              >
                Devolver productos
              </button>
            )}

            {/* Con boleta o factura, o con devoluciones, no se anula: se devuelve
                con nota de crédito (0019). */}
            {puedeAnular && !detalle.anulada && detalle.documentos.length === 0 && detalle.devoluciones.length === 0 && (
              <button
                onClick={() => { setAnulando(detalle); setMotivo(''); }}
                className="tap w-full py-3 rounded-xl border border-[var(--color-alerta)] text-[var(--color-alerta)] font-medium"
              >
                Anular esta venta
              </button>
            )}
          </div>
        </Modal>
      )}

      {verDoc && <DocumentoTributario doc={verDoc} onCerrar={() => setVerDoc(null)} />}

      {devolviendo && (
        <DevolverVenta
          venta={devolviendo}
          onCerrar={() => setDevolviendo(null)}
          onHecho={async (r) => {
            setDevolviendo(null);
            setExito(`Devolución N° ${r.numero} por ${formatCLP(r.monto)}` +
              (r.notaCredito ? ` · ${nombreDocumento(r.notaCredito)}` : ''));
            const actualizado = await repoVentas().detalle(devolviendo.id).catch(() => null);
            setDetalle(actualizado);
            if (r.notaCredito) setVerDoc(r.notaCredito);
            void cargar();
          }}
        />
      )}

      {anulando && (
        <Modal
          titulo={`Anular la venta folio ${anulando.folio}`}
          encabezado="visible"
          onCerrar={() => setAnulando(null)}
          bloqueado={enCurso}
        >
          <div className="p-5 space-y-3">
            <p className="text-sm">
              Se anula la venta de <strong className="num">{formatCLP(anulando.total)}</strong> y
              el stock vuelve al inventario.
            </p>
            <p className="text-xs text-[var(--texto-suave)]">
              La venta no se borra: queda registrada como anulada, con tu nombre, la hora y el
              motivo. El stock vuelve por el historial de inventario, con su propio movimiento.
              Si el producto tiene lotes, vuelve a los lotes exactos de los que salió.
            </p>

            <Campo etiqueta="Motivo" ayuda="Queda escrito en la venta y en el historial.">
              {(props) => (
                <input
                  {...props}
                  value={motivo} onChange={(e) => setMotivo(e.target.value)}
                  list="motivos-anulacion"
                  placeholder="Cobro equivocado"
                  className="tap w-full px-3 py-3 rounded-xl border border-[var(--borde)]"
                  autoFocus
                />
              )}
            </Campo>
            <datalist id="motivos-anulacion">
              {MOTIVOS_SUGERIDOS.map((m) => <option key={m} value={m} />)}
            </datalist>

            <div className="space-y-2 pt-1">
              <button
                onClick={() => void confirmarAnulacion()}
                disabled={enCurso || motivo.trim() === ''}
                className="tap w-full py-3.5 rounded-xl bg-[var(--color-alerta)] text-white font-bold disabled:opacity-50"
              >
                {enCurso ? 'Anulando…' : 'Anular la venta'}
              </button>
              <button
                onClick={() => setAnulando(null)} disabled={enCurso}
                className="tap w-full py-3 rounded-xl border border-[var(--borde)] disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

