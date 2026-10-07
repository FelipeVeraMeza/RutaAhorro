import { maxDiscountFor, type UserRole } from '@rutaahorro/core';
import { getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, respuestaError } from '@/lib/supabase/admin';

/**
 * El rol del turno (Felipe, 2026-10-07: "cuando inicio sesión me debe dejar
 * tomar la decisión"). La persona elige entre los roles que el administrador
 * le permitió (app_metadata.roles_permitidos, que solo escribe el servidor):
 * hoy vende y cobra, mañana está en bodega. Nadie se da un rol que no tiene
 * permitido, y Administrador no se toma así.
 */
export async function POST(request: Request) {
  const yo = await getCurrentUser();
  if (!yo || !yo.isActive) return respuestaError('NO_AUTENTICADO', 'Tu sesión expiró. Vuelve a ingresar', 401);

  const cuerpo = await request.json().catch(() => ({}));
  const rol = String(cuerpo.rol ?? '');
  const permitidos = yo.rolesPermitidos ?? [];
  if (!permitidos.includes(rol) || rol === 'admin') {
    return respuestaError('SIN_PERMISO', 'Ese rol no lo tienes permitido. Pídeselo al administrador', 403);
  }
  if (rol === yo.role) return Response.json({ ok: true, rol });

  const admin = clienteAdmin();
  if (!admin) return respuestaError('SERVIDOR_SIN_LLAVE', 'Falta SUPABASE_SECRET_KEY en el servidor', 500);

  const { error } = await admin.from('profiles')
    .update({ role: rol, max_discount_pct: maxDiscountFor(rol as UserRole) })
    .eq('id', yo.id).eq('tenant_id', yo.tenantId);
  if (error) return respuestaError('ERROR_INTERNO', 'No se pudo cambiar el rol', 500);

  await admin.from('audit_log').insert({
    tenant_id: yo.tenantId, user_id: yo.id, action: 'rol_del_turno', entity_type: 'profiles', entity_id: yo.id,
    old_values: { rol: yo.role }, new_values: { rol },
  });
  return Response.json({ ok: true, rol });
}
