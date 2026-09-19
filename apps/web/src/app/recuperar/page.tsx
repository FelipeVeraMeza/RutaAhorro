'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

/**
 * Crear o cambiar la contraseña (RF-M1-05, RF-M1-08, RF-M1-12).
 *
 * Hasta el 2026-09-19 no existía: la invitación de un empleado lo mandaba a
 * /login, sin ninguna pantalla donde crear su contraseña. El correo llegaba,
 * el empleado hacía clic y quedaba frente a un ingreso sin clave con que
 * entrar. RF-M1-03 y RF-M1-12 figuraban cumplidos.
 *
 * Tres formas de llegar:
 *  - Desde la invitación o el correo de recuperación, con la sesión en el
 *    fragmento de la URL (#access_token=…): se crea la contraseña.
 *  - Con ?code=… (recuperación iniciada desde este navegador): igual.
 *  - Sin nada: se pide el correo y se manda el enlace.
 */
const MINIMO = 8;

type Modo = 'cargando' | 'pedir' | 'enviado' | 'crear' | 'invalido';

function Recuperar() {
  const router = useRouter();
  // El enlace se revisa UNA vez. Antes el efecto corría de nuevo cuando la
  // página terminaba de cargar: para entonces la sesión ya se había consumido
  // y borrado de la URL, y la segunda pasada mostraba "Recuperar contraseña"
  // encima de "Crea tu contraseña". Encontrado con tools/ui/m1-usuarios.mjs.
  const revisado = useRef(false);
  const [modo, setModo] = useState<Modo>('cargando');
  const [esInvitacion, setEsInvitacion] = useState(false);
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    if (revisado.current) return;
    revisado.current = true;
    void (async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const code = new URLSearchParams(window.location.search).get('code');
      if (hash.get('error_description')) {
        setError('El enlace venció o ya se usó. Pide uno nuevo.');
        setModo('invalido');
        return;
      }
      const access = hash.get('access_token');
      const refresh = hash.get('refresh_token');
      if (access && refresh) {
        const { error: e } = await supabase().auth.setSession({ access_token: access, refresh_token: refresh });
        // El token no debe quedar en la barra de direcciones ni en el historial.
        window.history.replaceState(null, '', window.location.pathname);
        if (e) { setError('El enlace venció o ya se usó. Pide uno nuevo.'); setModo('invalido'); return; }
        setEsInvitacion(hash.get('type') === 'invite');
        setModo('crear');
        return;
      }
      if (code) {
        const { error: e } = await supabase().auth.exchangeCodeForSession(code);
        window.history.replaceState(null, '', window.location.pathname);
        if (e) { setError('El enlace venció o ya se usó. Pide uno nuevo.'); setModo('invalido'); return; }
        setModo('crear');
        return;
      }
      setModo('pedir');
    })();
  }, []);

  async function pedirEnlace(e: React.FormEvent) {
    e.preventDefault();
    setTrabajando(true);
    setError(null);
    await supabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/recuperar`,
    });
    // La respuesta es la misma exista o no el correo: decir "no existe"
    // permite averiguar quién trabaja en el local.
    setTrabajando(false);
    setModo('enviado');
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave.length < MINIMO) { setError(`La contraseña debe tener al menos ${MINIMO} caracteres`); return; }
    if (clave !== repetida) { setError('Las dos contraseñas no son iguales'); return; }
    setTrabajando(true);
    const { error: e2 } = await supabase().auth.updateUser({ password: clave });
    setTrabajando(false);
    if (e2) {
      setError(/should be different/i.test(e2.message)
        ? 'La contraseña nueva tiene que ser distinta de la anterior'
        : /weak|at least/i.test(e2.message)
          ? 'Esa contraseña es muy fácil de adivinar. Usa una más larga o con números.'
          : 'No se pudo guardar la contraseña. Pide un enlace nuevo.');
      return;
    }
    router.push('/pos');
    router.refresh();
  }

  const campo = 'tap w-full px-3 py-3 rounded-xl border border-[var(--borde)] bg-white focus:outline-none focus:ring-2 focus:ring-marca-500';

  return (
    <main className="min-h-dvh flex flex-col justify-center px-5 py-10">
      <div className="w-full max-w-sm mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-marca-500 text-white text-2xl font-bold mb-4">RA</div>
          <h1 className="text-2xl font-bold">
            {modo === 'crear' ? (esInvitacion ? 'Crea tu contraseña' : 'Nueva contraseña') : 'Recuperar contraseña'}
          </h1>
        </div>

        {modo === 'cargando' && <p className="text-center text-sm text-[var(--texto-suave)]">Revisando el enlace…</p>}

        {modo === 'pedir' && (
          <form onSubmit={pedirEnlace} className="tarjeta p-5 space-y-4">
            <p className="text-sm text-[var(--texto-suave)]">
              Escribe el correo con que entras. Te llegará un enlace para crear una contraseña nueva.
            </p>
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1.5">Correo</label>
              <input id="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none"
                required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                className={campo} placeholder="tu@correo.cl" />
            </div>
            <button type="submit" disabled={trabajando}
              className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-semibold disabled:opacity-50">
              {trabajando ? 'Enviando…' : 'Enviar enlace'}
            </button>
          </form>
        )}

        {modo === 'enviado' && (
          <div className="tarjeta p-5 space-y-2" role="status">
            <p className="font-medium">Revisa tu correo</p>
            <p className="text-sm text-[var(--texto-suave)]">
              Si {email.trim() || 'ese correo'} está registrado, te llegó un enlace. Puede demorar unos minutos
              y a veces cae en correo no deseado.
            </p>
          </div>
        )}

        {modo === 'crear' && (
          <form onSubmit={guardar} className="tarjeta p-5 space-y-4">
            <div>
              <label htmlFor="clave" className="block text-sm font-medium mb-1.5">Contraseña</label>
              <input id="clave" type={ver ? 'text' : 'password'} autoComplete="new-password" required autoFocus
                value={clave} onChange={(e) => setClave(e.target.value)} className={campo} />
              <p className="text-xs text-[var(--texto-suave)] mt-1.5">Al menos {MINIMO} caracteres.</p>
            </div>
            <div>
              <label htmlFor="repetida" className="block text-sm font-medium mb-1.5">Repítela</label>
              <input id="repetida" type={ver ? 'text' : 'password'} autoComplete="new-password" required
                value={repetida} onChange={(e) => setRepetida(e.target.value)} className={campo} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} className="w-5 h-5" />
              Mostrar contraseña
            </label>
            {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <button type="submit" disabled={trabajando}
              className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-semibold disabled:opacity-50">
              {trabajando ? 'Guardando…' : 'Guardar y entrar'}
            </button>
          </form>
        )}

        {modo === 'invalido' && (
          <div className="tarjeta p-5 space-y-3">
            <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>
            <button onClick={() => { setError(null); setModo('pedir'); }}
              className="tap w-full py-3 rounded-xl border border-[var(--borde)] font-medium">
              Pedir un enlace nuevo
            </button>
          </div>
        )}

        <p className="text-center text-sm mt-6">
          <a href="/login" className="text-marca-700 font-medium">Volver al ingreso</a>
        </p>
      </div>
    </main>
  );
}

export default function RecuperarPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh grid place-items-center text-sm">Cargando…</main>}>
      <Recuperar />
    </Suspense>
  );
}
