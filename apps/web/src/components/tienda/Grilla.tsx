import type { ProductoTienda } from '@rutaahorro/core';
import { TarjetaProducto } from './TarjetaProducto';

/** La grilla de tarjetas: 2 columnas en el celular, 3 en tableta, 4 en computador. */
export function Grilla({ productos, prioridad = 0 }: { productos: ProductoTienda[]; prioridad?: number }) {
  return (
    <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
      {productos.map((p, i) => <li key={p.id} className="flex"><TarjetaProducto producto={p} prioridad={i < prioridad} /></li>)}
    </ul>
  );
}
