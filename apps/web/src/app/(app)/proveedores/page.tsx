import { exigirRol } from '@/lib/permisos';
import { ProveedoresClient } from './ProveedoresClient';

export const metadata = { title: 'Compras' };

export default async function ProveedoresPage() {
  // El vendedor no participa en compras (matriz del doc 02)
  const user = await exigirRol(['admin', 'supervisor', 'bodega']);

  // Anular recepción es solo del administrador (RF-M3-09)
  return <ProveedoresClient puedeAnular={user.role === 'admin'} />;
}
