'use client';

import { useId } from 'react';

/** Atributos que el campo entrega al control para quedar bien enlazado. */
export interface PropsControl {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

/**
 * Etiqueta, ayuda y error de un campo, enlazados de verdad.
 *
 * El problema que resuelve no se ve mirando la pantalla: la app tenía trece
 * `<label>` dibujados encima de su input pero sin `htmlFor`, es decir, sin
 * ninguna relación con el control. Se ven como etiquetas y no lo son. Un lector
 * de pantalla anuncia "cuadro de texto, en blanco" y el usuario no sabe si está
 * escribiendo el precio o el costo. Tampoco funciona tocar la etiqueta para
 * enfocar el campo, que en el celular es la mitad del área útil del campo.
 *
 * El `id` lo genera `useId` y se entrega al control, así que el enlace no
 * depende de que alguien recuerde escribirlo:
 *
 * ```tsx
 * <Campo etiqueta="Precio de venta" obligatorio error={v.error}>
 *   {(p) => <input {...p} inputMode="numeric" value={precio} … />}
 * </Campo>
 * ```
 *
 * El error viaja por `aria-describedby` y marca `aria-invalid`: se anuncia al
 * llegar al campo, no solo al intentar guardar.
 */
export function Campo({
  etiqueta, obligatorio, ayuda, error, children,
}: {
  etiqueta: string;
  obligatorio?: boolean;
  ayuda?: string;
  /** Mensaje de validación. Si viene, el control queda marcado como inválido. */
  error?: string | null;
  children: (props: PropsControl) => React.ReactNode;
}) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;

  const describedBy = [ayuda ? idAyuda : null, error ? idError : null]
    .filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5">
        {etiqueta}
        {obligatorio && (
          <span className="text-[var(--color-alerta)]" aria-hidden> *</span>
        )}
        {obligatorio && <span className="sr-only"> (obligatorio)</span>}
      </label>

      {ayuda && (
        <p id={idAyuda} className="text-xs text-[var(--texto-suave)] mb-1.5">{ayuda}</p>
      )}

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      {error && (
        <p id={idError} className="text-xs text-[var(--color-alerta)] mt-1">{error}</p>
      )}
    </div>
  );
}
