'use client';

import type { FichaPorCodigo } from '@rutaahorro/core';

/**
 * Fotos y fichas por código desde el formulario de producto (RT-50, docs/30).
 * Todo pasa por /api/productos/*: la escritura necesita la llave de servicio.
 */

async function leerError(r: Response): Promise<string> {
  const j = await r.json().catch(() => null) as { error?: { message?: string } } | null;
  return j?.error?.message ?? `Error ${r.status}`;
}

/** Qué producto es ese código según Open Food Facts. Null si no lo conocen o no responden. */
export async function buscarFichaPorCodigo(codigo: string): Promise<FichaPorCodigo | null> {
  try {
    const r = await fetch(`/api/productos/codigo?c=${encodeURIComponent(codigo)}`);
    if (!r.ok) return null;
    return ((await r.json()) as { ficha: FichaPorCodigo | null }).ficha;
  } catch {
    return null;
  }
}

/**
 * Achica la foto a 800 px por lado y la pasa a JPG: una foto del celular pesa
 * 3–5 MB y en la tienda se ve a 300 px. Sube en un segundo con mala señal.
 */
export async function achicarFoto(archivo: File, lado = 800): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo leer la foto'))), 'image/jpeg', 0.85));
}

export async function subirFotoProducto(productoId: string, foto: Blob): Promise<string> {
  const form = new FormData();
  form.set('productoId', productoId);
  form.set('archivo', new File([foto], 'foto.jpg', { type: foto.type || 'image/jpeg' }));
  const r = await fetch('/api/productos/foto', { method: 'POST', body: form });
  if (!r.ok) throw new Error(await leerError(r));
  return ((await r.json()) as { url: string }).url;
}

export async function copiarFotoProducto(productoId: string, url: string): Promise<string> {
  const r = await fetch('/api/productos/foto', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId, url }),
  });
  if (!r.ok) throw new Error(await leerError(r));
  return ((await r.json()) as { url: string }).url;
}

export async function quitarFotoProducto(productoId: string): Promise<void> {
  const r = await fetch(`/api/productos/foto?productoId=${encodeURIComponent(productoId)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(await leerError(r));
}
