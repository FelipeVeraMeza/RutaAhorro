'use client';

import { useState } from 'react';

/** Compartir la ficha: el menú del celular si existe; si no, copia el enlace. */
export function Compartir({ titulo }: { titulo: string }) {
  const [copiado, setCopiado] = useState(false);
  async function compartir() {
    const url = location.href;
    try {
      if (navigator.share) { await navigator.share({ title: titulo, url }); return; }
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch { /* el cliente cerró el menú de compartir */ }
  }
  return (
    <button type="button" className="btn btn-fantasma btn-chico" onClick={compartir}>
      {copiado ? 'Enlace copiado ✓' : 'Compartir'}
    </button>
  );
}
