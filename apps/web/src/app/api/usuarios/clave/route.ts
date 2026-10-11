import { getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, MINIMO_CLAVE, respuestaError } from '@/lib/supabase/admin';

/**
 * El administrador le pone una contraseña temporal a un empleado que olvidó
 * la suya (RF-M1-05). Sin esto la única salida era el correo de recuperación,
 * que en Railway llevaba a localhost.
 *
 * La persona tiene que cambiarla al entrar (`debe_cambiar_clave`). No sirve
 * para la propia cuenta: esa se cambia en /clave, sabiendo la actual sesión.
 */
export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor || !actor.isActive || actor.role !== 'admin') {
    return respuestaError('SIN_PERMISO', 'Solo el administrador restablece contraseñas', 403);
  }

  const cuerpo = await request.json().catch(() => ({}));
  const id = String(cuerpo.id ?? '');
  const clave = String(cuerpo.clave ?? '');
  if (!id) return respuestaError('DATOS_INVALIDOS', 'Falta el usuario', 400);
  if (id === actor.id) {
    return respuestaError('NO_TU_CUENTA', 'Tu propia contraseña se cambia en "Cambiar mi contraseña"', 400);
  }
  if (clave.length < MINIMO_CLAVE) {
    return respuestaError('CLAVE_CORTA', `La contraseña temporal necesita al menos ${MINIMO_CLAVE} caracteres`, 400);
  }

  const admin = clienteAdmin();
  if (!admin) return respuestaError('SERVIDOR_SIN_LLAVE', 'Falta SUPABASE_SECRET_KEY en el servidor', 500);

  // La llave de servicio ve todos los locales: el empleado tiene que ser del
  // mismo local que el administrador, o un admin podría tomar cuentas ajenas.
  const { data: perfil } = await admin
    .from('profiles').select('tenant_id').eq('id', id).maybeSingle();
  if (!perfil || perfil.tenant_id !== actor.tenantId) {
    return respuestaError('NO_ENCONTRADO', 'Ese usuario no es de tu local', 404);
  }

  const { error } = await admin.auth.admin.updateUserById(id, {
    password: clave,
    app_metadata: { debe_cambiar_clave: true },
  });
  // El texto de Supabase viene en inglés y no le sirve a nadie en el local.
  if (error) {
    console.error('[restablecer clave]', error.message);
    return /weak|at least|pwned/i.test(error.message)
      ? respuestaError('CLAVE_DEBIL', 'Esa contraseña es muy fácil de adivinar. Usa una más larga o con números', 400)
      : respuestaError('ERROR_INTERNO', 'No se pudo poner la contraseña temporal. Vuelve a intentarlo', 500);
  }
  return Response.json({ ok: true });
}
