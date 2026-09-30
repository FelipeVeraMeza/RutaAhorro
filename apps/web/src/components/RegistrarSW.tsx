'use client';

import { useEffect } from 'react';

/**
 * Instala el service worker (public/sw.js) en producción. En desarrollo no:
 * guardaría pantallas a medio compilar y confundiría más de lo que ayuda.
 */
export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}
