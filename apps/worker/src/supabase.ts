import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Cliente administrativo: OMITE RLS.
 *
 * Es la única pieza del sistema con este poder, y por eso vive solo en el
 * worker. Nunca debe importarse desde código que llegue al navegador.
 * Ver docs/07-arquitectura.md §5.
 */
export const admin: SupabaseClient = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'x-application-name': 'rutaahorro-worker' } },
});

/** Todos los tenants activos. Los trabajos programados iteran sobre esto. */
export async function activeTenants(): Promise<Array<{ id: string; name: string; settings: Record<string, unknown> }>> {
  const { data, error } = await admin
    .from('tenants')
    .select('id, name, settings')
    .eq('status', 'activo');
  if (error) throw new Error(`No se pudieron leer los tenants: ${error.message}`);
  return data ?? [];
}

/** Registra la ejecución de un trabajo para poder auditar qué corrió y qué falló. */
export async function recordJobRun(
  jobName: string,
  fn: () => Promise<Record<string, unknown> | void>,
): Promise<{ ok: boolean; details?: unknown; error?: string }> {
  const startedAt = new Date().toISOString();
  const { data: row, error: eInsert } = await admin
    .from('job_runs')
    .insert({ job_name: jobName, status: 'running', started_at: startedAt })
    .select('id')
    .single();
  // Sin fila, los `update ... eq('id', undefined)` de abajo fallaban en
  // silencio y el trabajo no quedaba registrado ni como error. Se deja dicho
  // en el log y el trabajo corre igual (un respaldo no se salta por esto).
  if (eInsert || !row) {
    console.error(`[job_runs] no se pudo registrar el inicio de ${jobName}: ${eInsert?.message ?? 'sin fila'}`);
    try {
      return { ok: true, details: (await fn()) ?? {} };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const details = (await fn()) ?? {};
    await admin
      .from('job_runs')
      .update({ status: 'ok', finished_at: new Date().toISOString(), details })
      .eq('id', row?.id);
    return { ok: true, details };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from('job_runs')
      .update({
        status: 'error',
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq('id', row?.id);
    return { ok: false, error: message };
  }
}

/**
 * Todas las filas de una consulta, de a 1.000 (la API de Supabase no entrega
 * más, y no avisa que cortó). Igual que `todasLasFilas` de la web: la consulta
 * tiene que traer un orden estable que termine en una columna única.
 */
export async function todasLasFilas<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tope = 100_000,
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; desde < tope; desde += 1000) {
    const { data, error } = await pedir(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return filas;
}
