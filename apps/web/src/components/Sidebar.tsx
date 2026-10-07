'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navPara, LEMA_ROL, NOMBRE_ROL, type Rol } from '@/lib/navegacion';
import { Icono } from './Icono';
import { BotonSalir } from './BotonSalir';
import { Logo } from './Logo';

/**
 * Barra lateral de escritorio.
 *
 * Oculta bajo 1024 px: en celular manda la navegación inferior, porque el
 * pulgar no llega al borde superior de la pantalla (RNF-17).
 */
export function Sidebar({ rol, nombre, version }: { rol: Rol; nombre: string; version: string }) {
  const pathname = usePathname();
  const items = navPara(rol);

  return (
    // 2026-10-07: en el marino del logo, que es donde el naranjo luce.
    <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-marca-900 text-white h-dvh sticky top-0">
      <div className="px-4 py-4 border-b border-white/10">
        <Logo tamano={38} />
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
                  prefetch={false}
                  aria-current={activo ? 'page' : undefined}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    activo
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-[#c9d6e3] hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icono nombre={item.icono} tamano={19} className={activo ? 'text-acento-500' : 'text-[#93aecb]'} />
                  <span className="flex-1">{item.label}</span>
                  {/* El estado activo no se comunica solo por color (RNF-46) */}
                  {activo && <span aria-hidden className="w-1 h-4 rounded-full bg-acento-500" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 py-2.5 border-t border-white/10">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 px-1">
            <p className="text-sm font-medium truncate">{nombre}</p>
            <p className="text-[11px] text-[#b8c7d9] truncate">
              {NOMBRE_ROL[rol]} · {LEMA_ROL[rol]}
            </p>
          </div>
          <a href="/cuenta" title="Mi cuenta"
             className="tap grid place-items-center rounded-lg text-[#b8c7d9] hover:bg-white/10 hover:text-white">
            <Icono nombre="cuenta" tamano={18} titulo="Mi cuenta" />
          </a>
          <BotonSalir className="tap grid place-items-center rounded-lg text-[#b8c7d9] hover:bg-white/10 hover:text-white">
            <Icono nombre="salir" tamano={18} titulo="Cerrar sesión" />
          </BotonSalir>
        </div>
        <a href="/novedades" className="block px-1 pt-1 text-[11px] text-[#b8c7d9] hover:underline">Versión {version}</a>
      </div>
    </aside>
  );
}
