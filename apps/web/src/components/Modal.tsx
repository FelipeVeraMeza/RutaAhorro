'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Los diálogos abiertos, el de más arriba al final. Solo ese atiende el
 * teclado. Sin esto, con dos abiertos (el detalle de una venta y, encima, su
 * boleta) los dos escuchaban Escape y Tab en el documento: Escape cerraba el
 * de abajo y dejaba el de arriba flotando, y Tab lo movía el de abajo.
 */
const pila: string[] = [];

/**
 * Diálogo modal de la aplicación.
 *
 * Existe porque los nueve diálogos que había estaban escritos a mano, cada uno
 * con su propio `<div role="dialog">`, y todos compartían los mismos cuatro
 * defectos: no cerraban con Escape, no atrapaban el foco, no lo devolvían al
 * salir y siete de los nueve no tenían nombre accesible. Un lector de pantalla
 * anunciaba "diálogo" y nada más.
 *
 * Lo que arregla, y por qué importa en un almacén:
 *
 * - **Escape cierra.** En el mostrador se opera con prisa. Un diálogo que solo
 *   se cierra apuntando al botón "Cancelar" es un diálogo que se queda abierto.
 * - **El foco queda adentro.** Sin esto, tabular desde el diálogo lleva a los
 *   botones de la pantalla de atrás —que se ven, porque el fondo es semi
 *   transparente— y se puede disparar una acción invisible.
 * - **El foco vuelve de donde salió.** Quien navega con teclado no queda
 *   perdido al principio de la página cada vez que cierra algo.
 * - **El fondo no se desplaza.** En el celular, tocar fuera del diálogo movía
 *   la página de atrás y el diálogo quedaba flotando sobre otra cosa.
 *
 * `bloqueado` es para las operaciones que ya salieron hacia la base: mientras
 * se confirma una recepción o se cierra una caja, el diálogo no se cierra ni
 * con Escape ni tocando el fondo. Cancelar a medias no cancela nada en el
 * servidor, solo le esconde el resultado al usuario.
 */
export function Modal({
  titulo,
  descripcion,
  onCerrar,
  bloqueado = false,
  ancho = 'sm',
  encabezado = 'oculto',
  children,
}: {
  /** Nombre accesible del diálogo. Obligatorio: un diálogo sin nombre no se anuncia. */
  titulo: string;
  /** Texto de apoyo asociado con `aria-describedby`. */
  descripcion?: string;
  /** Si no se entrega, el diálogo no se puede cerrar desde afuera del contenido. */
  onCerrar?: () => void;
  /** Impide cerrar mientras hay una operación en vuelo. */
  bloqueado?: boolean;
  ancho?: 'sm' | 'md' | 'lg';
  /** `visible` dibuja la barra de título; `oculto` deja el título solo para lectores de pantalla. */
  encabezado?: 'visible' | 'oculto';
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  const idPila = useId();

  useEffect(() => {
    pila.push(idPila);
    return () => { const i = pila.lastIndexOf(idPila); if (i >= 0) pila.splice(i, 1); };
  }, [idPila]);
  const idDescripcion = useId();

  const cerrar = useCallback(() => {
    if (!bloqueado) onCerrar?.();
  }, [bloqueado, onCerrar]);

  // Foco: recordar de dónde vino, llevarlo adentro, devolverlo al salir.
  // De dónde vino se anota al dibujar, antes que un `autoFocus` de adentro lo
  // mueva: si no, "volver" apuntaba a un campo del diálogo que ya no existe y
  // el foco se perdía al cerrar. Y un campo con `autoFocus` se respeta: antes
  // el diálogo lo pisaba llevando el foco al primer botón (el monto del cobro,
  // el motivo, el descuento quedaban sin el cursor que pedían).
  const previoRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  useEffect(() => {
    const previo = previoRef.current;
    if (!panel.current?.contains(document.activeElement)) {
      const primero = enfocables(panel.current)[0] ?? panel.current;
      primero?.focus();
    }
    return () => previo?.focus?.();
  }, []);

  // El fondo no se desplaza mientras el diálogo está abierto.
  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = antes; };
  }, []);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (pila[pila.length - 1] !== idPila) return;   // hay otro diálogo encima
      if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
      if (e.key !== 'Tab') return;

      const lista = enfocables(panel.current);
      if (lista.length === 0) { e.preventDefault(); return; }

      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;

      // El ciclo se cierra a mano: sin esto, Tab en el último elemento salta a
      // la pantalla de atrás, que está visible pero no es operable.
      if (e.shiftKey && (activo === primero || !panel.current?.contains(activo))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    }
    document.addEventListener('keydown', alTeclear, true);
    return () => document.removeEventListener('keydown', alTeclear, true);
  }, [cerrar, idPila]);

  const anchos = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg' };

  // Directo en <body>: dentro de la cabecera (sticky, z-30) su z-50 quedaba
  // encerrado y la barra inferior del celular (z-40) tapaba los botones de
  // abajo del diálogo. Lo encontró demo-ronda2.mjs con "Hay ventas sin enviar".
  const dialogo = (
    <div
      className="fixed inset-0 z-50 bg-black/40 overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}
    >
      <div className="min-h-full flex items-end sm:items-center justify-center sm:p-4 pointer-events-none">
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={idTitulo}
          aria-describedby={descripcion ? idDescripcion : undefined}
          tabIndex={-1}
          className={`pointer-events-auto w-full ${anchos[ancho]} bg-white rounded-t-2xl sm:rounded-2xl outline-none`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {encabezado === 'visible' ? (
            <header className="sticky top-0 bg-white border-b border-[var(--borde)] px-4 py-3 flex items-center justify-between rounded-t-2xl">
              <h2 id={idTitulo} className="font-semibold">{titulo}</h2>
              {onCerrar && (
                <button
                  onClick={cerrar}
                  disabled={bloqueado}
                  className="tap px-3 text-sm text-[var(--texto-suave)] disabled:opacity-40"
                >
                  Cancelar
                </button>
              )}
            </header>
          ) : (
            <h2 id={idTitulo} className="sr-only">{titulo}</h2>
          )}

          {descripcion && (
            <p id={idDescripcion} className="sr-only">{descripcion}</p>
          )}

          {children}
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialogo : createPortal(dialogo, document.body);
}

const SELECTOR_ENFOCABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function enfocables(raiz: HTMLElement | null): HTMLElement[] {
  if (!raiz) return [];
  return Array.from(raiz.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE))
    // `offsetParent` nulo = el elemento está oculto. Un foco invisible deja al
    // usuario de teclado escribiendo en un campo que no ve.
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}
