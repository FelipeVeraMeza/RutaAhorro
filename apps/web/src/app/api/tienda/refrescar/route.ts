import { getCurrentUser } from '@/lib/supabase/server';
import { respuestaError } from '@/lib/supabase/admin';
import { refrescarTienda } from '@/lib/tienda/catalogo';

/**
 * POST /api/tienda/refrescar — la tienda online vuelve a leer el catálogo.
 *
 * La llama la app después de cambiar un producto (lib/productos/index.ts):
 * sin esto, un precio nuevo tardaba hasta la próxima renovación de la copia
 * (60 s o más) en verse en la tienda. Solo con sesión de alguien del local:
 * botar la copia sin parar haría que cada visita fuera a la base.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user || !user.isActive) return respuestaError('NO_AUTENTICADO', 'Inicia sesión', 401);
  refrescarTienda();
  return Response.json({ ok: true });
}
