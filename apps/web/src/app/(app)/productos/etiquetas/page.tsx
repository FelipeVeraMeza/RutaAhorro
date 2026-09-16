import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { EtiquetasClient } from './EtiquetasClient';

export const metadata = { title: 'Etiquetas' };

export default async function EtiquetasPage() {
  if (DEMO_ACTIVO) return <EtiquetasClient puedeVerCostos />;

  const user = await getCurrentUser();
  const rol = user!.role;

  // Mismo criterio que la pantalla de productos: quien puede editar el
  // catálogo puede etiquetarlo. El vendedor no.
  if (rol !== 'admin' && rol !== 'supervisor' && rol !== 'bodega') redirect('/');

  return <EtiquetasClient puedeVerCostos={rol === 'admin'} />;
}
