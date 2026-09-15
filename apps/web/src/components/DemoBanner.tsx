'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEMO_COOKIE, type DemoRole } from '@/lib/demo';
import { DEMO_USUARIOS } from '@/lib/demo/data';

/**
 * Banner del modo demo, con cambio de rol.
 *
 * El cambio de rol es lo más útil de esta pantalla: permite ver en segundos
 * cómo cambia la aplicación según quién entra — qué pestañas aparecen, si se
 * ven los costos, qué botones existen. Es la matriz de permisos de
 * docs/02-stakeholders-roles.md hecha tangible.
 */
export function DemoBanner({ rolActual }: { rolActual: DemoRole }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  function cambiarRol(rol: DemoRole) {
    // Cookie de sesión: se borra al cerrar el navegador.
    document.cookie = `${DEMO_COOKIE}=${rol}; path=/; SameSite=Lax`;
    setAbierto(false);
    router.refresh();
  }

  const actual = DEMO_USUARIOS.find((u) => u.rol === rolActual);

  return (
    <div className="bg-amber-400 text-amber-950">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left"
        aria-expanded={abierto}
      >
        <span className="text-[11px] font-bold tracking-wide flex items-center gap-1.5 min-w-0">
          <span aria-hidden>⚠️</span>
          <span className="whitespace-nowrap">MODO DEMO</span>
          <span className="font-normal truncate opacity-80">
            · datos de ejemplo, sin sesión
          </span>
        </span>
        <span className="text-[11px] font-semibold whitespace-nowrap flex items-center gap-1">
          {actual?.nombre}
          <span aria-hidden>{abierto ? '▲' : '▼'}</span>
        </span>
      </button>

      {abierto && (
        <div className="px-3 pb-3">
          <p className="text-[11px] mb-2 opacity-90">
            Cambia de rol para ver cómo se comporta la app con cada persona del local:
          </p>
          <ul className="space-y-1">
            {DEMO_USUARIOS.map((u) => (
              <li key={u.rol}>
                <button
                  onClick={() => cambiarRol(u.rol)}
                  className={`tap w-full text-left px-3 py-2 rounded-lg text-xs ${
                    u.rol === rolActual
                      ? 'bg-amber-950 text-amber-50 font-semibold'
                      : 'bg-amber-300/70 active:bg-amber-300'
                  }`}
                >
                  <span className="block font-medium">
                    {u.nombre} · {u.rol}
                    {u.rol === rolActual && ' ✓'}
                  </span>
                  <span className="block opacity-80 mt-0.5">{u.descripcion}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] mt-2 opacity-75 leading-snug">
            Para apagar el modo demo: <code>NEXT_PUBLIC_DEMO=false</code> en{' '}
            <code>.env.local</code> y reiniciar el servidor.
          </p>
        </div>
      )}
    </div>
  );
}
