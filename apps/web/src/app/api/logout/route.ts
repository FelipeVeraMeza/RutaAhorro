import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DEMO_ACTIVO, DEMO_COOKIE, DEMO_COOKIE_CUENTA } from '@/lib/demo';

/**
 * Cierre de sesión (RF-M1-07).
 * Por POST, no por GET: un enlace GET podría cerrarle la sesión al cajero
 * desde un prefetch del navegador en plena venta.
 */
export async function POST() {
  // Relativa a propósito: detrás de Railway `request.url` es la dirección
  // interna del contenedor, y "Salir" mandaba a https://localhost:8080/login
  // (2026-10-07). Con `/login` el navegador la completa con la dirección
  // pública en que está.
  const salida = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  // En la maqueta la sesión es la cookie de la cuenta de ejemplo: salir la
  // borra y vuelve al ingreso, donde se puede entrar con otro rol.
  if (DEMO_ACTIVO) {
    salida.cookies.delete(DEMO_COOKIE);
    salida.cookies.delete(DEMO_COOKIE_CUENTA);
    return salida;
  }
  const client = await createClient();
  // `local`: cierra solo este dispositivo. Sin el parámetro, signOut cierra
  // TODAS las sesiones del usuario: el dueño salía en el computador y el
  // celular de la caja quedaba fuera a la siguiente renovación del token.
  // Probado contra Supabase el 2026-09-19 (RF-M1-13, RNF-53).
  await client.auth.signOut({ scope: 'local' });
  return salida;
}
