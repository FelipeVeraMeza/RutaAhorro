'use client';

import { useRef, useState } from 'react';
import { Modal } from './Modal';

/**
 * Cerrar sesión (RF-M1-07), avisando si quedan ventas sin enviar.
 *
 * Antes era un formulario directo: con ventas hechas sin internet en la cola,
 * el cajero salía sin saberlo. Las ventas no se pierden (quedan en el
 * celular y se envían cuando esa misma persona vuelve a entrar), pero hasta
 * entonces no están en la caja ni en los reportes del dueño. Ahora lo dice y
 * ofrece enviarlas antes.
 *
 * También borra las pantallas que el celular guardó para funcionar sin red:
 * la siguiente persona no debe ver la del anterior.
 */
export function BotonSalir({ className, children }: { className?: string; children: React.ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const [pendientes, setPendientes] = useState(0);
  const [enviando, setEnviando] = useState(false);

  async function salir() {
    try {
      if ('caches' in window) {
        for (const k of await caches.keys()) if (k.startsWith('ra-paginas')) await caches.delete(k);
      }
    } catch { /* no impide salir */ }
    form.current?.submit();
  }

  async function alPedirSalir(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { pendingCount } = await import('@/lib/offline/sync');
      const n = await pendingCount();
      if (n > 0) { setPendientes(n); return; }
    } catch { /* sin IndexedDB no hay cola que revisar */ }
    await salir();
  }

  async function enviarYSalir() {
    setEnviando(true);
    try {
      const { syncQueue, pendingCount } = await import('@/lib/offline/sync');
      await syncQueue();
      const quedan = await pendingCount();
      if (quedan > 0) { setPendientes(quedan); setEnviando(false); return; }
    } catch {
      setEnviando(false);
      return;
    }
    await salir();
  }

  return (
    <>
      <form ref={form} action="/api/logout" method="post" onSubmit={(e) => void alPedirSalir(e)}>
        <button className={className}>{children}</button>
      </form>
      {pendientes > 0 && (
        <Modal titulo="Hay ventas sin enviar" encabezado="visible" onCerrar={() => setPendientes(0)} bloqueado={enviando}>
          <div className="p-5 space-y-3">
            <p className="text-sm">
              {pendientes === 1 ? 'Una venta hecha' : `${pendientes} ventas hechas`} sin internet todavía no
              {pendientes === 1 ? ' llegó' : ' llegaron'} al sistema.
            </p>
            <p className="text-sm text-[var(--texto-suave)]">
              No se pierden: quedan en este celular y se envían cuando vuelvas a entrar con tu cuenta.
              Pero hasta entonces no aparecen en tu caja ni en los reportes.
            </p>
            <button onClick={() => void enviarYSalir()} disabled={enviando}
              className="btn btn-primario w-full">
              {enviando ? 'Enviando…' : 'Enviarlas ahora y salir'}
            </button>
            <button onClick={() => void salir()} disabled={enviando} className="btn btn-secundario w-full">
              Salir igual
            </button>
            <button onClick={() => setPendientes(0)} disabled={enviando} className="btn btn-fantasma w-full">
              Seguir trabajando
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
