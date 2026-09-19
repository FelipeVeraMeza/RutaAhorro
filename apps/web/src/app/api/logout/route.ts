import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Cierre de sesión (RF-M1-07).
 * Por POST, no por GET: un enlace GET podría cerrarle la sesión al cajero
 * desde un prefetch del navegador en plena venta.
 */
export async function POST(request: Request) {
  const client = await createClient();
  // `local`: cierra solo este dispositivo. Sin el parámetro, signOut cierra
  // TODAS las sesiones del usuario: el dueño salía en el computador y el
  // celular de la caja quedaba fuera a la siguiente renovación del token.
  // Probado contra Supabase el 2026-09-19 (RF-M1-13, RNF-53).
  await client.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
