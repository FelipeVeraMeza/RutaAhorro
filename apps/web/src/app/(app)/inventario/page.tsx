import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { InventarioClient } from './InventarioClient';

export const metadata = { title: 'Inventario' };

export default async function InventarioPage() {
  const user = await getCurrentUser();

  // El vendedor no entra a inventario (matriz del doc 02)
  if (!['admin', 'supervisor', 'bodega'].includes(user!.role)) redirect('/');

  return (
    <InventarioClient
      puedeAjustar={['admin', 'supervisor', 'bodega'].includes(user!.role)}
      verCostos={user!.role === 'admin'}
    />
  );
}
