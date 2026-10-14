'use client';

import { supabase } from './client';

/**
 * El local y la tienda de quien tiene la sesión, para las escrituras que los
 * piden.
 *
 * Antes cada repositorio hacía `auth.getUser()` (un viaje a Supabase Auth en
 * cada guardado) y después `user!.id`: con la sesión vencida reventaba con
 * "Cannot read properties of null" en vez de decir que hay que volver a entrar.
 */
export async function perfilActual(): Promise<{ userId: string; tenantId: string; storeId: string | null }> {
  const client = supabase();
  const { data: { session } } = await client.auth.getSession();
  const userId = session?.user.id;
  if (!userId) throw new Error('NO_AUTENTICADO');
  const { data, error } = await client.from('profiles').select('tenant_id, store_id').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('NO_AUTENTICADO');
  return { userId, tenantId: data.tenant_id as string, storeId: (data.store_id as string | null) ?? null };
}
