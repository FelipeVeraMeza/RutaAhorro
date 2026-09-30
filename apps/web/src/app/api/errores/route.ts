import { getCurrentUser } from '@/lib/supabase/server';

/**
 * Recibe los errores del navegador (RNF-40) y los deja en el registro del
 * servidor, con quién y en qué local, para poder buscarlos en Railway.
 * Nunca responde con detalles: es un buzón.
 */
export async function POST(request: Request) {
  const texto = (await request.text().catch(() => '')).slice(0, 5000);
  let datos: Record<string, unknown> = {};
  try { datos = JSON.parse(texto); } catch { datos = { crudo: texto.slice(0, 500) }; }
  const user = await getCurrentUser().catch(() => null);
  console.error('[error-navegador]', JSON.stringify({
    ...datos,
    usuario: user?.id ?? null,
    rol: user?.role ?? null,
    local: user?.tenantId ?? null,
    en: new Date().toISOString(),
  }));
  return new Response(null, { status: 204 });
}
