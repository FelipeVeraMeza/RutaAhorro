'use client';

import Link from 'next/link';
import { Modal } from './Modal';

/**
 * Lo que "Salir" pregunta antes de cerrar la sesión (RF-M1-07): ventas hechas
 * sin internet que no se han enviado, y la caja propia todavía abierta
 * (QA-37, docs/26: así nacen las cajas olvidadas de RF-M8-08).
 */
export function DialogosSalir({
  pendientes, cajaAbierta, enviando, onEnviarYSalir, onSalirIgual, onSalirConCaja, onSeguir,
}: {
  pendientes: number;
  cajaAbierta: boolean;
  enviando: boolean;
  onEnviarYSalir: () => void;
  /** Sale sin enviar, pero igual revisa la caja. */
  onSalirIgual: () => void;
  onSalirConCaja: () => void;
  onSeguir: () => void;
}) {
  if (pendientes > 0) {
    return (
      <Modal titulo="Hay ventas sin enviar" encabezado="visible" onCerrar={onSeguir} bloqueado={enviando}>
        <div className="p-5 space-y-3">
          <p className="text-sm">
            {pendientes === 1 ? 'Una venta hecha' : `${pendientes} ventas hechas`} sin internet todavía no
            {pendientes === 1 ? ' llegó' : ' llegaron'} al sistema.
          </p>
          <p className="text-sm text-[var(--texto-suave)]">
            No se pierden: quedan en este celular y se envían cuando vuelvas a entrar con tu cuenta.
            Pero hasta entonces no aparecen en tu caja ni en los reportes.
          </p>
          <button onClick={onEnviarYSalir} disabled={enviando} className="btn btn-primario w-full">
            {enviando ? 'Enviando…' : 'Enviarlas ahora y salir'}
          </button>
          <button onClick={onSalirIgual} disabled={enviando} className="btn btn-secundario w-full">
            Salir igual
          </button>
          <button onClick={onSeguir} disabled={enviando} className="btn btn-fantasma w-full">
            Seguir trabajando
          </button>
        </div>
      </Modal>
    );
  }
  if (!cajaAbierta) return null;
  return (
    <Modal titulo="Tu caja sigue abierta" encabezado="visible" onCerrar={onSeguir}>
      <div className="p-5 space-y-3">
        <p className="text-sm">
          Si terminó tu turno, ciérrala contando el efectivo. Una caja que queda abierta mezcla las ventas
          de hoy con las de mañana y el cierre deja de cuadrar.
        </p>
        <Link href="/caja" onClick={onSeguir} className="btn btn-primario w-full">Ir a cerrar la caja</Link>
        <button onClick={onSalirConCaja} className="btn btn-secundario w-full">Salir igual (sigo después)</button>
        <button onClick={onSeguir} className="btn btn-fantasma w-full">Seguir trabajando</button>
      </div>
    </Modal>
  );
}
