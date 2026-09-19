/**
 * Lo que se ve apenas se toca otra sección del menú, mientras llegan los
 * datos. Sin esto la pantalla anterior se quedaba quieta uno o dos segundos y
 * parecía que el clic no había funcionado.
 */
export default function Cargando() {
  return (
    <div className="px-4 py-6 animate-pulse" aria-busy="true" aria-label="Cargando">
      <div className="h-5 w-40 rounded bg-[var(--borde)] mb-5" />
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[0, 1, 2].map((i) => <div key={i} className="tarjeta h-16" />)}
      </div>
      <div className="tarjeta h-40" />
    </div>
  );
}
