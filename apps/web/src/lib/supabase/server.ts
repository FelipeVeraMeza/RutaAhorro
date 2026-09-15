import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
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

/** Perfil del usuario autenticado, o null si no hay sesión o está desactivado. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
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
    .select('full_name, role, tenant_id, store_id, max_discount_pct, is_active')
    .eq('id', user.id)
    .maybeSingle();

  // Sin perfil, el usuario existe en Auth pero no está vinculado a ningún local.
  // Ver supabase/seed.sql para el procedimiento de vinculación.
  if (!profile) return null;

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
}
