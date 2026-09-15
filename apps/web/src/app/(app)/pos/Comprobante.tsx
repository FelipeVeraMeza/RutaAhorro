'use client';

import { useState } from 'react';
import {
  formatCLP, comprobanteATexto, fechaComprobante, nombreMetodo,
  type Comprobante as DatosComprobante,
} from '@rutaahorro/core';

/**
 * Comprobante que se le muestra y entrega al cliente (RF-M5-14).
 *
 * Aparece apenas se confirma la venta, sin esperar a la red: el folio llega
 * después, cuando la cola sincroniza (ADR-005). Mientras tanto se muestra como
 * pendiente en vez de inventar un número.
 *
 * **No es un documento tributario y lo dice en pantalla y en el papel.** Ver
 * docs/18-documentos-tributarios-sii.md.
 */
export function Comprobante({
  datos, onCerrar,
}: {
  datos: DatosComprobante;
  onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const texto = comprobanteATexto(datos);

  async function compartir() {
    // La API nativa abre el selector del sistema: WhatsApp, correo, lo que
    // tenga el celular. Es lo que el cajero ya sabe usar.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text: texto });
        return;
      } catch {
        // El usuario canceló, o el navegador la rechazó. Se cae al respaldo.
      }
    }
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Comprobante de la venta"
    >
      <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="px-4 pt-4 pb-3 text-center border-b border-[var(--borde)]">
          <p className="text-3xl mb-1" aria-hidden>✅</p>
          <h2 className="text-base font-semibold">Venta registrada</h2>
          <p className="text-2xl font-bold mt-1">{formatCLP(datos.total)}</p>
        </div>

        {/* El ticket. Es lo único que se imprime. */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div id="ticket" className="font-mono text-[12px] leading-5 text-black">
            <div className="text-center mb-2">
              {datos.local && <p className="font-bold text-[13px]">{datos.local}</p>}
              <p className="font-bold">COMPROBANTE INTERNO</p>
              <p className="text-[11px]">NO ES DOCUMENTO TRIBUTARIO</p>
            </div>

            <p>{fechaComprobante(datos.fecha)}</p>
            <p>
              {datos.folio != null
                ? `N° ${datos.folio}`
                : 'N° pendiente de sincronizar'}
            </p>
            {datos.cajero && <p>Atendió: {datos.cajero}</p>}

            <div className="border-t border-dashed border-black my-2" />

            {datos.lineas.map((l, i) => (
              <div key={i}>
                <div className="flex justify-between gap-2">
                  <span className="truncate">{l.cantidad} x {l.nombre}</span>
                  <span className="shrink-0">{formatCLP(l.subtotal)}</span>
                </div>
                {l.descuento > 0 && (
                  <div className="flex justify-between gap-2 text-[11px]">
                    <span>&nbsp;&nbsp;descuento</span>
                    <span>-{formatCLP(l.descuento)}</span>
                  </div>
                )}
              </div>
            ))}

            <div className="border-t border-dashed border-black my-2" />

            {datos.descuento > 0 && (
              <>
                <Fila izq="Subtotal" der={formatCLP(datos.subtotal)} />
                <Fila izq="Descuento" der={`-${formatCLP(datos.descuento)}`} />
              </>
            )}
            <Fila izq="Neto" der={formatCLP(datos.neto)} />
            <Fila izq={`IVA (${datos.ivaPct}%)`} der={formatCLP(datos.iva)} />
            <div className="flex justify-between font-bold text-[14px] mt-1">
              <span>TOTAL</span>
              <span>{formatCLP(datos.total)}</span>
            </div>

            <div className="border-t border-dashed border-black my-2" />

            {datos.pagos.map((p, i) => (
              <Fila key={i} izq={nombreMetodo(p.metodo)} der={formatCLP(p.recibido ?? p.monto)} />
            ))}
            {datos.vuelto > 0 && <Fila izq="Vuelto" der={formatCLP(datos.vuelto)} />}

            <p className="text-center text-[10px] mt-3">¡Gracias por su compra!</p>
          </div>
        </div>

        <div
          className="px-4 pt-3 pb-4 border-t border-[var(--borde)] no-imprimir"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          {copiado && (
            <p role="status" className="text-xs text-center text-[var(--texto-suave)] mb-2">
              Comprobante copiado. Pégalo en WhatsApp.
            </p>
          )}
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => void compartir()}
              className="tap flex-1 py-3 rounded-xl border border-[var(--borde)] font-semibold text-sm"
            >
              Compartir
            </button>
            <button
              onClick={() => window.print()}
              className="tap flex-1 py-3 rounded-xl border border-[var(--borde)] font-semibold text-sm"
            >
              Imprimir
            </button>
          </div>
          <button
            onClick={onCerrar}
            className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold active:bg-marca-600"
          >
            Nueva venta
          </button>
        </div>
      </div>
    </div>
  );
}

function Fila({ izq, der }: { izq: string; der: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{izq}</span>
      <span>{der}</span>
    </div>
  );
}
