import { fotoCopiable } from '@rutaahorro/core';
import { getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, respuestaError } from '@/lib/supabase/admin';
import { MAX_BYTES_FOTO, guardarFotoProducto, quitarFotoProducto } from '@/lib/productos/fotos';
import { limitar } from '@/lib/limites';

/**
 * Foto de un producto (RT-50, docs/30).
 *
 *   POST multipart  { productoId, archivo }  → la foto sacada con el celular
 *   POST json       { productoId, url }      → copiar la de Open Food Facts
 *   DELETE          ?productoId=…            → quitarla
 *
 * Quién: los que editan productos (admin, supervisor, bodega; doc 02). El
 * local sale de la sesión, nunca del navegador.
 */
const PUEDEN = ['admin', 'supervisor', 'bodega'];
const ID = /^[0-9a-f-]{36}$/i;

async function preparar() {
  const user = await getCurrentUser();
  if (!user || !user.isActive || !PUEDEN.includes(user.role)) return { error: respuestaError('SIN_PERMISO', 'No puedes cambiar fotos de productos', 403) };
  const db = clienteAdmin();
  if (!db) return { error: respuestaError('SIN_CONFIGURAR', 'El servidor no está configurado para guardar fotos', 503) };
  return { user, db };
}

function falla(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === 'FOTO_FORMATO' || err.code === 'FOTO_PESADA') return respuestaError(err.code, err.message!, 400);
  if (err.code === 'PRODUCTO_NO_ENCONTRADO') return respuestaError(err.code, err.message!, 404);
  console.error('[foto de producto]', e);
  return respuestaError('ERROR_INTERNO', 'No se pudo guardar la foto. Intenta de nuevo.', 500);
}

export async function POST(request: Request) {
  const p = await preparar();
  if ('error' in p) return p.error;
  const { user, db } = p;
  const limite = limitar('foto', user.id);
  if (limite) return limite;

  try {
    if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await request.formData();
      const productoId = String(form.get('productoId') ?? '');
      const archivo = form.get('archivo');
      if (!ID.test(productoId) || !(archivo instanceof File)) return respuestaError('DATOS_INVALIDOS', 'Falta la foto o el producto', 400);
      if (archivo.size > MAX_BYTES_FOTO) return respuestaError('FOTO_PESADA', 'La foto pesa más de 5 MB', 400);
      const url = await guardarFotoProducto(db, user.tenantId, productoId, await archivo.arrayBuffer(), 'foto');
      return Response.json({ url });
    }

    const { productoId, url: origen } = await request.json().catch(() => ({})) as { productoId?: string; url?: string };
    if (!productoId || !ID.test(productoId) || !origen || !fotoCopiable(origen)) {
      return respuestaError('DATOS_INVALIDOS', 'Esa foto no se puede copiar', 400);
    }
    const r = await fetch(origen, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return respuestaError('FOTO_NO_DISPONIBLE', 'No se pudo descargar la foto', 502);
    const largo = Number(r.headers.get('content-length') ?? 0);
    if (largo > MAX_BYTES_FOTO) return respuestaError('FOTO_PESADA', 'La foto pesa más de 5 MB', 400);
    const url = await guardarFotoProducto(db, user.tenantId, productoId, await r.arrayBuffer(), 'off');
    return Response.json({ url });
  } catch (e) {
    return falla(e);
  }
}

export async function DELETE(request: Request) {
  const p = await preparar();
  if ('error' in p) return p.error;
  const productoId = new URL(request.url).searchParams.get('productoId') ?? '';
  if (!ID.test(productoId)) return respuestaError('DATOS_INVALIDOS', 'Falta el producto', 400);
  try {
    await quitarFotoProducto(p.db, p.user.tenantId, productoId);
    return Response.json({ ok: true });
  } catch (e) {
    return falla(e);
  }
}
