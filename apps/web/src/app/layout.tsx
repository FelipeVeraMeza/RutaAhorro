import type { Metadata, Viewport } from 'next';
import './globals.css';
import { CapturaErrores } from '@/components/CapturaErrores';
import { RegistrarSW } from '@/components/RegistrarSW';
import { SCRIPT_PREFERENCIAS } from '@/lib/preferencias';

export const metadata: Metadata = {
  title: {
    default: 'RutaAhorro',
    template: '%s · RutaAhorro',
  },
  description: 'Inventario, ventas y caja desde el celular',
  manifest: '/manifest.webmanifest',
  // Sin esto el navegador pedía /favicon.ico en cada pantalla y recibía 404.
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'RutaAhorro',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0b1f33',
  width: 'device-width',
  initialScale: 1,
  // No se bloquea el zoom: impedirlo rompe la accesibilidad para quien
  // necesita agrandar. El zoom accidental al enfocar inputs ya está resuelto
  // con font-size: 16px en globals.css.
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: el script de preferencias marca <html> antes
    // de que React llegue (letra grande), y eso no es un error.
    <html lang="es-CL" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_PREFERENCIAS }} />
      </head>
      <body>
        {children}
        <CapturaErrores />
        <RegistrarSW />
      </body>
    </html>
  );
}
