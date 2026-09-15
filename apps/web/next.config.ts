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
