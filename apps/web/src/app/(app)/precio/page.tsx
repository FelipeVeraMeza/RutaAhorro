import { getCurrentUser } from '@/lib/supabase/server';
import { PrecioClient } from './PrecioClient';

export const metadata = { title: 'Consultar precio' };

/**
 * Los precios salen del catálogo replicado en el dispositivo, que es lo que
 * la hace funcionar sin internet. Del servidor solo viene quién es: el
 * usuario ya lo leyó el layout, así que no es otra consulta.
 */
export default async function PrecioPage() {
  const user = await getCurrentUser();
  return (
    <PrecioClient
      usuarioId={user?.id ?? ''}
      // Bodega consulta pero no vende: no ve "Agregar a la venta".
      puedeVender={user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'vendedor'}
      puedeCrearProductos={user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'bodega'}
    />
  );
}
