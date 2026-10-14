import type { Metadata } from 'next';
import { datosTienda } from '@/lib/tienda/catalogo';
import { CarritoCliente } from '@/components/tienda/CarritoCliente';

// El carrito es de cada persona: no tiene nada que hacer en un buscador.
export const metadata: Metadata = { title: 'Carrito', robots: { index: false, follow: true } };
export const dynamic = 'force-dynamic';

export default async function CarritoPage() {
  const tienda = await datosTienda().catch(() => null);
  return (
    <CarritoCliente telefono={tienda?.telefono ?? null} direccion={tienda?.direccion ?? null}
      pedidosActivos={tienda?.pedidosActivos ?? false} pedidoMinimo={tienda?.pedidoMinimo ?? 0}
      zona={tienda?.zona ?? 'America/Santiago'} />
  );
}
