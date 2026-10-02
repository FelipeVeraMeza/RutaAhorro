import { exigirRol } from '@/lib/permisos';
import { InventarioClient } from './InventarioClient';

export const metadata = { title: 'Inventario' };

export default async function InventarioPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  // El vendedor no entra a inventario (matriz del doc 02)
  const user = await exigirRol(['admin', 'supervisor', 'bodega']);
  const { vista } = await searchParams;
  return (
    <InventarioClient
      puedeAjustar
      verCostos={user.role === 'admin'}
      puedeOfertar={user.role === 'admin' || user.role === 'supervisor'}
      vistaInicial={vista === 'lotes' || vista === 'kardex' || vista === 'toma' ? vista : 'stock'}
    />
  );
}
