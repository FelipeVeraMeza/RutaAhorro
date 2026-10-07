import { createClient } from '@supabase/supabase-js';

/**
 * Cliente con la llave de servicio. SOLO en rutas del servidor (RNF-25):
 * salta RLS, así que cada ruta que lo use tiene que verificar antes quién
 * pide y que el usuario tocado sea de su mismo local.
 *
 * Devuelve null si el servidor no tiene la llave: la ruta lo dice en vez de
 * caerse.
 */
export function clienteAdmin() {
  const secreto = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, secreto, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Mínimo de una contraseña: vive en el core, el mismo para pantallas y rutas. */
export { MINIMO_CLAVE } from '@rutaahorro/core';

export function respuestaError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}
