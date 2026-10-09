import type { Metadata } from 'next';
import { datosTienda } from '@/lib/tienda/catalogo';
import { CarritoCliente } from '@/components/tienda/CarritoCliente';

export const metadata: Metadata = { title: 'Carrito' };
export const dynamic = 'force-dynamic';

export default async function CarritoPage() {
  const tienda = await datosTienda();
  return <CarritoCliente telefono={tienda?.telefono ?? null} direccion={tienda?.direccion ?? null} />;
}
