import { leerFichaPorCodigo, normalizeBarcode, urlFichaPorCodigo } from '@rutaahorro/core';
import { getCurrentUser } from '@/lib/supabase/server';
import { respuestaError } from '@/lib/supabase/admin';
import { limitar } from '@/lib/limites';

/**
 * GET /api/productos/codigo?c=7802950004892 — qué producto es ese código,
 * según Open Food Facts (docs/30). Para llenar solo el alta de un producto
 * escaneado que no estaba en el catálogo.
 *
 * Pasa por el servidor y no directo del navegador: así la consulta va con
 * nuestro nombre (lo piden en su API), queda en caché un día y nadie sin
 * sesión usa este servidor para consultar.
 */
const PUEDEN = ['admin', 'supervisor', 'bodega'];

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !user.isActive || !PUEDEN.includes(user.role)) return respuestaError('SIN_PERMISO', 'No puedes crear productos', 403);
  const limite = limitar('ficha', user.id);
  if (limite) return limite;

  const codigo = normalizeBarcode(new URL(request.url).searchParams.get('c') ?? '');
  if (!/^\d{8,14}$/.test(codigo)) return Response.json({ ficha: null });

  try {
    const r = await fetch(urlFichaPorCodigo(codigo), {
      headers: { 'User-Agent': `RutaAhorro/0.1 (${process.env.NEXT_PUBLIC_APP_URL ?? 'sistema de un almacén'})` },
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 86_400 },
    });
    if (!r.ok) {
      if (r.status !== 404) console.warn('[ficha por código]', codigo, r.status);
      return Response.json({ ficha: null });
    }
    return Response.json({ ficha: leerFichaPorCodigo(await r.json()) });
  } catch (e) {
    // Sin respuesta a tiempo: se escribe a mano, como siempre.
    console.warn('[ficha por código]', codigo, e instanceof Error ? e.message : e);
    return Response.json({ ficha: null });
  }
}
