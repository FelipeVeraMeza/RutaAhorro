'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';

// Los diálogos se cargan solo al tocar "Salir" con algo pendiente: el botón
// está en el layout de todas las pantallas (RNF-62).
const DialogosSalir = dynamic(() => import('./DialogosSalir').then((m) => m.DialogosSalir), { ssr: false });

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
  // Salir con la caja abierta es como nace una caja olvidada (RF-M8-08).
  const [cajaAbierta, setCajaAbierta] = useState(false);

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
    await revisarCajaYSalir();
  }

  async function revisarCajaYSalir() {
    try {
      const { miCajaAbierta } = await import('@/lib/datos/cajaAbierta');
      if (await miCajaAbierta()) { setPendientes(0); setCajaAbierta(true); return; }
    } catch { /* sin red no se puede saber: no impide salir */ }
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
      {(pendientes > 0 || cajaAbierta) && (
        <DialogosSalir
          pendientes={pendientes} cajaAbierta={cajaAbierta} enviando={enviando}
          onEnviarYSalir={() => void enviarYSalir()}
          onSalirIgual={() => void revisarCajaYSalir()}
          onSalirConCaja={() => void salir()}
          onSeguir={() => { setPendientes(0); setCajaAbierta(false); }}
        />
      )}
    </>
  );
}
