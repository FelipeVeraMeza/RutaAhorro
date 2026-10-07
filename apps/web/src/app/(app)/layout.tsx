import { redirect } from 'next/navigation';
import { getCurrentUser, haySesion } from '@/lib/supabase/server';
import { BottomNav } from '@/components/BottomNav';
import { Sidebar } from '@/components/Sidebar';
import { EstadoConexion } from '@/components/EstadoConexion';
import { SyncCatalogo } from '@/components/SyncCatalogo';
import { DemoBanner } from '@/components/DemoBanner';
import { DEMO_ACTIVO } from '@/lib/demo';
import { NOMBRE_ROL, LEMA_ROL } from '@/lib/navegacion';
import { Icono } from '@/components/Icono';
import { BotonSalir } from '@/components/BotonSalir';
import { versionCompleta } from '@/lib/novedades';
import { BloqueoInactividad } from '@/components/BloqueoInactividad';
import { LogoMarca } from '@/components/Logo';

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

  if (!user) {
    // Con sesión pero sin perfil (una cuenta creada a mano en el panel de
    // Supabase, sin local): antes era un bucle de redirecciones entre "/" y
    // /login, y el navegador terminaba en "demasiadas redirecciones".
    if (await haySesion()) {
      return (
        <main className="min-h-dvh grid place-items-center px-6 text-center">
          <div>
            <p className="text-4xl mb-3" aria-hidden>🔗</p>
            <h1 className="text-lg font-semibold mb-1">Tu cuenta no está vinculada a ningún local</h1>
            <p className="text-sm text-[var(--texto-suave)] mb-4">
              Pídele al administrador que te cree la cuenta desde Usuarios.
            </p>
            <form action="/api/logout" method="post">
              <button className="tap px-4 rounded-xl border border-[var(--borde)] text-sm">Salir</button>
            </form>
          </div>
        </main>
      );
    }
    redirect('/login');
  }

  // Entró con la contraseña temporal que le dio el administrador.
  if (user.debeCambiarClave) redirect('/clave');

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
        <Sidebar rol={user.role} nombre={user.fullName} version={versionCompleta()} />

        <div className="flex-1 flex flex-col min-w-0">
          <EstadoConexion />

          {/* Cabecera: solo en celular. En escritorio la identidad vive en la lateral. */}
          {/* 2026-10-07: en el marino del logo, con la "R" a la izquierda. */}
          <header className="lg:hidden sticky top-0 z-30 bg-marca-900 text-white px-4 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <LogoMarca tamano={32} className="shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{user.fullName || 'Sin nombre'}</p>
                <p className="text-[11px] text-[#b8c7d9] truncate">
                  {NOMBRE_ROL[user.role]} · {LEMA_ROL[user.role]}
                </p>
              </div>
            </div>
            <div className="flex items-center shrink-0">
              <a href="/cuenta" className="tap inline-grid place-items-center text-[#b8c7d9]"
                 title="Mi cuenta">
                <Icono nombre="cuenta" titulo="Mi cuenta" />
              </a>
              <BotonSalir className="tap inline-flex items-center gap-1.5 px-2 text-sm text-[#b8c7d9]">
                <Icono nombre="salir" tamano={18} /> Salir
              </BotonSalir>
            </div>
          </header>

          {/* pb-20 en celular deja espacio para la barra inferior */}
          <main className="flex-1 pb-20 lg:pb-0">
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>
        </div>
      </div>

      <BottomNav role={user.role} />
      <SyncCatalogo />
      <BloqueoInactividad correo={user.email} nombre={user.fullName} demo={DEMO_ACTIVO} />
    </div>
  );
}
