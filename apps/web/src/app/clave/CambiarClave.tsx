'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Logo } from '@/components/Logo';
import { MINIMO_CLAVE, formatRut, isValidRut } from '@rutaahorro/core';

const MINIMO = MINIMO_CLAVE;

export function CambiarClave({ nombre, obligatorio, completarDatos = false, demo, volverA }: {
  nombre: string;
  /** Entró con la clave temporal del administrador: no puede saltarse esto. */
  obligatorio: boolean;
  /** Cuenta con nombre y RUT provisorios: también los tiene que poner (2026-10-07). */
  completarDatos?: boolean;
  demo: boolean;
  volverA: string;
}) {
  const router = useRouter();
  const [clave, setClave] = useState('');
  const [nombreReal, setNombreReal] = useState('');
  const [rut, setRut] = useState('');
  const [rol, setRol] = useState<'vendedor' | 'bodega' | ''>('');
  const [repetida, setRepetida] = useState('');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (completarDatos && nombreReal.trim().length < 2) { setError('Escribe tu nombre'); return; }
    if (completarDatos && !rol) { setError('Elige qué haces en el local: vender o bodega'); return; }
    if (completarDatos && !isValidRut(rut)) { setError('El RUT no es válido: revisa el dígito verificador'); return; }
    if (clave.length < MINIMO) { setError(`La contraseña debe tener al menos ${MINIMO} caracteres`); return; }
    if (clave !== repetida) { setError('Las dos contraseñas no son iguales'); return; }
    if (demo) { setError('En el modo demo las contraseñas son de ejemplo y no se cambian.'); return; }
    setTrabajando(true);
    try {
      // Primero el nombre y el RUT: la clave no se acepta mientras el RUT siga
      // siendo el provisorio (el servidor lo revisa).
      if (completarDatos) {
        const r = await fetch('/api/usuarios/datos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: nombreReal.trim(), rut: formatRut(rut), rol }),
        });
        const c = await r.json().catch(() => ({}));
        if (!r.ok) { setError(c?.error?.message ?? 'No se pudieron guardar tus datos'); return; }
      }
      const res = await fetch('/api/cuenta/clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) { setError(cuerpo?.error?.message ?? 'No se pudo cambiar la contraseña'); return; }
      // El aviso de "clave temporal" viaja en el token: se pide uno nuevo para
      // que la app deje de mandar acá.
      await supabase().auth.refreshSession().catch(() => {});
      setListo(true);
      setClave(''); setRepetida('');
      setTimeout(() => { router.push(volverA); router.refresh(); }, 1200);
    } catch {
      setError('No hay conexión con el servidor. Revisa internet y vuelve a intentar.');
    } finally {
      setTrabajando(false);
    }
  }

  const campo = 'tap w-full px-3 py-3 rounded-xl border border-[var(--borde)] bg-white focus:outline-none focus:ring-2 focus:ring-marca-500';

  return (
    <main className="min-h-dvh flex flex-col justify-center px-5 py-10">
      <div className="w-full max-w-sm mx-auto">
        <div className="text-center mb-6">
          <div className="inline-flex rounded-2xl bg-marca-900 px-5 py-3 mb-4"><Logo tamano={48} /></div>
          <h1 className="text-2xl font-bold">{completarDatos ? 'Completa tu cuenta' : obligatorio ? 'Crea tu contraseña' : 'Cambiar mi contraseña'}</h1>
          <p className="text-sm text-[var(--texto-suave)] mt-1">{nombre}</p>
        </div>

        {completarDatos ? (
          <p className="text-sm bg-amber-50 text-[var(--color-aviso)] px-3 py-2 rounded-lg mb-4">
            Esta cuenta tiene un nombre y un RUT de prueba. Pon los tuyos y elige tu contraseña:
            desde ahora entras con tu RUT y todo lo que hagas queda a tu nombre.
          </p>
        ) : obligatorio && (
          <p className="text-sm bg-amber-50 text-[var(--color-aviso)] px-3 py-2 rounded-lg mb-4">
            Entraste con una contraseña temporal que te dio el administrador.
            Elige una tuya: desde ahora, lo que hagas en el sistema queda a tu nombre.
          </p>
        )}

        {listo ? (
          <p role="status" className="tarjeta p-5 text-center font-medium">✓ Contraseña guardada. Entrando…</p>
        ) : (
          <form onSubmit={guardar} className="tarjeta p-5 space-y-4">
            {completarDatos && (<>
              <div>
                <label htmlFor="nombre-real" className="block text-sm font-medium mb-1.5">Tu nombre</label>
                <input id="nombre-real" required autoFocus autoComplete="name" value={nombreReal}
                  onChange={(e) => setNombreReal(e.target.value)} placeholder="Nombre y apellido" className={campo} />
              </div>
              <div>
                <label htmlFor="rut-real" className="block text-sm font-medium mb-1.5">Tu RUT</label>
                <input id="rut-real" required autoComplete="off" value={rut}
                  onChange={(e) => setRut(e.target.value)} onBlur={() => { if (isValidRut(rut)) setRut(formatRut(rut)); }}
                  placeholder="12.345.678-5" className={campo + ' num'} />
                <p className="text-xs text-[var(--texto-suave)] mt-1.5">Con dígito verificador. Para entrar escribirás los números antes del guion.</p>
              </div>
              <fieldset>
                <legend className="block text-sm font-medium mb-1.5">¿Qué haces en el local?</legend>
                <div className="space-y-2">
                  {([['vendedor', 'Vendo y cobro', 'Vendedor/a o cajero/a: vende, abre y cierra su caja.'],
                     ['bodega', 'Bodega', 'Recibe mercadería, cuenta y ajusta el inventario. No vende.']] as const).map(([v, t, d]) => (
                    <label key={v} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer ${rol === v ? 'border-marca-500 bg-marca-50' : 'border-[var(--borde)]'}`}>
                      <input type="radio" name="rol" value={v} checked={rol === v} onChange={() => setRol(v)} className="mt-0.5 w-5 h-5" />
                      <span className="text-sm"><strong className="block">{t}</strong><span className="text-[var(--texto-suave)]">{d}</span></span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[var(--texto-suave)] mt-1.5">Supervisor o administrador lo da el administrador.</p>
              </fieldset>
            </>)}
            <div>
              <label htmlFor="clave" className="block text-sm font-medium mb-1.5">Contraseña nueva</label>
              <input id="clave" type={ver ? 'text' : 'password'} autoComplete="new-password" required autoFocus={!completarDatos}
                value={clave} onChange={(e) => setClave(e.target.value)} className={campo} />
              <p className="text-xs text-[var(--texto-suave)] mt-1.5">Al menos {MINIMO} caracteres.</p>
            </div>
            <div>
              <label htmlFor="repetida" className="block text-sm font-medium mb-1.5">Repítela</label>
              <input id="repetida" type={ver ? 'text' : 'password'} autoComplete="new-password" required
                value={repetida} onChange={(e) => setRepetida(e.target.value)} className={campo} />
            </div>
            <label className="flex items-center gap-2 text-sm min-h-[44px]">
              <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} className="w-5 h-5" />
              Mostrar contraseña
            </label>
            {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <button type="submit" disabled={trabajando}
              className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-semibold disabled:opacity-50">
              {trabajando ? 'Guardando…' : completarDatos ? 'Guardar y entrar' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        <div className="flex justify-center gap-4 text-sm mt-6">
          {!obligatorio && <a href={volverA} className="tap inline-flex items-center text-marca-700 font-medium">Volver</a>}
          <form action="/api/logout" method="post">
            <button className="tap text-[var(--texto-suave)]">Salir</button>
          </form>
        </div>
      </div>
    </main>
  );
}
