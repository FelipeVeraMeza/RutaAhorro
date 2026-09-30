import { getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, MINIMO_CLAVE, respuestaError } from '@/lib/supabase/admin';

const ROLES = ['admin', 'supervisor', 'vendedor', 'bodega'] as const;

/**
 * Crear la cuenta de un empleado con una contraseña temporal.
 *
 * La invitación por correo (/api/usuarios/invitar) depende de que Supabase
 * tenga autorizada la dirección de la app. En Railway no la tenía: el enlace
 * del correo llevaba a localhost y el vendedor nunca pudo entrar. Esto no pasa
 * por el correo: el administrador le dicta la clave temporal en el local, y
 * la persona la cambia por una suya al primer ingreso (`debe_cambiar_clave`
 * en app_metadata, que solo el servidor puede escribir). Así el administrador
 * no conoce la clave con que se trabaja, que es lo que sostiene la
 * trazabilidad (docs/02).
 */
export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== 'admin') {
    return respuestaError('SIN_PERMISO', 'Solo el administrador crea cuentas', 403);
  }

  const cuerpo = await request.json().catch(() => ({}));
  const nombre = String(cuerpo.nombre ?? '').trim();
  const email = String(cuerpo.email ?? '').trim().toLowerCase();
  const rol = String(cuerpo.rol ?? '');
  const clave = String(cuerpo.clave ?? '');

  if (!nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ROLES.includes(rol as typeof ROLES[number])) {
    return respuestaError('DATOS_INVALIDOS', 'Faltan datos o el rol no es válido', 400);
  }
  if (clave.length < MINIMO_CLAVE) {
    return respuestaError('CLAVE_CORTA', `La contraseña temporal necesita al menos ${MINIMO_CLAVE} caracteres`, 400);
  }

  const admin = clienteAdmin();
  if (!admin) {
    return respuestaError('SERVIDOR_SIN_LLAVE', 'Falta SUPABASE_SECRET_KEY en el servidor', 500);
  }

  const { data: creado, error } = await admin.auth.admin.createUser({
    email,
    password: clave,
    email_confirm: true,
    // El local y la tienda NO vienen del navegador: son los del administrador.
    user_metadata: {
      full_name: nombre,
      tenant_id: actor.tenantId,
      store_id: actor.storeId,
      role: rol,
    },
    app_metadata: { debe_cambiar_clave: true },
  });

  if (error || !creado?.user) {
    const yaExiste = /already|registered|exists/i.test(error?.message ?? '');
    return yaExiste
      ? respuestaError('CORREO_YA_REGISTRADO', 'Ese correo ya tiene un usuario', 409)
      : respuestaError('ERROR_INTERNO', error?.message ?? 'No se pudo crear la cuenta', 500);
  }

  // El perfil lo crea el disparador handle_new_user. Si no apareció, la cuenta
  // no sirve: se borra para no dejar un usuario que entra y queda rechazado.
  const { data: perfil } = await admin
    .from('profiles').select('id').eq('id', creado.user.id).maybeSingle();
  if (!perfil) {
    await admin.auth.admin.deleteUser(creado.user.id).catch(() => {});
    return respuestaError('SIN_PERFIL', 'La cuenta no quedó vinculada al local. Revisa el disparador on_auth_user_created', 500);
  }

  return Response.json({ ok: true, id: creado.user.id });
}
