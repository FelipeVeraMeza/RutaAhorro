import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { ProveedoresClient } from './ProveedoresClient';

export const metadata = { title: 'Compras' };

export default async function ProveedoresPage() {
  const user = await getCurrentUser();

  // El vendedor no participa en compras (matriz del doc 02)
  if (!['admin', 'supervisor', 'bodega'].includes(user!.role)) redirect('/');

  // Anular recepción es solo del administrador (RF-M3-09)
  return <ProveedoresClient puedeAnular={user!.role === 'admin'} />;
}
