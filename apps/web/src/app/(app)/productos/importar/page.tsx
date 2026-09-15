import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { ImportarClient } from './ImportarClient';

export const metadata = { title: 'Carga masiva de productos' };

export default async function ImportarPage() {
  const user = await getCurrentUser();

  // El vendedor no puede cargar catálogo (RF-M2-11, matriz del doc 02)
  if (!['admin', 'supervisor', 'bodega'].includes(user!.role)) redirect('/productos');

  return <ImportarClient />;
}
