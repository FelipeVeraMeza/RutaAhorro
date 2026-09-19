'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { navMovil, type ItemNav, type Rol } from '@/lib/navegacion';

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
              <Link
                href={item.href}
                aria-current={esActivo(item) ? 'page' : undefined}
                className={celda(esActivo(item))}
              >
                <span aria-hidden className="text-xl leading-none">{item.icono}</span>
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
                className={celda(enResto) + ' w-full'}
              >
                <span aria-hidden className="text-xl leading-none">☰</span>
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
                  onClick={() => setVerMas(false)}
                  aria-current={esActivo(item) ? 'page' : undefined}
                  className={`tap flex items-center gap-3 px-3 py-3.5 rounded-xl ${
                    esActivo(item) ? 'bg-marca-50 text-marca-900 font-semibold' : ''
                  }`}
                >
                  <span aria-hidden className="text-xl w-7 text-center">{item.icono}</span>
                  <span className="flex-1">{item.label}</span>
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
