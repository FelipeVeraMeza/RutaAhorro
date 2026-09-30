import { exigirRol } from '@/lib/permisos';
import { VentasClient } from './VentasClient';

export const metadata = { title: 'Ventas' };

export default async function VentasPage() {
  // El vendedor entra a "Mis ventas": la base (RLS de `sales`) le entrega solo
  // las suyas, y no puede anular ni devolver (matriz del doc 02).
  const user = await exigirRol(['admin', 'supervisor', 'vendedor']);
  return (
    <VentasClient
      puedeAnular={user.role === 'admin' || user.role === 'supervisor'}
      soloPropias={user.role === 'vendedor'}
    />
  );
}
