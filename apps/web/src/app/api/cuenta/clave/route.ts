import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, MINIMO_CLAVE, respuestaError } from '@/lib/supabase/admin';

/**
 * Cambiar la propia contraseña, con la sesión abierta.
 *
 * Es también la salida de la contraseña temporal: al cambiarla se borra
 * `debe_cambiar_clave`, que vive en app_metadata justamente para que no se
 * pueda borrar desde el navegador sin haber cambiado la clave.
 */
export async function POST(request: Request) {
  const yo = await getCurrentUser();
  if (!yo) return respuestaError('NO_AUTENTICADO', 'Tu sesión expiró. Vuelve a ingresar', 401);

  const cuerpo = await request.json().catch(() => ({}));
  const clave = String(cuerpo.clave ?? '');
  if (clave.length < MINIMO_CLAVE) {
    return respuestaError('CLAVE_CORTA', `La contraseña necesita al menos ${MINIMO_CLAVE} caracteres`, 400);
  }

  // Sin la llave de servicio no se puede borrar la marca de contraseña
  // temporal: la clave cambiaría y la persona volvería a /clave para siempre.
  const admin = clienteAdmin();
  if (yo.debeCambiarClave && !admin) {
    return respuestaError('SERVIDOR_SIN_LLAVE', 'El servidor no tiene configurada la llave de Supabase (SUPABASE_SECRET_KEY)', 500);
  }

  const client = await createClient();
  const { error } = await client.auth.updateUser({ password: clave });
  if (error) {
    const msg = /should be different/i.test(error.message)
      ? ['CLAVE_IGUAL', 'La contraseña nueva tiene que ser distinta de la anterior']
      : /weak|at least|pwned/i.test(error.message)
        ? ['CLAVE_DEBIL', 'Esa contraseña es muy fácil de adivinar. Usa una más larga o con números']
        : ['ERROR_INTERNO', 'No se pudo cambiar la contraseña. Vuelve a intentarlo'];
    return respuestaError(msg[0], msg[1], 400);
  }

  if (admin) {
    await admin.auth.admin.updateUserById(yo.id, { app_metadata: { debe_cambiar_clave: false } });
  }
  return Response.json({ ok: true });
}
