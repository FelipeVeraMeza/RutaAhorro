import Link from 'next/link';
import { Icono, type NombreIcono } from './Icono';

/**
 * El encabezado de cada pantalla: título, para qué sirve y sus acciones.
 *
 * Antes cada pantalla lo armaba a su manera (dos tamaños de título, "←
 * Productos" de 16 px de alto, botones que bajaban de línea sin orden) y casi
 * ninguna decía qué se hace ahí: quien entraba por primera vez tenía que
 * adivinar. La frase de ayuda es la misma del menú "Más" (lib/navegacion).
 */
export function Encabezado({
  titulo, descripcion, icono, volver, acciones, detalle,
}: {
  titulo: React.ReactNode;
  /** Una frase: qué se hace en esta pantalla. */
  descripcion?: React.ReactNode;
  icono?: NombreIcono;
  /** Pantalla de la que cuelga (ej. Ofertas cuelga de Productos). */
  volver?: { href: string; texto: string };
  /** Botones de la pantalla. Bajan de línea en el celular sin desbordar. */
  acciones?: React.ReactNode;
  /** Un dato corto bajo el título: "12 productos", "Cargando…". */
  detalle?: React.ReactNode;
}) {
  return (
    <header className="mb-4">
      {volver && (
        <Link href={volver.href} prefetch={false}
          className="tap -ml-2 inline-flex items-center gap-1 px-2 text-sm text-[var(--texto-suave)] hover:text-[var(--texto)]">
          <Icono nombre="volver" tamano={16} /> {volver.texto}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {icono && (
            <span className="hidden sm:grid place-items-center w-10 h-10 rounded-xl bg-marca-50 text-marca-700 shrink-0">
              <Icono nombre={icono} tamano={21} />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">{titulo}</h1>
            {descripcion && <p className="text-sm text-[var(--texto-suave)] mt-0.5">{descripcion}</p>}
            {detalle && <p className="text-xs text-[var(--texto-suave)] mt-1 num">{detalle}</p>}
          </div>
        </div>
        {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
      </div>
    </header>
  );
}

/** Lo que se muestra cuando una lista está vacía: qué pasa y qué hacer. */
export function EstadoVacio({
  icono = 'productos', titulo, texto, children,
}: {
  icono?: NombreIcono;
  titulo: string;
  texto?: React.ReactNode;
  /** Botones para salir del vacío ("Crear el primero"). */
  children?: React.ReactNode;
}) {
  return (
    <div className="text-center py-10 px-4">
      <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-[var(--superficie)] border border-[var(--borde)] text-[var(--texto-suave)] mb-3">
        <Icono nombre={icono} tamano={26} />
      </span>
      <p className="font-semibold">{titulo}</p>
      {texto && <p className="text-sm text-[var(--texto-suave)] mt-1 max-w-sm mx-auto">{texto}</p>}
      {children && <div className="flex flex-wrap gap-2 justify-center mt-4">{children}</div>}
    </div>
  );
}
