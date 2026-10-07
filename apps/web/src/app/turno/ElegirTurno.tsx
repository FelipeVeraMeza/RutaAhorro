'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { Icono, type NombreIcono } from '@/components/Icono';
import { inicioPara, type Rol } from '@/lib/navegacion';

const OPCION: Record<string, { titulo: string; detalle: string; icono: NombreIcono }> = {
  vendedor: { titulo: 'Vendo y cobro', detalle: 'Vendedor/a o cajero/a: abre su caja, vende y la cierra.', icono: 'caja' },
  bodega: { titulo: 'Bodega', detalle: 'Recibe mercadería, cuenta y ajusta el inventario. No vende.', icono: 'productos' },
  supervisor: { titulo: 'Supervisor', detalle: 'Opera el local y autoriza descuentos.', icono: 'usuarios' },
};

export function ElegirTurno({ nombre, roles, actual }: { nombre: string; roles: string[]; actual: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir(rol: string) {
    setError(null);
    setEnviando(rol);
    try {
      const res = await fetch('/api/cuenta/rol', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol }),
      });
      const c = await res.json().catch(() => ({}));
      if (!res.ok) { setError(c?.error?.message ?? 'No se pudo elegir el rol'); return; }
      router.push(inicioPara(rol as Rol));
      router.refresh();
    } catch {
      setError('No hay conexión con el servidor. Revisa internet y vuelve a intentar.');
    } finally {
      setEnviando(null);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col justify-center px-5 py-10">
      <div className="w-full max-w-sm mx-auto">
        <div className="text-center mb-6">
          <div className="inline-flex rounded-2xl bg-marca-900 px-5 py-3 mb-4"><Logo tamano={48} /></div>
          <h1 className="text-2xl font-bold">¿Cómo trabajas hoy?</h1>
          <p className="text-sm text-[var(--texto-suave)] mt-1">{nombre}</p>
        </div>
        <ul className="space-y-3">
          {roles.map((r) => {
            const o = OPCION[r] ?? { titulo: r, detalle: '', icono: 'cuenta' as NombreIcono };
            return (
              <li key={r}>
                <button onClick={() => void elegir(r)} disabled={enviando !== null}
                  className={`tap w-full text-left flex items-center gap-3 p-4 rounded-2xl border-2 bg-white disabled:opacity-60 ${
                    r === actual ? 'border-marca-500' : 'border-[var(--borde)]'}`}>
                  <span className="grid place-items-center w-12 h-12 rounded-xl bg-marca-50 text-marca-700 shrink-0">
                    <Icono nombre={o.icono} tamano={24} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block">{enviando === r ? 'Entrando…' : o.titulo}</strong>
                    <span className="block text-sm text-[var(--texto-suave)]">{o.detalle}</span>
                    {r === actual && <span className="block text-xs text-marca-700 mt-0.5">El de tu último turno</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mt-4">{error}</p>}
        <div className="flex justify-center mt-6">
          <form action="/api/logout" method="post">
            <button className="tap text-sm text-[var(--texto-suave)]">Salir</button>
          </form>
        </div>
      </div>
    </main>
  );
}
