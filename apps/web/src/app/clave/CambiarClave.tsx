'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Logo } from '@/components/Logo';

const MINIMO = 8;

export function CambiarClave({ nombre, obligatorio, demo, volverA }: {
  nombre: string;
  /** Entró con la clave temporal del administrador: no puede saltarse esto. */
  obligatorio: boolean;
  demo: boolean;
  volverA: string;
}) {
  const router = useRouter();
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave.length < MINIMO) { setError(`La contraseña debe tener al menos ${MINIMO} caracteres`); return; }
    if (clave !== repetida) { setError('Las dos contraseñas no son iguales'); return; }
    if (demo) { setError('En el modo demo las contraseñas son de ejemplo y no se cambian.'); return; }
    setTrabajando(true);
    try {
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
          <h1 className="text-2xl font-bold">{obligatorio ? 'Crea tu contraseña' : 'Cambiar mi contraseña'}</h1>
          <p className="text-sm text-[var(--texto-suave)] mt-1">{nombre}</p>
        </div>

        {obligatorio && (
          <p className="text-sm bg-amber-50 text-[var(--color-aviso)] px-3 py-2 rounded-lg mb-4">
            Entraste con una contraseña temporal que te dio el administrador.
            Elige una tuya: desde ahora, lo que hagas en el sistema queda a tu nombre.
          </p>
        )}

        {listo ? (
          <p role="status" className="tarjeta p-5 text-center font-medium">✓ Contraseña guardada. Entrando…</p>
        ) : (
          <form onSubmit={guardar} className="tarjeta p-5 space-y-4">
            <div>
              <label htmlFor="clave" className="block text-sm font-medium mb-1.5">Contraseña nueva</label>
              <input id="clave" type={ver ? 'text' : 'password'} autoComplete="new-password" required autoFocus
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
              {trabajando ? 'Guardando…' : 'Guardar contraseña'}
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
