/**
 * Mientras carga una pestaña: el esqueleto de la grilla, en vez de quedarse
 * en la pantalla anterior sin que nada indique que se tocó algo.
 */
export default function CargandoTienda() {
  return (
    <div className="flex flex-col gap-5" aria-busy aria-label="Cargando">
      <div className="h-9 w-48 rounded-lg bg-[var(--borde)] animate-pulse" />
      <div className="h-12 rounded-xl bg-[var(--borde)] animate-pulse" />
      <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="tarjeta p-3 flex flex-col gap-3">
            <div className="aspect-square rounded-xl bg-[var(--fondo)] animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-[var(--fondo)] animate-pulse" />
            <div className="h-6 w-1/3 rounded bg-[var(--fondo)] animate-pulse" />
            <div className="h-11 rounded-xl bg-[var(--fondo)] animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
