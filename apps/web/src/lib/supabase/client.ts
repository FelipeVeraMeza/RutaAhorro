'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente del navegador. Usa la llave pública (anon).
 *
 * Su seguridad depende 100 % de que RLS esté activo en todas las tablas: esta
 * llave viaja al celular de cualquier persona que abra la app.
 * Ver docs/07-arquitectura.md §5.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

let singleton: ReturnType<typeof createBrowserClient> | null = null;

/** Instancia única: crear un cliente por render rompe la sesión en tiempo real. */
export function supabase() {
  if (!singleton) singleton = createClient();
  return singleton;
}
