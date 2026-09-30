'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { navMovil, type ItemNav, type Rol } from '@/lib/navegacion';
import { Icono } from './Icono';

/**
 * Navegación inferior del celular.
 *
 * Va abajo porque la app se opera con el pulgar, de pie y con una sola mano
 * (RNF-17). Se oculta en escritorio, donde manda la barra lateral.
 *
 * Lo que no cabe en la barra vive detrás de "Más". Sin eso, en el celular la
 * app terminaba en Inventario: Proveedores, Ventas, Reportes y Usuarios no
 * tenían ningún camino, porque la barra lateral que los lista está oculta bajo
 * 1024 px.
 */
export function BottomNav({ role }: { role: Rol }) {
  const pathname = usePathname();
  const { barra, resto } = navMovil(role);
  const [verMas, setVerMas] = useState(false);

  const esActivo = (item: ItemNav) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  // "Más" se marca activo cuando la pantalla abierta es una de las suyas: si no,
  // navegar desde el menú deja la barra sin ningún elemento señalado.
  const enResto = resto.some(esActivo);

  return (
    <>
      <nav
        aria-label="Navegación principal"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--borde)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="flex">
          {barra.map((item) => (
            <li key={item.href} className="flex-1">
              {/* Sin precarga, a propósito. Con ella, tocar "Caja" y enseguida
                  "Vender" en una conexión lenta dejaba la URL en /pos con la Caja
                  dibujada, y "Vender" ya no respondía (Next 15.5; lo encontró
                  flujo-completo.mjs contra Railway, 2026-09-29). Lo mismo en la
                  hoja "Más" y en la barra lateral. */}
              <Link
                href={item.href}
                prefetch={false}
                aria-current={esActivo(item) ? 'page' : undefined}
                className={celda(esActivo(item))}
              >
                <Icono nombre={item.icono} tamano={22} />
                {item.labelCorto}
                <Subrayado activo={esActivo(item)} />
              </Link>
            </li>
          ))}

          {resto.length > 0 && (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setVerMas(true)}
                aria-haspopup="dialog"
                aria-expanded={verMas}
                // `!`: globals.css pone todo <button> en 16 px (para que iOS no
                // haga zoom) y eso le ganaba a los 11 px de la celda. "Más" es
                // el único botón de la barra; los demás son enlaces.
                className={celda(enResto) + ' w-full !text-[11px]'}
              >
                <Icono nombre="mas" tamano={22} />
                Más
                <Subrayado activo={enResto} />
              </button>
            </li>
          )}
        </ul>
      </nav>

      {verMas && (
        <Modal titulo="Más secciones" encabezado="visible" onCerrar={() => setVerMas(false)}>
          <ul className="p-2">
            {resto.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  onClick={() => setVerMas(false)}
                  aria-current={esActivo(item) ? 'page' : undefined}
                  className={`tap flex items-center gap-3 px-3 py-3 rounded-xl ${
                    esActivo(item) ? 'bg-marca-50 text-marca-900' : ''
                  }`}
                >
                  <span className={`grid place-items-center w-10 h-10 rounded-xl ${esActivo(item) ? 'bg-white text-marca-700' : 'bg-[var(--fondo)] text-[var(--texto-suave)]'}`}>
                    <Icono nombre={item.icono} tamano={20} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block ${esActivo(item) ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
                    <span className="block text-xs text-[var(--texto-suave)] leading-snug">{item.ayuda}</span>
                  </span>
                  {/* El estado activo no se comunica solo por color (RNF-46) */}
                  {esActivo(item) && <span className="text-xs">Estás aquí</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

function celda(activo: boolean): string {
  return `tap flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
    activo ? 'text-marca-600' : 'text-[var(--texto-suave)]'
  }`;
}

/** El estado activo no se comunica solo por color (RNF-46). */
function Subrayado({ activo }: { activo: boolean }) {
  return (
    <span
      aria-hidden
      className={`block h-0.5 w-6 rounded-full ${activo ? 'bg-marca-600' : 'bg-transparent'}`}
    />
  );
}
