'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRut, isValidRut, rutDeCorreo, toUserMessage } from '@rutaahorro/core';
import { Campo } from '@/components/Campo';
import { repoUsuarios } from '@/lib/datos/usuarios';

/**
 * Nombre y RUT propios (Felipe, 2026-10-07: "ellos pueden cambiar el RUT, la
 * clave y el nombre, editar su perfil a su gusto"). La clave tiene su propia
 * pantalla (/clave). El rol y el descuento siguen siendo del administrador.
 */
export function MisDatos({ nombre: nombreInicial, email }: { nombre: string; email: string | null }) {
  const router = useRouter();
  const rutInicial = rutDeCorreo(email);
  const [nombre, setNombre] = useState(nombreInicial);
  const [rut, setRut] = useState(rutInicial ?? '');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cambio = nombre.trim() !== nombreInicial || (rutInicial !== null && formatRut(rut) !== rutInicial);

  async function guardar() {
    setAviso(null);
    if (nombre.trim().length < 2) { setAviso({ ok: false, texto: 'Escribe tu nombre' }); return; }
    if (rutInicial && !isValidRut(rut)) { setAviso({ ok: false, texto: 'El RUT no es válido: revisa el dígito verificador' }); return; }
    setGuardando(true);
    try {
      await repoUsuarios().editarDatos(null, { nombre: nombre.trim(), ...(rutInicial ? { rut: formatRut(rut) } : {}) });
      const rutCambio = rutInicial !== null && formatRut(rut) !== rutInicial;
      setAviso({ ok: true, texto: rutCambio ? 'Guardado. Desde ahora entras con tu RUT nuevo.' : 'Guardado.' });
      router.refresh();
    } catch (e) {
      setAviso({ ok: false, texto: (e as { detalle?: string }).detalle ?? toUserMessage(e) });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Campo etiqueta="Nombre" ayuda="El que sale en las ventas, la caja y la bitácora.">
        {(p) => <input {...p} value={nombre} onChange={(e) => setNombre(e.target.value)}
                       className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />}
      </Campo>
      {rutInicial ? (
        <Campo etiqueta="RUT" ayuda="Con dígito verificador. Entras con los números antes del guion.">
          {(p) => <input {...p} value={rut} onChange={(e) => setRut(e.target.value)}
                         onBlur={() => { if (isValidRut(rut)) setRut(formatRut(rut)); }}
                         autoComplete="off" className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num" />}
        </Campo>
      ) : (
        <p className="text-sm"><span className="text-[var(--texto-suave)]">Entras con el correo </span>
          <span className="break-all">{email ?? '—'}</span></p>
      )}
      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'}
           className={`text-sm px-3 py-2 rounded-lg ${aviso.ok ? 'bg-marca-50 text-marca-900' : 'bg-red-50 text-[var(--color-alerta)]'}`}>
          {aviso.texto}
        </p>
      )}
      <button onClick={() => void guardar()} disabled={guardando || !cambio} className="btn btn-primario">
        {guardando ? 'Guardando…' : 'Guardar mis datos'}
      </button>
    </div>
  );
}
