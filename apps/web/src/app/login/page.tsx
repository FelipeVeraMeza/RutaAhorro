'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

/**
 * A dónde mandar al usuario después de entrar.
 *
 * El parámetro `next` viene de la URL y lo escribe quien sea. Sin este filtro,
 * un enlace con `?next=https://sitio-falso.cl` llevaría a la víctima a una
 * copia del login justo después de autenticarse de verdad: el momento en que
 * menos sospecha. Solo se aceptan rutas internas; `//` se descarta porque el
 * navegador la interpreta como otro dominio.
 */
function destinoSeguro(next: string | null): string {
  if (!next) return '/pos';
  if (!next.startsWith('/') || next.startsWith('//')) return '/pos';
  return next;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: authError } = await supabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      // Nunca revelar si el correo existe: eso permite enumerar usuarios.
      setError('Correo o contraseña incorrectos');
      setLoading(false);
      return;
    }

    router.push(destinoSeguro(params.get('next')));
    router.refresh();
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

        {/*
          Mientras RF-M1-05 no exista, este texto dice la verdad y nada más.
          Antes prometía que el administrador podía restablecer la contraseña,
          y no puede: no hay pantalla para eso, y reinvitar a alguien que ya
          tiene cuenta falla en Supabase Auth. Una promesa que el sistema no
          cumple deja al usuario esperando un correo que nunca llega.
        */}
        <p className="text-center text-xs text-[var(--texto-suave)] mt-6">
          ¿Olvidaste tu contraseña? Todavía no se puede recuperar desde aquí.
          Avísale a quien administra el sistema.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh grid place-items-center text-sm">Cargando…</main>}>
      <LoginForm />
    </Suspense>
  );
}
