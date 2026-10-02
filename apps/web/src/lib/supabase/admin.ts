import { createClient } from '@supabase/supabase-js';

/**
 * Cliente con la llave de servicio. SOLO en rutas del servidor (RNF-25):
 * salta RLS, así que cada ruta que lo use tiene que verificar antes quién
 * pide y que el usuario tocado sea de su mismo local.
 *
 * Devuelve null si el servidor no tiene la llave: la ruta lo dice en vez de
 * caerse.
 */
export function clienteAdmin() {
  const secreto = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, secreto, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Mínimo de una contraseña, el mismo que pide /recuperar. */
export const MINIMO_CLAVE = 8;

export function respuestaError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Deja autorizada una cuenta antes de crearla (0037): el disparador
 * `handle_new_user` toma el local, la tienda y el rol de `cuentas_autorizadas`,
 * no del metadata (que cualquiera escribe con el registro público).
 *
 * Con una base sin 0037 la tabla no existe y el disparador todavía lee el
 * metadata: se sigue sin error (regla 23, la pantalla no se adelanta a la base).
 */
export async function autorizarCuenta(
  admin: NonNullable<ReturnType<typeof clienteAdmin>>,
  datos: { email: string; tenantId: string; storeId: string | null; rol: string; nombre: string },
): Promise<{ error: string | null }> {
  const { error } = await admin.from('cuentas_autorizadas').upsert({
    email: datos.email.trim().toLowerCase(), tenant_id: datos.tenantId, store_id: datos.storeId,
    role: datos.rol, full_name: datos.nombre,
  });
  if (error && !/cuentas_autorizadas|42P01|PGRST205|does not exist|schema cache/i.test(`${error.code} ${error.message}`)) {
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Retira la autorización si la cuenta no se llegó a crear (el correo ya
 * existía, Supabase falló). Si quedaba, ese correo seguía autorizado para el
 * local y el rol elegidos: el día que alguien lo registrara por su cuenta,
 * entraba con ese rol sin que nadie lo hubiera vuelto a decidir.
 */
export async function retirarAutorizacion(
  admin: NonNullable<ReturnType<typeof clienteAdmin>>, email: string,
): Promise<void> {
  try {
    await admin.from('cuentas_autorizadas').delete().eq('email', email.trim().toLowerCase());
  } catch { /* sin la tabla (base sin 0037) no hay nada que retirar */ }
}
