import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Cierre de sesión (RF-M1-07).
 * Por POST, no por GET: un enlace GET podría cerrarle la sesión al cajero
 * desde un prefetch del navegador en plena venta.
 */
export async function POST(request: Request) {
  const client = await createClient();
  await client.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
