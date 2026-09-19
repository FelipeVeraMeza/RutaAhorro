import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { DEMO_ACTIVO, DEMO_COOKIE, esRolValido, usuarioDemo } from '../demo';

/**
 * Cliente de servidor: actúa COMO EL USUARIO, respetando sus políticas RLS.
 *
 * Nunca usa service_role. Si un componente de servidor necesita datos que el
 * usuario no puede ver, la respuesta correcta es revisar los permisos, no
 * escalar privilegios.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Los componentes de servidor no pueden escribir cookies.
            // El middleware ya refrescó la sesión, así que ignorarlo es correcto.
          }
        },
      },
    },
  );
}

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string;
  role: 'admin' | 'supervisor' | 'vendedor' | 'bodega';
  tenantId: string;
  storeId: string | null;
  maxDiscountPct: number;
  isActive: boolean;
}

/**
 * Cada cuánto se refresca `last_seen_at`, en minutos.
 *
 * La pantalla de Usuarios considera conectado a quien tuvo actividad en los
 * últimos 5 (RF-M1-14), así que con 2 la marca nunca se enfría estando alguien
 * navegando, y no se escribe una fila en cada clic.
 */
const MINUTOS_ENTRE_MARCAS = 2;

/**
 * Deja constancia de que el usuario está usando el sistema.
 *
 * `last_seen_at` está en la tabla de perfiles desde el primer día y **nadie la
 * escribía**. La pantalla de Usuarios la lee para decir quién está conectado y
 * cuándo entró por última vez, así que en producción todos aparecían como
 * "Nunca ha entrado · ⚪ Desconectado", para siempre. Se veía bien solo en modo
 * demo, porque los datos de ejemplo traen la hora ya puesta: el requerimiento
 * figuraba cumplido y lo único que funcionaba era la maqueta.
 *
 * Si la escritura falla no pasa nada: es un dato de conveniencia, y nadie debe
 * quedarse fuera del sistema porque no se pudo anotar la hora.
 */
async function marcarActividad(
  client: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ultima: string | null,
) {
  const frescura = ultima ? Date.now() - new Date(ultima).getTime() : Infinity;
  if (frescura < MINUTOS_ENTRE_MARCAS * 60_000) return;
  try {
    await client.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId);
  } catch {
    // Ver arriba: no es motivo para romper la navegación.
  }
}

/**
 * Perfil del usuario autenticado, o null si no hay sesión o está desactivado.
 *
 * Memorizado por petición con `cache`: el layout y la página lo pedían cada
 * uno por su lado, y cada llamada son dos viajes a Supabase (sesión y perfil).
 * Con la base en Canadá eran ~1,2 s de espera en cada pantalla solo en esto.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // MODO DEMO: devuelve un usuario ficticio sin consultar Supabase.
  // Ver src/lib/demo/index.ts — solo se activa con NEXT_PUBLIC_DEMO=true.
  if (DEMO_ACTIVO) {
    const rol = (await cookies()).get(DEMO_COOKIE)?.value;
    return usuarioDemo(esRolValido(rol) ? rol : 'admin');
  }

  const client = await createClient();

  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const { data: profile } = await client
    .from('profiles')
    .select('full_name, role, tenant_id, store_id, max_discount_pct, is_active, last_seen_at')
    .eq('id', user.id)
    .maybeSingle();

  // Sin perfil, el usuario existe en Auth pero no está vinculado a ningún local.
  // Ver supabase/seed.sql para el procedimiento de vinculación.
  if (!profile) return null;

  // Sin await: anotar la hora no debe hacer esperar a la pantalla.
  void marcarActividad(client, user.id, profile.last_seen_at as string | null);

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile.full_name,
    role: profile.role,
    tenantId: profile.tenant_id,
    storeId: profile.store_id,
    maxDiscountPct: Number(profile.max_discount_pct ?? 0),
    isActive: profile.is_active,
  };
});
