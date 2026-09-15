'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Navegación inferior.
 *
 * Va abajo porque la app se opera con el pulgar, de pie, con una sola mano
 * (RNF-17). Una barra superior obligaría a estirar el dedo hasta el borde
 * más lejano de la pantalla en cada cambio de sección.
 */

type Role = 'admin' | 'supervisor' | 'vendedor' | 'bodega';

const ITEMS: Array<{ href: string; label: string; icon: string; roles: Role[] }> = [
  { href: '/pos',         label: 'Vender',    icon: '🛒', roles: ['admin', 'supervisor', 'vendedor'] },
  { href: '/caja',        label: 'Caja',      icon: '💵', roles: ['admin', 'supervisor', 'vendedor'] },
  { href: '/productos',   label: 'Productos', icon: '📦', roles: ['admin', 'supervisor', 'vendedor', 'bodega'] },
  { href: '/inventario',  label: 'Stock',     icon: '📋', roles: ['admin', 'supervisor', 'bodega'] },
  { href: '/',            label: 'Resumen',   icon: '📊', roles: ['admin', 'supervisor'] },
];

export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = ITEMS.filter((i) => i.roles.includes(role));

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--borde)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex">
        {visible.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`tap flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
                  active ? 'text-marca-600' : 'text-[var(--texto-suave)]'
                }`}
              >
                <span aria-hidden className="text-xl leading-none">{item.icon}</span>
                {item.label}
                {/* El estado activo no se comunica solo por color (RNF-46) */}
                <span
                  aria-hidden
                  className={`block h-0.5 w-6 rounded-full ${active ? 'bg-marca-600' : 'bg-transparent'}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
