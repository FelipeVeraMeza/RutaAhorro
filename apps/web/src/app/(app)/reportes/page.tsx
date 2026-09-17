import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { ReportesClient } from './ReportesClient';

export const metadata = { title: 'Reportes' };

export default async function ReportesPage() {
  const user = await getCurrentUser();

  // RF-M7-12: los reportes respetan la matriz del doc 02. El vendedor y bodega
  // no entran; el costo y el margen son solo del administrador, y no se piden
  // siquiera cuando no corresponde.
  if (!['admin', 'supervisor'].includes(user!.role)) redirect('/');

  return <ReportesClient verCostos={user!.role === 'admin'} />;
}
