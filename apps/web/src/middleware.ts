import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refresca la sesión en cada petición y protege las rutas privadas.
 *
 * Refrescar aquí es lo que permite que el cajero mantenga la sesión entre
 * turnos sin volver a escribir su clave (RF-M1-06, US-02).
 */
export async function middleware(request: NextRequest) {
  // MODO DEMO: sin sesión, todas las rutas quedan abiertas. Dev-only.
  if (process.env.NEXT_PUBLIC_DEMO === 'true') {
    if (request.nextUrl.pathname.startsWith('/login')) {
      const url = request.nextUrl.clone();
      url.pathname = '/pos';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims y no getUser: la sesión se firma con ES256, así que se verifica
  // acá mismo con la llave pública, que queda en memoria. getUser era un viaje
  // a Supabase (en Canadá) en cada clic, ~250 ms antes de empezar a armar la
  // pantalla. Si el token venció, getClaims lo refresca igual que antes.
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims?.sub ? claims.claims : null;
  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith('/login') || path.startsWith('/recuperar');

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Recordar a dónde iba: tras iniciar sesión vuelve ahí y no al inicio.
    if (path !== '/') url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // Solo /login devuelve al POS a quien ya tiene sesión. /recuperar no: el
  // enlace de una invitación o de recuperación trae una sesión nueva en la
  // URL, y redirigir la perdería.
  if (user && path.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/pos';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Todo salvo estáticos, imágenes y los archivos de la PWA.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
