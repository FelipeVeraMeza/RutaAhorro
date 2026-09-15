import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { BottomNav } from '@/components/BottomNav';
import { Sidebar } from '@/components/Sidebar';
import { EstadoConexion } from '@/components/EstadoConexion';
import { SyncCatalogo } from '@/components/SyncCatalogo';
import { DemoBanner } from '@/components/DemoBanner';
import { DEMO_ACTIVO } from '@/lib/demo';
import { NOMBRE_ROL, LEMA_ROL } from '@/lib/navegacion';

/**
 * Estructura de la aplicación.
 *
 *   Escritorio (≥1024px): barra lateral + contenido con ancho máximo
 *   Celular:              cabecera compacta + navegación inferior
 *
 * No es "el escritorio encogido": son dos disposiciones distintas para dos
 * contextos de uso distintos. En el local se usa el celular de pie y con una
 * mano; el dueño revisa desde el computador sentado.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) redirect('/login');

  // Un usuario desactivado conserva su sesión hasta que expira: hay que
  // bloquearlo aquí y no solo al iniciar sesión (US-01).
  if (!user.isActive) {
    return (
      <main className="min-h-dvh grid place-items-center px-6 text-center">
        <div>
          <p className="text-4xl mb-3" aria-hidden>🔒</p>
          <h1 className="text-lg font-semibold mb-1">Tu cuenta está desactivada</h1>
          <p className="text-sm text-[var(--texto-suave)]">
            Contacta al administrador del local.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {DEMO_ACTIVO && <DemoBanner rolActual={user.role} />}

      <div className="flex flex-1 min-h-0">
        <Sidebar rol={user.role} nombre={user.fullName} mostrarSalir={!DEMO_ACTIVO} />

        <div className="flex-1 flex flex-col min-w-0">
          <EstadoConexion />

          {/* Cabecera: solo en celular. En escritorio la identidad vive en la lateral. */}
          <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-[var(--borde)] px-4 py-2.5 flex items-center justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{user.fullName || 'Sin nombre'}</p>
              <p className="text-[11px] text-[var(--texto-suave)]">
                {NOMBRE_ROL[user.role]} · {LEMA_ROL[user.role]}
              </p>
            </div>
            {!DEMO_ACTIVO && (
              <form action="/api/logout" method="post">
                <button className="tap px-3 text-sm text-[var(--texto-suave)]">Salir</button>
              </form>
            )}
          </header>

          {/* pb-20 en celular deja espacio para la barra inferior */}
          <main className="flex-1 pb-20 lg:pb-0">
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>
        </div>
      </div>

      <BottomNav role={user.role} />
      <SyncCatalogo />
    </div>
  );
}
