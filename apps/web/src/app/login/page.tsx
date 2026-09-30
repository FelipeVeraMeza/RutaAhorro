'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { destinoSeguro } from '@rutaahorro/core';
import { supabase } from '@/lib/supabase/client';
import {
  DEMO_ACTIVO, DEMO_CLAVE, DEMO_COOKIE, DEMO_COOKIE_CUENTA, DEMO_CUENTAS, type DemoRole,
} from '@/lib/demo';
import { DEMO_USUARIOS } from '@/lib/demo/data';
import { cuentaDemoPorCorreo } from '@/lib/datos/usuarios';
import { inicioPara, type Rol } from '@/lib/navegacion';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * A dónde va después de entrar. Sin `next`, a "/", que manda a cada rol a su
   * primera pantalla (vendedor al POS, bodega a Inventario). Antes todos iban
   * al POS, bodega incluida.
   */
  function entrar(rol: Rol | null) {
    const next = params.get('next');
    router.push(next ? destinoSeguro(next) : rol ? inicioPara(rol) : '/');
    router.refresh();
  }

  async function entrarDemo(correo: string, clave: string) {
    const cuenta = await cuentaDemoPorCorreo(correo);
    if (!cuenta || cuenta.clave !== clave) {
      setError('Correo o contraseña incorrectos');
      return;
    }
    if (!cuenta.activo) {
      setError('Esa cuenta está desactivada. Pídele al administrador que la reactive.');
      return;
    }
    document.cookie = `${DEMO_COOKIE}=${cuenta.rol}; path=/; SameSite=Lax`;
    const detalle = encodeURIComponent(JSON.stringify({ id: cuenta.id, nombre: cuenta.nombre, correo: cuenta.correo }));
    document.cookie = `${DEMO_COOKIE_CUENTA}=${detalle}; path=/; SameSite=Lax`;
    entrar(cuenta.rol);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (DEMO_ACTIVO) {
      await entrarDemo(email.trim().toLowerCase(), password);
      setLoading(false);
      return;
    }

    let authError: unknown = null;
    let userId: string | null = null;
    try {
      let data: { user: { id: string } | null } | null = null;
      ({ data, error: authError } = await supabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      }));
      userId = data?.user?.id ?? null;
    } catch {
      // Sin red, signInWithPassword lanza: antes el botón quedaba en
      // "Ingresando…" para siempre.
      setError('No hay conexión con el servidor. Revisa internet y vuelve a intentar.');
      setLoading(false);
      return;
    }

    if (authError) {
      // Nunca revelar si el correo existe: eso permite enumerar usuarios.
      setError('Correo o contraseña incorrectos');
      setLoading(false);
      return;
    }

    // Directo a la pantalla de su rol, sin pasar por "/" y rebotar. Si el
    // perfil no se puede leer, "/" decide igual.
    // Por id: el administrador ve los perfiles de todo su local.
    const { data: perfil } = await supabase().from('profiles').select('role').eq('id', userId ?? '').maybeSingle()
      .then((r) => r, () => ({ data: null }));
    // `next` viene de la URL y lo escribe quien sea: `destinoSeguro` solo deja
    // pasar rutas internas. Vive en core, con pruebas (packages/core/test).
    entrar((perfil?.role as Rol | undefined) ?? null);
  }

  return (
    <main className="min-h-dvh flex flex-col justify-center px-5 py-10">
      <div className="w-full max-w-sm mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-marca-500 text-white text-2xl font-bold mb-4">
            RA
          </div>
          <h1 className="text-2xl font-bold">RutaAhorro</h1>
          <p className="text-sm text-[var(--texto-suave)] mt-1">
            Inventario, ventas y caja
          </p>
        </div>

        <form onSubmit={handleSubmit} className="tarjeta p-5 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1.5">
              Correo
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="tap w-full px-3 py-3 rounded-xl border border-[var(--borde)] bg-white focus:outline-none focus:ring-2 focus:ring-marca-500"
              placeholder="tu@correo.cl"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="tap w-full px-3 py-3 pr-20 rounded-xl border border-[var(--borde)] bg-white focus:outline-none focus:ring-2 focus:ring-marca-500"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                className="absolute right-2 top-1/2 -translate-y-1/2 tap px-2 text-sm text-marca-600 font-medium"
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-semibold text-base active:bg-marca-600 disabled:opacity-50"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        {DEMO_ACTIVO && <CuentasDemo onElegir={(correo) => { setEmail(correo); setPassword(DEMO_CLAVE); void entrarDemo(correo, DEMO_CLAVE); }} />}

        {!DEMO_ACTIVO && (
          <p className="text-center text-sm mt-6">
            <a href="/recuperar" className="tap inline-flex items-center text-marca-700 font-medium">¿Olvidaste tu contraseña?</a>
          </p>
        )}
        {!DEMO_ACTIVO && (
          <p className="text-center text-xs text-[var(--texto-suave)] mt-1">
            Si no te llega el correo, el administrador puede darte una contraseña temporal desde Usuarios.
          </p>
        )}
      </div>
    </main>
  );
}

/** Las cuentas de ejemplo del modo demo, una por rol: entrar con un toque. */
function CuentasDemo({ onElegir }: { onElegir: (correo: string) => void }) {
  const descripcion = (rol: DemoRole) => DEMO_USUARIOS.find((u) => u.rol === rol);
  return (
    <section className="mt-5 rounded-xl bg-amber-50 border border-amber-300 p-4">
      <h2 className="text-sm font-semibold text-amber-950">Modo demo · cuentas de ejemplo</h2>
      <p className="text-xs text-amber-900 mt-0.5 mb-3">
        Contraseña de todas: <code className="font-semibold">{DEMO_CLAVE}</code>. Las cuentas que crees en
        Usuarios también sirven para entrar.
      </p>
      <ul className="space-y-1.5">
        {DEMO_CUENTAS.map((c) => (
          <li key={c.rol}>
            <button
              type="button"
              onClick={() => onElegir(c.correo)}
              className="tap w-full text-left px-3 py-2 rounded-lg bg-white border border-amber-200 active:bg-amber-100"
            >
              <span className="block text-sm font-medium">{descripcion(c.rol)?.nombre} · {c.correo}</span>
              <span className="block text-xs text-[var(--texto-suave)]">{descripcion(c.rol)?.descripcion}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh grid place-items-center text-sm">Cargando…</main>}>
      <LoginForm />
    </Suspense>
  );
}
