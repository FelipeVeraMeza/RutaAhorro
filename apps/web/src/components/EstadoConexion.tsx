'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { QueuedSale } from '@/lib/offline/db';

// El detalle (diálogo y mensajes) se carga solo si hay ventas rechazadas:
// esta barra está en el layout de todas las pantallas (RNF-62).
const VentasConError = dynamic(() => import('./VentasConError').then((m) => m.VentasConError), { ssr: false });

// RNF-62 · La cola (Supabase + IndexedDB, ~135 kB) se carga después de
// pintar: el layout la tenía en la primera carga de TODAS las pantallas.
const cola = () => import('@/lib/offline/sync');

/**
 * Indicador permanente de conexión y ventas por sincronizar (RF-M5-19).
 *
 * Es el elemento que sostiene la confianza en el modo offline: el cajero
 * necesita saber, sin preguntar, que sus ventas están guardadas y cuántas
 * faltan por subir. Sin esto, la primera caída de internet genera pánico.
 */
export function EstadoConexion() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [conError, setConError] = useState<QueuedSale[]>([]);
  const [viendoErrores, setViendoErrores] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    let vivo = true;
    let stop = () => {};
    let timer = 0;
    const refresh = () => void cola().then(async (m) => {
      const [n, errores] = await Promise.all([m.pendingCount(), m.ventasConError()]);
      if (vivo) { setPending(n); setConError(errores); }
    });

    const onOnline = () => { setOnline(true); refresh(); };
    const onOffline = () => setOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    void cola().then(({ startAutoSync }) => {
      if (!vivo) return;
      stop = startAutoSync(() => refresh());
      refresh();
      timer = window.setInterval(refresh, 5000);
    });

    return () => {
      vivo = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
      stop();
    };
  }, []);

  async function forceSync() {
    setSyncing(true);
    // Con un error a mitad (IndexedDB, red) el botón quedaba en "enviando…"
    // para siempre y no se podía volver a tocar.
    try {
      const { syncQueue, pendingCount, ventasConError } = await cola();
      await syncQueue();
      setPending(await pendingCount());
      setConError(await ventasConError());
    } catch { /* se reintenta sola cada minuto, o con otro toque */ } finally {
      setSyncing(false);
    }
  }

  async function descartar(clientUuid: string) {
    try {
      const { db } = await import('@/lib/offline/db');
      await db().saleQueue.delete(clientUuid);
      const { pendingCount, ventasConError } = await cola();
      setPending(await pendingCount());
      const quedan = await ventasConError();
      setConError(quedan);
      if (quedan.length === 0) setViendoErrores(false);
    } catch { /* se puede intentar de nuevo */ }
  }

  // Todo en orden y conectado: no se muestra nada. Un cartel verde permanente
  // se vuelve invisible y roba espacio de pantalla.
  if (online && pending === 0) return null;

  // Ventas que la base rechazó: se dice cuántas y por qué, no "por sincronizar".
  if (online && conError.length > 0) {
    return (
      <>
        <button type="button" onClick={() => setViendoErrores(true)}
          className="w-full px-4 py-2 min-h-11 text-xs font-medium flex items-center justify-center gap-2 bg-red-50 text-red-900">
          <span aria-hidden>⚠️</span>
          <span className="num">{conError.length} {conError.length === 1 ? 'venta no se pudo registrar' : 'ventas no se pudieron registrar'}</span>
          <span className="underline">ver por qué</span>
        </button>
        {viendoErrores && (
          <VentasConError ventas={conError} reintentando={syncing}
                          onReintentar={() => void forceSync()} onCerrar={() => setViendoErrores(false)}
                          onDescartar={(id) => void descartar(id)} />
        )}
      </>
    );
  }

  const offlineStyle = !online;

  return (
    <button
      type="button"
      onClick={forceSync}
      disabled={!online || syncing}
      className={`w-full px-4 py-2 min-h-11 text-xs font-medium flex items-center justify-center gap-2 ${
        offlineStyle ? 'bg-amber-100 text-amber-900' : 'bg-blue-50 text-blue-900'
      }`}
    >
      <span aria-hidden>{offlineStyle ? '⚠️' : '↑'}</span>
      {offlineStyle ? 'Sin conexión' : 'Conectado'}
      {pending > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="num">
            {pending} {pending === 1 ? 'venta' : 'ventas'} por sincronizar
          </span>
          {online && <span className="underline">{syncing ? 'enviando…' : 'enviar ahora'}</span>}
        </>
      )}
      {offlineStyle && pending === 0 && <span>· puedes seguir vendiendo</span>}
    </button>
  );
}
