import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'RutaAhorro',
    template: '%s · RutaAhorro',
  },
  description: 'Inventario, ventas y caja desde el celular',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'RutaAhorro',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#17804f',
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
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
