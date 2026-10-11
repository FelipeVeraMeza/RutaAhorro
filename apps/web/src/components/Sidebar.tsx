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
 *
 * 2026-10-11 (Felipe): fondo blanco con letras oscuras, "más corporativo". El
 * azul marino queda para el texto y el ítem activo; el naranjo, solo en el
 * logo. Y fija a todo el alto: con `sticky` se iba con la página al bajar y el
 * menú quedaba cortado y con su propia barra ("no debería bajar"). El
 * contenido le deja su ancho con lg:pl-60 (layout).
 */
export function Sidebar({ rol, nombre, version }: { rol: Rol; nombre: string; version: string }) {
  const pathname = usePathname();
  const items = navPara(rol);

  return (
    <aside className="hidden lg:flex lg:flex-col w-60 fixed inset-y-0 left-0 z-20
                      bg-[var(--superficie)] text-[var(--texto)] border-r border-[var(--borde)]">
      <div className="px-4 py-4 [@media(max-height:820px)]:py-2.5 border-b border-[var(--borde)]">
        <Logo sobre="claro" tamano={38} />
      </div>

      {/* En pantallas bajas (o con zoom) los ítems se aprietan para que entren todos sin barra. */}
      <nav className="flex-1 px-2 py-3 [@media(max-height:820px)]:py-1.5 overflow-y-auto" aria-label="Navegación principal">
        <ul className="space-y-0.5 [@media(max-height:820px)]:space-y-0">
          {items.map((item) => {
            const activo =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={activo ? 'page' : undefined}
                  className={`relative flex items-center gap-2.5 px-3 py-2 [@media(max-height:820px)]:py-1.5 [@media(max-height:700px)]:py-1
                    rounded-lg text-sm transition-colors ${
                    activo
                      ? 'bg-marca-50 text-marca-700 font-semibold'
                      : 'text-[var(--texto-suave)] hover:bg-[var(--fondo)] hover:text-[var(--texto)]'
                  }`}
                >
                  {/* El estado activo no se comunica solo por color (RNF-46): barra y negrita */}
                  {activo && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-marca-700" />}
                  <Icono nombre={item.icono} tamano={19} className={activo ? 'text-marca-700' : 'text-[var(--texto-suave)]'} />
                  <span className="flex-1">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 py-2.5 border-t border-[var(--borde)]">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 px-1">
            <p className="text-sm font-semibold truncate">{nombre}</p>
            <p className="text-[11px] text-[var(--texto-suave)] truncate">
              {NOMBRE_ROL[rol]} · {LEMA_ROL[rol]}
            </p>
          </div>
          <a href="/cuenta" title="Mi cuenta"
             className="tap grid place-items-center rounded-lg text-[var(--texto-suave)] hover:bg-[var(--fondo)] hover:text-[var(--texto)]">
            <Icono nombre="cuenta" tamano={18} titulo="Mi cuenta" />
          </a>
          <BotonSalir className="tap grid place-items-center rounded-lg text-[var(--texto-suave)] hover:bg-[var(--fondo)] hover:text-[var(--texto)]">
            <Icono nombre="salir" tamano={18} titulo="Cerrar sesión" />
          </BotonSalir>
        </div>
        <a href="/novedades" className="block px-1 pt-1 text-[11px] text-[var(--texto-suave)] hover:underline">Versión {version}</a>
      </div>
    </aside>
  );
}
