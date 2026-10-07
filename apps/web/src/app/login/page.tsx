'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { destinoSeguro, rutParaEntrar, correoDeRut } from '@rutaahorro/core';
import { Logo } from '@/components/Logo';
import { supabase } from '@/lib/supabase/client';
import {
  DEMO_ACTIVO, DEMO_CLAVE, DEMO_COOKIE, DEMO_COOKIE_CUENTA, DEMO_CUENTAS, type DemoRole,
} from '@/lib/demo';
import { DEMO_USUARIOS } from '@/lib/demo/data';
import { cuentaDemoPorCorreo } from '@/lib/datos/usuarios';
import { inicioPara, type Rol } from '@/lib/navegacion';

const CORREO_RECORDADO = 'ra:correo';
const RUT_RECORDADO = 'ra:rut';
const INTENTOS_ANTES_DE_ESPERAR = 5;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  /**
   * 2026-10-07 · El personal entra con RUT y clave; con correo, solo el
   * administrador principal y solo desde el computador (Felipe: "la página no
   * debe dejar colocar letras desde el celular"). En el celular el campo es
   * numérico y no acepta letras; "Entrar con correo" aparece en pantallas
   * anchas. La maqueta sigue con correo: sus cuentas de ejemplo son correos.
   */
  const [modo, setModo] = useState<'rut' | 'correo'>(DEMO_ACTIVO ? 'correo' : 'rut');
  const [rut, setRut] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // RF-M1-16 · la causa más común de "contraseña incorrecta" en el mostrador.
  const [mayusculas, setMayusculas] = useState(false);
  // RF-M1-17 · tras varios intentos fallidos seguidos, una pausa creciente.
  const [fallos, setFallos] = useState(0);
  const [esperarHasta, setEsperarHasta] = useState(0);
  const [ahora, setAhora] = useState(() => Date.now());
  // RF-M1-18 · el correo de quien usa este celular, para no escribirlo cada turno.
  const [recordar, setRecordar] = useState(true);

  useEffect(() => {
    try {
      const rutGuardado = localStorage.getItem(RUT_RECORDADO);
      if (rutGuardado) setRut(rutGuardado);
      const guardado = localStorage.getItem(CORREO_RECORDADO);
      if (guardado) setEmail(guardado);
      else if (localStorage.getItem(CORREO_RECORDADO + ':no')) setRecordar(false);
    } catch { /* sin almacenamiento */ }
  }, []);

  useEffect(() => {
    if (esperarHasta <= Date.now()) return;
    const t = setInterval(() => setAhora(Date.now()), 500);
    return () => clearInterval(t);
  }, [esperarHasta]);
  const segundosEspera = Math.max(0, Math.ceil((esperarHasta - ahora) / 1000));

  function recordarCorreo(correo: string) {
    const clave = modo === 'rut' ? RUT_RECORDADO : CORREO_RECORDADO;
    try {
      if (recordar) { localStorage.setItem(clave, correo); localStorage.removeItem(CORREO_RECORDADO + ':no'); }
      else { localStorage.removeItem(clave); localStorage.setItem(CORREO_RECORDADO + ':no', '1'); }
    } catch { /* sin almacenamiento */ }
  }

  function fallo(mensaje: string) {
    const n = fallos + 1;
    setFallos(n);
    if (n >= INTENTOS_ANTES_DE_ESPERAR) {
      const seg = 30 * 2 ** (n - INTENTOS_ANTES_DE_ESPERAR);
      setEsperarHasta(Date.now() + Math.min(seg, 300) * 1000);
      setAhora(Date.now());
      setError(`${mensaje}. Demasiados intentos: espera un momento antes de probar de nuevo.`);
    } else {
      setError(mensaje);
    }
  }

  function revisarMayusculas(e: React.KeyboardEvent<HTMLInputElement>) {
    setMayusculas(e.getModifierState?.('CapsLock') ?? false);
  }

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
      fallo('Correo o contraseña incorrectos');
      return;
    }
    recordarCorreo(cuenta.correo);
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
    if (segundosEspera > 0) return;
    setLoading(true);
    setError(null);

    if (DEMO_ACTIVO) {
      await entrarDemo(email.trim().toLowerCase(), password);
      setLoading(false);
      return;
    }

    const cuerpoRut = modo === 'rut' ? rutParaEntrar(rut) : null;
    if (modo === 'rut' && !cuerpoRut) {
      setError('Escribe tu RUT sin el dígito verificador: los 7 u 8 números antes del guion.');
      setLoading(false);
      return;
    }
    const usuario = cuerpoRut ? correoDeRut(cuerpoRut) : email.trim();

    let authError: unknown = null;
    let userId: string | null = null;
    try {
      let data: { user: { id: string } | null } | null = null;
      ({ data, error: authError } = await supabase().auth.signInWithPassword({
        email: usuario,
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
      // Nunca revelar si el RUT o el correo existe: eso permite enumerar usuarios.
      fallo(modo === 'rut' ? 'RUT o contraseña incorrectos' : 'Correo o contraseña incorrectos');
      setLoading(false);
      return;
    }
    recordarCorreo(cuerpoRut ?? email.trim());

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
          <h1 className="inline-flex rounded-2xl bg-marca-900 px-6 py-4 mb-3">
            <Logo tamano={60} />
          </h1>
          <p className="text-sm text-[var(--texto-suave)] mt-1">
            Inventario, ventas y caja
          </p>
        </div>

        <form onSubmit={handleSubmit} className="tarjeta p-5 space-y-4">
          {modo === 'rut' ? (
            <div>
              <label htmlFor="rut" className="block text-sm font-medium mb-1.5">
                RUT
              </label>
              <input
                id="rut"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="username"
                maxLength={8}
                required
                autoFocus
                value={rut}
                // Solo números: lo de después del guion (el dígito) se descarta,
                // y una letra no llega a escribirse.
                onChange={(e) => setRut(e.target.value.split('-')[0].replace(/\D/g, '').slice(0, 8))}
                aria-describedby="ayuda-rut"
                className="tap w-full px-3 py-3 rounded-xl border border-[var(--borde)] bg-white num tracking-wide focus:outline-none focus:ring-2 focus:ring-marca-500"
                placeholder="12345678"
              />
              <p id="ayuda-rut" className="text-xs text-[var(--texto-suave)] mt-1">
                Sin puntos ni dígito verificador: los números antes del guion.
              </p>
            </div>
          ) : (
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
          )}

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
                onKeyUp={revisarMayusculas}
                onKeyDown={revisarMayusculas}
                aria-describedby={mayusculas ? 'aviso-mayus' : undefined}
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
            {mayusculas && (
              <p id="aviso-mayus" className="text-xs text-[var(--color-aviso)] font-medium mt-1.5">
                Las mayúsculas están activadas (Bloq Mayús).
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-5 h-5" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
            {modo === 'rut' ? 'Recordar mi RUT en este celular' : 'Recordar mi correo en este equipo'}
          </label>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || segundosEspera > 0}
            className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-semibold text-base active:bg-marca-600 disabled:opacity-50"
          >
            {loading ? 'Ingresando…' : segundosEspera > 0 ? `Espera ${segundosEspera} s` : 'Ingresar'}
          </button>
        </form>

        {/* El correo es solo para el administrador principal, y desde el
            computador: en el celular este enlace no aparece. */}
        {!DEMO_ACTIVO && (
          <p className="hidden lg:block text-center text-sm mt-4">
            <button type="button" onClick={() => { setError(null); setModo(modo === 'rut' ? 'correo' : 'rut'); }}
                    className="tap text-marca-700 font-medium underline">
              {modo === 'rut' ? 'Entrar con correo (administrador)' : 'Entrar con RUT'}
            </button>
          </p>
        )}

        {DEMO_ACTIVO && <CuentasDemo onElegir={(correo) => { setEmail(correo); setPassword(DEMO_CLAVE); void entrarDemo(correo, DEMO_CLAVE); }} />}

        {/* Con RUT no hay correo al que mandar un enlace: la clave la
            restablece el administrador en Usuarios. */}
        {!DEMO_ACTIVO && modo === 'rut' && (
          <p className="text-center text-sm text-[var(--texto-suave)] mt-6">
            ¿Olvidaste tu contraseña? Pídele al administrador una temporal: la cambia en Usuarios.
          </p>
        )}
        {!DEMO_ACTIVO && modo === 'correo' && (
          <p className="text-center text-sm mt-6">
            <a href="/recuperar" className="tap inline-flex items-center text-marca-700 font-medium">¿Olvidaste tu contraseña?</a>
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
