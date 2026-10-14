'use client';

import { formatCLP, toUserMessage } from '@rutaahorro/core';
import { Modal } from './Modal';
import { useFormatoFecha } from '@/lib/formatoFecha';
import type { QueuedSale } from '@/lib/offline/db';

/**
 * Las ventas hechas sin internet que la base rechazó al sincronizar, con el
 * motivo (QA-29, docs/26). Antes seguían contadas como "por sincronizar".
 */
export function VentasConError({ ventas, reintentando, onReintentar, onCerrar, onDescartar }: {
  ventas: QueuedSale[];
  reintentando: boolean;
  onReintentar: () => void;
  onCerrar: () => void;
  /**
   * Quitar una venta rechazada que ya se resolvió a mano (se volvió a cobrar,
   * se anotó como ingreso). Sin esto la barra roja quedaba para siempre.
   */
  onDescartar?: (clientUuid: string) => void;
}) {
  // Día y hora del local: una venta rechazada puede ser de ayer, y solo con la
  // hora (y en la zona del celular) no se sabía cuál era.
  const { fechaHora } = useFormatoFecha();
  return (
    <Modal titulo="Ventas sin registrar" encabezado="visible" onCerrar={onCerrar}>
      <div className="p-4 space-y-3 text-sm">
        <p>
          Se cobraron sin internet y la base no las aceptó al volver la conexión. La plata ya está en el cajón:
          avísale al administrador antes de cerrar la caja, para que la diferencia tenga explicación.
        </p>
        <ul className="divide-y divide-[var(--borde)] tarjeta">
          {ventas.map((v) => (
            <li key={v.clientUuid} className="p-3">
              <p className="font-medium num">
                {fechaHora(v.soldAt)}
                {' · '}{formatCLP(v.total)} · {v.items.length} {v.items.length === 1 ? 'producto' : 'productos'}
              </p>
              <p className="text-xs text-[var(--texto-suave)]">{v.items.map((i) => i.name).join(', ')}</p>
              <p className="text-xs text-red-900 mt-1">{toUserMessage(v.lastError ?? '')}</p>
              {onDescartar && (
                <button type="button" className="tap mt-1 text-xs underline text-[var(--texto-suave)]"
                  onClick={() => {
                    if (window.confirm('¿Ya la resolviste (la volviste a cobrar o la anotaste en Caja)? Se quita de esta lista y no se puede recuperar.')) {
                      onDescartar(v.clientUuid);
                    }
                  }}>
                  Ya la resolví: quitarla
                </button>
              )}
            </li>
          ))}
        </ul>
        <button onClick={onReintentar} disabled={reintentando} className="btn btn-secundario w-full">
          {reintentando ? 'Reintentando…' : 'Reintentar'}
        </button>
      </div>
    </Modal>
  );
}
