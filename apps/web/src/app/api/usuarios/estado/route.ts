import { getCurrentUser } from '@/lib/supabase/server';
import { clienteAdmin, respuestaError } from '@/lib/supabase/admin';

/**
 * Quién todavía no cambia la contraseña temporal que le dio el administrador
 * (RF-M1-20). La marca vive en app_metadata, que solo ve la llave de servicio:
 * por eso pasa por el servidor. Solo cuentas del mismo local.
 */
export async function GET() {
  const actor = await getCurrentUser();
  if (!actor || !actor.isActive || actor.role !== 'admin') {
    return respuestaError('SIN_PERMISO', 'Solo el administrador ve el estado de las cuentas', 403);
  }
  const admin = clienteAdmin();
  if (!admin) return respuestaError('SERVIDOR_SIN_LLAVE', 'Falta SUPABASE_SECRET_KEY en el servidor', 500);

  const { data: perfiles, error } = await admin
    .from('profiles').select('id').eq('tenant_id', actor.tenantId).eq('is_active', true).limit(200);
  if (error) return respuestaError('ERROR_INTERNO', error.message, 500);

  const cuentas = await Promise.all((perfiles ?? []).map(async (p) => {
    const { data } = await admin.auth.admin.getUserById(p.id as string);
    return data?.user?.app_metadata?.debe_cambiar_clave === true ? (p.id as string) : null;
  }));
  return Response.json({ claveTemporal: cuentas.filter(Boolean) });
}
