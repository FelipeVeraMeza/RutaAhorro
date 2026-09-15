'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navPara, LEMA_ROL, NOMBRE_ROL, type Rol } from '@/lib/navegacion';

/**
 * Barra lateral de escritorio.
 *
 * Oculta bajo 1024 px: en celular manda la navegación inferior, porque el
 * pulgar no llega al borde superior de la pantalla (RNF-17).
 */
export function Sidebar({
  rol, nombre, mostrarSalir,
}: {
  rol: Rol;
  nombre: string;
  mostrarSalir: boolean;
}) {
  const pathname = usePathname();
  const items = navPara(rol);

  return (
    <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 border-r border-[var(--borde)] bg-white h-dvh sticky top-0">
      <div className="px-4 py-4 border-b border-[var(--borde)]">
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-marca-500 text-white font-bold text-sm">
            RA
          </span>
          <span className="font-semibold">RutaAhorro</span>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 overflow-y-auto" aria-label="Navegación principal">
        <ul className="space-y-0.5">
          {items.map((item) => {
            const activo =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={activo ? 'page' : undefined}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    activo
                      ? 'bg-marca-50 text-marca-900 font-semibold'
                      : 'text-[var(--texto)] hover:bg-[var(--fondo)]'
                  }`}
                >
                  <span aria-hidden className="text-base w-5 text-center">{item.icono}</span>
                  <span className="flex-1">{item.label}</span>
                  {/* El estado activo no se comunica solo por color (RNF-46) */}
                  {activo && <span aria-hidden className="w-1 h-4 rounded-full bg-marca-500" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 py-3 border-t border-[var(--borde)]">
        <div className="px-1 mb-2">
          <p className="text-sm font-medium truncate">{nombre}</p>
          <p className="text-[11px] text-[var(--texto-suave)]">
            {NOMBRE_ROL[rol]} · {LEMA_ROL[rol]}
          </p>
        </div>
        {mostrarSalir && (
          <form action="/api/logout" method="post">
            <button className="tap w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--texto-suave)] hover:bg-[var(--fondo)]">
              Cerrar sesión
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
