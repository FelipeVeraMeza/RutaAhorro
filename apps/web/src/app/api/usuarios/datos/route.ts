import { cleanRut, correoDeRut, isValidRut, rutDeCorreo } from '@rutaahorro/core';
import { getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, respuestaError } from '@/lib/supabase/admin';

/**
 * Cambiar el nombre y el RUT de una cuenta (Felipe, 2026-10-07: "ellos pueden
 * cambiar el RUT, la clave y el nombre, editar su perfil a su gusto, pero el
 * admin tiene control completo").
 *
 *   · Cada persona cambia lo suyo (sin `id`, o con su propio `id`).
 *   · El administrador cambia lo de cualquiera de su local.
 *   · El RUT es con lo que se entra: cambiarlo cambia el correo técnico de la
 *     cuenta. Solo en cuentas que ya entran con RUT; la del correo de verdad
 *     (el administrador principal) no se pasa a RUT por acá.
 *
 * El rol, el descuento y desactivar siguen siendo del administrador, en sus
 * propias rutas. El rol del turno lo elige la persona al entrar (/turno).
 */
export async function POST(request: Request) {
  const yo = await getCurrentUser();
  if (!yo || !yo.isActive) return respuestaError('NO_AUTENTICADO', 'Tu sesión expiró. Vuelve a ingresar', 401);

  const cuerpo = await request.json().catch(() => ({}));
  const id = String(cuerpo.id ?? yo.id);
  const nombre = String(cuerpo.nombre ?? '').trim().replace(/\s+/g, ' ');
  const rut = String(cuerpo.rut ?? '').trim();

  if (id !== yo.id && yo.role !== 'admin') {
    return respuestaError('SIN_PERMISO', 'Solo el administrador cambia los datos de otra persona', 403);
  }
  if (nombre.length < 2 || nombre.length > 80) {
    return respuestaError('DATOS_INVALIDOS', 'Escribe el nombre (entre 2 y 80 letras)', 400);
  }
  if (rut && !isValidRut(rut)) {
    return respuestaError('RUT_INVALIDO', 'El RUT no es válido: revisa el dígito verificador', 400);
  }

  const admin = clienteAdmin();
  if (!admin) return respuestaError('SERVIDOR_SIN_LLAVE', 'Falta SUPABASE_SECRET_KEY en el servidor', 500);

  // La cuenta tiene que ser del mismo local: la llave de servicio salta RLS.
  const { data: perfil } = await admin.from('profiles').select('id, tenant_id, email').eq('id', id).maybeSingle();
  if (!perfil || perfil.tenant_id !== yo.tenantId) {
    return respuestaError('NO_ENCONTRADO', 'Esa cuenta no es de tu local', 404);
  }

  const cambios: { email?: string; email_confirm?: boolean; user_metadata: { full_name: string } } = {
    user_metadata: { full_name: nombre },
  };
  let email = perfil.email as string | null;
  if (rut) {
    if (!rutDeCorreo(email)) {
      return respuestaError('SIN_RUT', 'Esta cuenta entra con correo, no con RUT', 400);
    }
    const nuevo = correoDeRut(cleanRut(rut).slice(0, -1));
    if (nuevo !== email) {
      cambios.email = nuevo;
      // Sin esto Supabase manda un correo de confirmación a una casilla que no existe.
      cambios.email_confirm = true;
      email = nuevo;
    }
  }

  const { error } = await admin.auth.admin.updateUserById(id, cambios);
  if (error) {
    return /already|registered|exists/i.test(error.message)
      ? respuestaError('RUT_EN_USO', 'Ese RUT ya es de otra cuenta', 409)
      : respuestaError('ERROR_INTERNO', 'No se pudieron guardar los datos', 500);
  }
  const { error: e2 } = await admin.from('profiles').update({ full_name: nombre, email }).eq('id', id);
  if (e2) return respuestaError('ERROR_INTERNO', 'Se cambió la cuenta, pero no el perfil. Vuelve a guardar', 500);

  await admin.from('audit_log').insert({
    tenant_id: yo.tenantId, user_id: yo.id, action: 'datos_usuario', entity_type: 'profiles', entity_id: id,
    new_values: { nombre, rut: rutDeCorreo(email) },
  });
  return Response.json({ ok: true, rut: rutDeCorreo(email) });
}
