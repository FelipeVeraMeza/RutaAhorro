'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCLP, toUserMessage, NOMBRE_DOCUMENTO } from '@rutaahorro/core';
import {
  repoVentas, ETIQUETA_PAGO,
  type Venta, type VentaDetallada,
} from '@/lib/datos/ventas';
import { hoyLocal, hace } from '@/lib/datos/reportes';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { useFormatoFecha } from '@/lib/formatoFecha';

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

export function VentasClient({ puedeAnular }: { puedeAnular: boolean }) {
  const { fechaHora, zona } = useFormatoFecha();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [desde, setDesde] = useState(hoyLocal(zona));
  const [hasta, setHasta] = useState(hoyLocal(zona));
  // Recalculado cuando llega la zona del local (una vez, al entrar).
  useEffect(() => { setDesde(hoyLocal(zona)); setHasta(hoyLocal(zona)); }, [zona]);
  const [folio, setFolio] = useState('');
  const [incluirAnuladas, setIncluirAnuladas] = useState(true);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [detalle, setDetalle] = useState<VentaDetallada | null>(null);
  const [anulando, setAnulando] = useState<Venta | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enCurso, setEnCurso] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const n = Number(folio.trim());
      setVentas(await repoVentas().listar({
        desde, hasta, incluirAnuladas,
        ...(folio.trim() !== '' && Number.isFinite(n) ? { folio: n } : {}),
      }));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, folio, incluirAnuladas]);

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

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg font-semibold mb-3">Ventas</h1>

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

      {!cargando && ventas.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="tarjeta p-3">
            <p className="num text-lg font-bold">{formatCLP(totalMostrado)}</p>
            <p className="text-[11px] text-[var(--texto-suave)]">Vendido (sin anuladas)</p>
          </div>
          <div className="tarjeta p-3">
            <p className="num text-lg font-bold">{ventas.length - anuladas}</p>
            <p className="text-[11px] text-[var(--texto-suave)]">
              Ventas{anuladas > 0 && ` · ${anuladas} anulada${anuladas === 1 ? '' : 's'}`}
            </p>
          </div>
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
            <li key={v.id} className={`px-4 py-3 ${v.anulada ? 'opacity-60' : ''}`}>
              <button
                onClick={async () => {
                  setError(null);
                  try { setDetalle(await repoVentas().detalle(v.id)); }
                  catch (e) { setError(toUserMessage(e)); }
                }}
                className="w-full text-left flex items-center justify-between gap-3"
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

            {puedeAnular && !detalle.anulada && (
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

