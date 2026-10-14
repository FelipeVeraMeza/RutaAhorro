import { getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, respuestaError } from '@/lib/supabase/admin';

/** Los que se pueden tomar al iniciar el turno. Administrador nunca: ese rol no se elige. */
const TURNOS = ['supervisor', 'vendedor', 'bodega'] as const;

/**
 * Qué roles puede elegir una persona al entrar (/turno): "hoy vendo, mañana
 * estoy en bodega" (Felipe, 2026-10-07).
 *
 * /turno y /api/cuenta/rol leen `app_metadata.roles_permitidos`, pero nada lo
 * escribía: el administrador no tenía cómo darlo sin entrar al panel de
 * Supabase. Vive en app_metadata porque solo el servidor la escribe: nadie se
 * da un rol a sí mismo.
 *
 *   POST { id, roles: ['vendedor', 'bodega'] }   · con uno o ninguno, no se pregunta al entrar
 */
export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor || !actor.isActive || actor.role !== 'admin') {
    return respuestaError('SIN_PERMISO', 'Solo el administrador decide los turnos', 403);
  }
  const cuerpo = await request.json().catch(() => ({})) as { id?: unknown; roles?: unknown };
  const id = String(cuerpo.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuestaError('DATOS_INVALIDOS', 'Falta la persona', 400);
  if (!Array.isArray(cuerpo.roles)) return respuestaError('DATOS_INVALIDOS', 'Faltan los roles', 400);
  const roles = [...new Set(cuerpo.roles.map(String))];
  if (roles.some((r) => !(TURNOS as readonly string[]).includes(r))) {
    return respuestaError('DATOS_INVALIDOS', 'Esos roles no se pueden elegir al entrar', 400);
  }

  const admin = clienteAdmin();
  if (!admin) return respuestaError('SERVIDOR_SIN_LLAVE', 'Falta SUPABASE_SECRET_KEY en el servidor', 500);

  // La llave de servicio salta RLS: la cuenta tiene que ser de este local.
  const { data: perfil } = await admin.from('profiles').select('tenant_id, role').eq('id', id).maybeSingle();
  if (!perfil || perfil.tenant_id !== actor.tenantId) {
    return respuestaError('NO_ENCONTRADO', 'Esa cuenta no es de tu local', 404);
  }
  if (perfil.role === 'admin') {
    return respuestaError('DATOS_INVALIDOS', 'El administrador no elige turno: ya puede hacer todo', 400);
  }

  const { error } = await admin.auth.admin.updateUserById(id, {
    app_metadata: { roles_permitidos: roles.length > 1 ? roles : null },
  });
  if (error) return respuestaError('ERROR_INTERNO', 'No se pudieron guardar los turnos', 500);

  await admin.from('audit_log').insert({
    tenant_id: actor.tenantId, user_id: actor.id, action: 'roles_del_turno', entity_type: 'profiles', entity_id: id,
    new_values: { roles },
  });
  return Response.json({ ok: true, roles: roles.length > 1 ? roles : [] });
}
