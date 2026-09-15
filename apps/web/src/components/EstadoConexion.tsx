'use client';

import { useEffect, useState } from 'react';
import { pendingCount, startAutoSync, syncQueue } from '@/lib/offline/sync';

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

  useEffect(() => {
    setOnline(navigator.onLine);
    const refresh = () => void pendingCount().then(setPending);

    const onOnline = () => { setOnline(true); refresh(); };
    const onOffline = () => setOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const stop = startAutoSync(() => refresh());
    refresh();
    const timer = window.setInterval(refresh, 5000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
      stop();
    };
  }, []);

  async function forceSync() {
    setSyncing(true);
    await syncQueue();
    setPending(await pendingCount());
    setSyncing(false);
  }

  // Todo en orden y conectado: no se muestra nada. Un cartel verde permanente
  // se vuelve invisible y roba espacio de pantalla.
  if (online && pending === 0) return null;

  const offlineStyle = !online;

  return (
    <button
      type="button"
      onClick={forceSync}
      disabled={!online || syncing}
      className={`w-full px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 ${
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
