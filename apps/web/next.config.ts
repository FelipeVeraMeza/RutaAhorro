import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';

/**
 * Las variables de entorno viven en UN solo lugar: la raíz del repositorio.
 *
 * Next las busca por defecto dentro de apps/web. En un monorepo eso obligaría a
 * duplicar el archivo (y a que un día queden distintos, que es peor que no
 * tenerlo). Cargamos el .env.local de la raíz antes de construir la config.
 * En Vercel y Railway esto es inofensivo: ahí las variables ya vienen del
 * entorno y dotenv no sobreescribe lo que ya existe.
 */
loadEnv({ path: resolve(process.cwd(), '../../.env.local') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });

/**
 * En Railway la compilación falla con un mensaje claro si falta algo, en vez
 * de publicar algo que no sirve. Pasó el 2026-09-19: el servicio no tenía
 * ninguna variable y la URL pública servía la maqueta, "MODO DEMO · sin
 * sesión", abierta a cualquiera. Las NEXT_PUBLIC_* quedan fijas al compilar,
 * así que tienen que estar antes del build, no solo al arrancar.
 */
if (process.env.RAILWAY_ENVIRONMENT && process.env.npm_lifecycle_event === 'build') {
  const faltan = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_APP_URL']
    .filter((k) => !process.env[k]);
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    faltan.push('SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY)');
  }
  if (faltan.length) {
    throw new Error(`Faltan variables en Railway: ${faltan.join(', ')}. Ver docs/09-despliegue.md`);
  }
  if (process.env.NEXT_PUBLIC_DEMO === 'true') {
    throw new Error('NEXT_PUBLIC_DEMO=true en Railway: la maqueta no se publica. Ponerla en false.');
  }
}

/**
 * Qué código está corriendo (RF-M9-09): el commit que publicó Railway, o el
 * de la carpeta local. Queda fijo al compilar y se muestra en Novedades y al
 * pie del menú, para que "¿ya tienes la versión nueva?" se responda mirando.
 */
function commitActual(): string {
  const deRailway = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (deRailway) return deRailway.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

const config: NextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR=.next-prueba permite compilar y medir la versión de
  // producción sin pisar la carpeta del `npm run dev` que está corriendo (que
  // quedaba sin estilos, 2026-10-09). Railway no la define: usa .next.
  // Ojo: al compilar así, Next agrega la carpeta a tsconfig.json y a
  // next-env.d.ts. Esos dos cambios no se comitean (git checkout -- ambos).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: { NEXT_PUBLIC_COMMIT: commitActual() },
  // Quita el botón flotante "N" de Next.js en desarrollo. Solo aparecía en
  // modo dev (nunca en producción), pero tapaba la barra de navegación.
  devIndicators: false,
  // core se publica como dist compilado, pero transpilarlo permite que Next
  // lo trate como código propio del proyecto (mejor tree-shaking y source maps).
  transpilePackages: ['@rutaahorro/core'],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      // El service worker siempre fresco: si el navegador lo guardara, una
      // versión vieja seguiría decidiendo qué se guarda.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // La cámara se usa para escanear códigos: hay que permitirla
          // explícitamente en el propio origen (RF-M5-01).
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          // RNF-60 · solo por HTTPS de aquí en adelante (el navegador lo
          // recuerda un año), y ninguna ventana de otro sitio puede tomar
          // control de esta.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
