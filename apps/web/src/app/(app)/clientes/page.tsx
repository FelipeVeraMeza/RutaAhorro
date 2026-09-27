import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { ClientesClient } from './ClientesClient';

export const metadata = { title: 'Clientes' };

export default async function ClientesPage() {
  if (DEMO_ACTIVO) return <ClientesClient />;
  const user = await getCurrentUser();
  // Los mismos que fn_guardar_cliente. El vendedor elige al cliente en el POS.
  if (user!.role !== 'admin' && user!.role !== 'supervisor') redirect('/');
  return <ClientesClient />;
}
