'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { leerPreferencias, EVENTO_PREFERENCIAS } from '@/lib/preferencias';
import { BotonSalir } from './BotonSalir';
import { Icono } from './Icono';

const BLOQUEADO = 'ra:bloqueado';
const HUELLA = 'ra:huella-clave';
const FALLOS = 'ra:fallos-bloqueo';
const EVENTOS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Huella de la contraseña para desbloquear SIN internet (PBKDF2, 100.000
 * vueltas, con el correo como sal). Se guarda solo después de un desbloqueo
 * verificado contra el servidor; la contraseña nunca queda guardada.
 */
async function huella(correo: string, clave: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`rutaahorro:${correo.toLowerCase()}`), iterations: 100_000 },
    base, 256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function verificar(correo: string, clave: string, demo: boolean): Promise<'ok' | 'mal' | 'sin-red'> {
  if (demo) {
    const { cuentaDemoPorCorreo } = await import('@/lib/datos/usuarios');
    const { DEMO_CLAVE } = await import('@/lib/demo');
    const c = await cuentaDemoPorCorreo(correo);
    return (c ? c.clave === clave : clave === DEMO_CLAVE) ? 'ok' : 'mal';
  }
  const guardada = (() => { try { return JSON.parse(localStorage.getItem(HUELLA) ?? '{}') as Record<string, string>; } catch { return {}; } })();
  if (!navigator.onLine) {
    const h = guardada[correo.toLowerCase()];
    if (!h) return 'sin-red';
    return (await huella(correo, clave)) === h ? 'ok' : 'mal';
  }
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { error } = await supabase().auth.signInWithPassword({ email: correo, password: clave });
    if (error) return 'mal';
  } catch {
    return 'sin-red';
  }
  try {
    guardada[correo.toLowerCase()] = await huella(correo, clave);
    localStorage.setItem(HUELLA, JSON.stringify(guardada));
  } catch { /* sin almacenamiento: sin red no se podrá desbloquear, nada más */ }
  return 'ok';
}

/**
 * Bloqueo por inactividad (RF-M1-19). Se activa en Mi cuenta, por celular.
 * Tapa la pantalla sin desmontarla: una venta a medio cobrar sigue ahí al
 * volver. Sobrevive a recargar la página (sessionStorage), así que recargar
 * no sirve para saltárselo.
 */
export function BloqueoInactividad({ correo, nombre, demo }: { correo: string | null; nombre: string; demo: boolean }) {
  const [minutos, setMinutos] = useState(0);
  const [bloqueado, setBloqueado] = useState(false);
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  // RF-M1-17 también acá: el ingreso pausa tras 5 fallos, el bloqueo dejaba
  // probar sin límite (y sin red, contra la huella guardada en el celular).
  // Los fallos viven en la pestaña: recargar la página reiniciaba la cuenta y
  // se podía probar contraseñas sin pausa.
  const [fallos, setFallos] = useState(() => {
    try { return Number(sessionStorage.getItem(FALLOS) ?? 0) || 0; } catch { return 0; }
  });
  const [esperaHasta, setEsperaHasta] = useState(0);
  const [, refrescar] = useState(0);
  const ultima = useRef(Date.now());

  useEffect(() => {
    const leer = () => setMinutos(leerPreferencias().bloqueoMin);
    leer();
    // Se guarda el correo de quien quedó bloqueado: si sale y entra otra
    // persona en la misma pestaña, a ella no se le bloquea.
    try { if (correo && sessionStorage.getItem(BLOQUEADO) === correo) setBloqueado(true); } catch { /* nada */ }
    window.addEventListener(EVENTO_PREFERENCIAS, leer);
    return () => window.removeEventListener(EVENTO_PREFERENCIAS, leer);
  }, [correo]);

  const bloquear = useCallback(() => {
    try { if (correo) sessionStorage.setItem(BLOQUEADO, correo); } catch { /* nada */ }
    setBloqueado(true);
  }, [correo]);

  useEffect(() => {
    if (!minutos || !correo) return;
    ultima.current = Date.now();
    const marcar = () => { ultima.current = Date.now(); };
    for (const e of EVENTOS) window.addEventListener(e, marcar, { passive: true });
    const revisar = () => { if (Date.now() - ultima.current >= minutos * 60_000) bloquear(); };
    const t = window.setInterval(revisar, 10_000);
    // Al volver de otra aplicación el intervalo pudo estar dormido: se revisa altiro.
    document.addEventListener('visibilitychange', revisar);
    return () => {
      for (const e of EVENTOS) window.removeEventListener(e, marcar);
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', revisar);
    };
  }, [minutos, correo, bloquear]);

  async function desbloquear(e: React.FormEvent) {
    e.preventDefault();
    if (!correo || !clave) return;
    if (Date.now() < esperaHasta) return;
    setVerificando(true);
    setError(null);
    const r = await verificar(correo, clave, demo);
    setVerificando(false);
    if (r === 'ok') {
      try { sessionStorage.removeItem(BLOQUEADO); sessionStorage.removeItem(FALLOS); } catch { /* nada */ }
      setFallos(0);
      ultima.current = Date.now();
      setClave('');
      setBloqueado(false);
    } else {
      if (r === 'mal') {
        const n = fallos + 1;
        setFallos(n);
        try { sessionStorage.setItem(FALLOS, String(n)); } catch { /* nada */ }
        if (n % 5 === 0) {
          const hasta = Date.now() + 30_000 * (n / 5);
          setEsperaHasta(hasta);
          const t = window.setInterval(() => { refrescar((x) => x + 1); if (Date.now() >= hasta) window.clearInterval(t); }, 1000);
        }
      }
      setError(r === 'mal'
        ? 'Contraseña incorrecta.'
        : 'Sin internet no se puede revisar la contraseña (este celular aún no la conoce). Conéctate o sal y entra de nuevo.');
    }
  }

  if (!bloqueado || !correo) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="t-bloqueo"
      className="fixed inset-0 z-[100] bg-[var(--fondo)] grid place-items-center px-6">
      <form onSubmit={desbloquear} className="tarjeta p-6 w-full max-w-sm text-center">
        <span className="inline-grid place-items-center text-[var(--color-marca-600)] mb-2"><Icono nombre="candado" tamano={32} /></span>
        <h1 id="t-bloqueo" className="text-lg font-semibold">Pantalla bloqueada</h1>
        <p className="text-sm text-[var(--texto-suave)] mb-4">
          Estaba usándola <strong>{nombre || correo}</strong>. Escribe tu contraseña para seguir.
        </p>
        <label htmlFor="clave-bloqueo" className="sr-only">Contraseña</label>
        <input id="clave-bloqueo" type="password" autoComplete="current-password" autoFocus
          className="w-full rounded-xl border border-[var(--borde)] px-3 py-2.5 mb-2"
          value={clave} onChange={(e) => setClave(e.target.value)} placeholder="Contraseña" />
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)] mb-2">{error}</p>}
        <button type="submit" className="btn btn-primario w-full" disabled={verificando || !clave || Date.now() < esperaHasta}>
          {verificando ? 'Revisando…' : Date.now() < esperaHasta
            ? `Espera ${Math.ceil((esperaHasta - Date.now()) / 1000)} s` : 'Desbloquear'}
        </button>
        <BotonSalir sinPreguntar className="btn btn-secundario w-full mt-2">Es otra persona: salir</BotonSalir>
      </form>
    </div>
  );
}
