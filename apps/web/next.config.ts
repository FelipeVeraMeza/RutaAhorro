import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

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

const config: NextConfig = {
  reactStrictMode: true,
  // Quita el botón flotante "N" de Next.js en desarrollo. Solo aparecía en
  // modo dev (nunca en producción), pero tapaba la barra de navegación.
  devIndicators: false,
  // core se publica como dist compilado, pero transpilarlo permite que Next
  // lo trate como código propio del proyecto (mejor tree-shaking y source maps).
  transpilePackages: ['@rutaahorro/core'],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // La cámara se usa para escanear códigos: hay que permitirla
          // explícitamente en el propio origen (RF-M5-01).
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
