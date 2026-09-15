'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navMovil, type Rol } from '@/lib/navegacion';

/**
 * Navegación inferior del celular.
 *
 * Va abajo porque la app se opera con el pulgar, de pie y con una sola mano
 * (RNF-17). Se oculta en escritorio, donde manda la barra lateral.
 */
export function BottomNav({ role }: { role: Rol }) {
  const pathname = usePathname();
  const items = navMovil(role);

  return (
    <nav
      aria-label="Navegación principal"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--borde)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex">
        {items.map((item) => {
          const activo =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={activo ? 'page' : undefined}
                className={`tap flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
                  activo ? 'text-marca-600' : 'text-[var(--texto-suave)]'
                }`}
              >
                <span aria-hidden className="text-xl leading-none">{item.icono}</span>
                {item.labelCorto}
                {/* El estado activo no se comunica solo por color (RNF-46) */}
                <span
                  aria-hidden
                  className={`block h-0.5 w-6 rounded-full ${activo ? 'bg-marca-600' : 'bg-transparent'}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
