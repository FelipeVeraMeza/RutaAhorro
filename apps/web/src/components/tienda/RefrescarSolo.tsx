'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Vuelve a pedir la página cada `segundos` mientras la pestaña está a la vista
 * (el seguimiento de un pedido). Oculta, no gasta datos del cliente.
 */
export function RefrescarSolo({ segundos }: { segundos: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, segundos * 1000);
    return () => window.clearInterval(t);
  }, [router, segundos]);
  return null;
}
