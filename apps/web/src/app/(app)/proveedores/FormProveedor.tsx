'use client';

import { useState } from 'react';
import { isValidRut, formatRut, toUserMessage } from '@rutaahorro/core';
import { repoProveedores, type Proveedor } from '@/lib/datos/proveedores';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';

/**
 * Alta y edición de un proveedor. Vive aparte porque también se abre desde
 * Recibir mercadería: el proveedor nuevo llega con la factura en la mano, y
 * salir a Compras a crearlo cortaba la recepción.
 */
export function FormProveedor({
  proveedor, onGuardado, onCancelar,
}: {
  proveedor: Proveedor | null;
  /** El id del proveedor guardado: Recibir mercadería lo deja elegido. */
  onGuardado: (id: string) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '');
  const [rut, setRut] = useState(proveedor?.rut ?? '');
  const [contacto, setContacto] = useState(proveedor?.contacto ?? '');
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '');
  const [email, setEmail] = useState(proveedor?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const rutValido = rut.trim() === '' || isValidRut(rut);
  // Un correo mal escrito no rompe nada hoy, pero sí cuando haya que mandarle
  // la orden de compra al proveedor y el correo rebote sin que nadie se entere.
  const correoValido = email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  async function guardar() {
    setError(null);
    if (nombre.trim() === '') { setError('El nombre es obligatorio'); return; }
    if (!rutValido) { setError('El RUT no es válido'); return; }
    if (!correoValido) { setError('Revisa el correo: le falta el @ o el punto del dominio'); return; }

    setGuardando(true);
    try {
      const datos = {
        nombre: nombre.trim(),
        rut: rut.trim() ? formatRut(rut) : null,
        contacto: contacto.trim() || null,
        telefono: telefono.trim() || null,
        email: email.trim() || null,
      };
      if (proveedor) {
        await repoProveedores().actualizar(proveedor.id, datos);
        onGuardado(proveedor.id);
      } else {
        onGuardado((await repoProveedores().crear(datos)).id);
      }
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={proveedor ? 'Editar proveedor' : 'Nuevo proveedor'}
      ancho="md"
      encabezado="visible"
      onCerrar={onCancelar}
      bloqueado={guardando}
    >
      <div className="p-5 space-y-3">
        <Campo etiqueta="Nombre o razón social" obligatorio>
          {(p) => (
            <input {...p} value={nombre} onChange={(e) => setNombre(e.target.value)}
                   placeholder="Ej: Distribuidora Los Andes Ltda." autoFocus
                   className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />
          )}
        </Campo>

        <Campo
          etiqueta="RUT"
          ayuda="Opcional. Se valida el dígito verificador al escribirlo."
          error={!rutValido ? 'El dígito verificador no cuadra' : null}
        >
          {(p) => (
            <input {...p} value={rut} onChange={(e) => setRut(e.target.value)}
                   placeholder="76.123.456-7"
                   className={`tap w-full px-3 py-2.5 rounded-xl border ${
                     rutValido ? 'border-[var(--borde)]' : 'border-[var(--color-alerta)]'
                   }`} />
          )}
        </Campo>

        <Campo etiqueta="Persona de contacto">
          {(p) => (
            <input {...p} value={contacto} onChange={(e) => setContacto(e.target.value)}
                   placeholder="Ej: Marcela Soto"
                   className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />
          )}
        </Campo>

        <Campo etiqueta="Teléfono">
          {(p) => (
            <input {...p} value={telefono} onChange={(e) => setTelefono(e.target.value)}
                   type="tel" inputMode="tel" autoComplete="tel" placeholder="+56 9 1234 5678"
                   className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />
          )}
        </Campo>

        <Campo etiqueta="Correo" error={correoValido ? null : 'Ese correo no tiene forma de correo'}>
          {(p) => (
            <input {...p} value={email} onChange={(e) => setEmail(e.target.value)}
                   type="email" inputMode="email" autoCapitalize="none"
                   placeholder="contacto@proveedor.cl"
                   className={`tap w-full px-3 py-2.5 rounded-xl border ${
                     correoValido ? 'border-[var(--borde)]' : 'border-[var(--color-alerta)]'
                   }`} />
          )}
        </Campo>

        {error && (
          <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button onClick={() => void guardar()} disabled={guardando}
                className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : proveedor ? 'Guardar cambios' : 'Crear proveedor'}
        </button>
      </div>
    </Modal>
  );
}
