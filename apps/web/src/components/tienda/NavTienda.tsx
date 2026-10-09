'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icono, type NombreIcono } from '@/components/Icono';

/**
 * Las pestañas de la tienda: arriba en el computador (con la raya naranja en
 * la activa, como la maqueta) y abajo en el celular, al alcance del pulgar.
 *
 * En el dominio de la tienda las rutas se ven sin "/tienda" (el middleware
 * reescribe), así que la activa se reconoce por el final de la ruta.
 */
const PESTANAS: Array<{ href: string; texto: string; icono: NombreIcono; ruta: string }> = [
  { href: '/tienda', texto: 'Inicio', icono: 'inicio', ruta: '' },
  { href: '/tienda/productos', texto: 'Productos', icono: 'productos', ruta: '/productos' },
  { href: '/tienda/ofertas', texto: 'Ofertas', icono: 'precio', ruta: '/ofertas' },
  { href: '/tienda/cuenta', texto: 'Mi cuenta', icono: 'cuenta', ruta: '/cuenta' },
];

function activa(path: string, ruta: string) {
  const resto = path.replace(/^\/tienda/, '').replace(/\/$/, '');
  if (ruta === '') return resto === '';
  // La ficha de un producto cuenta como "Productos".
  return resto.startsWith(ruta) || (ruta === '/productos' && resto.startsWith('/p/'));
}

export function PestanasArriba() {
  const path = usePathname();
  return (
    <nav aria-label="Secciones" className="hidden md:flex items-stretch gap-2 lg:gap-6 h-full">
      {PESTANAS.map((p) => {
        const on = activa(path, p.ruta);
        return (
          <Link key={p.href} href={p.href} aria-current={on ? 'page' : undefined}
            className={`relative px-3 grid place-items-center font-semibold text-[1.0625rem] transition-colors
              ${on ? 'text-white' : 'text-white/80 hover:text-white'}`}>
            {p.texto}
            {on && <span aria-hidden className="absolute left-3 right-3 bottom-3 h-[3px] rounded-full bg-acento-500" />}
          </Link>
        );
      })}
    </nav>
  );
}

export function PestanasAbajo() {
  const path = usePathname();
  return (
    <nav aria-label="Secciones" className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-[var(--superficie)] border-t border-[var(--borde)]
      pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        {PESTANAS.map((p) => {
          const on = activa(path, p.ruta);
          return (
            <li key={p.href}>
              <Link href={p.href} aria-current={on ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 h-16 text-xs font-semibold
                  ${on ? 'text-marca-500' : 'text-[var(--texto-suave)]'}`}>
                <Icono nombre={p.icono} tamano={24} className={on ? 'text-acento-500' : ''} />
                {p.texto}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
