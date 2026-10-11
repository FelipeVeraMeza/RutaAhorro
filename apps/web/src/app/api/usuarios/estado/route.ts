import { getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, respuestaError } from '@/lib/supabase/admin';

/**
 * Lo que solo ve la llave de servicio de cada cuenta del local (app_metadata):
 *
 *   · claveTemporal · quién todavía no cambia la contraseña temporal que le
 *     dio el administrador (RF-M1-20).
 *   · roles         · los roles que puede elegir al iniciar el turno (/turno).
 *
 * Antes pedía cada cuenta por separado (hasta 200 viajes a Supabase por cada
 * vez que se abría Usuarios); ahora lee la lista de cuentas por páginas.
 */
export async function GET() {
  const actor = await getCurrentUser();
  if (!actor || !actor.isActive || actor.role !== 'admin') {
    return respuestaError('SIN_PERMISO', 'Solo el administrador ve el estado de las cuentas', 403);
  }
  const admin = clienteAdmin();
  if (!admin) return respuestaError('SERVIDOR_SIN_LLAVE', 'Falta SUPABASE_SECRET_KEY en el servidor', 500);

  const { data: perfiles, error } = await admin
    .from('profiles').select('id').eq('tenant_id', actor.tenantId).limit(1000);
  if (error) return respuestaError('ERROR_INTERNO', 'No se pudo leer el estado de las cuentas', 500);
  const delLocal = new Set((perfiles ?? []).map((p) => p.id as string));

  const claveTemporal: string[] = [];
  const roles: Record<string, string[]> = {};
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error: e } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (e) return respuestaError('ERROR_INTERNO', 'No se pudo leer el estado de las cuentas', 500);
    for (const u of data.users) {
      if (!delLocal.has(u.id)) continue;
      const meta = (u.app_metadata ?? {}) as { debe_cambiar_clave?: boolean; roles_permitidos?: unknown };
      if (meta.debe_cambiar_clave === true) claveTemporal.push(u.id);
      if (Array.isArray(meta.roles_permitidos)) roles[u.id] = meta.roles_permitidos.map(String);
    }
    if (data.users.length < 1000) break;
  }
  return Response.json({ claveTemporal, roles });
}
