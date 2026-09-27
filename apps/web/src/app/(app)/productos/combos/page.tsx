import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { CombosClient } from './CombosClient';

export const metadata = { title: 'Combos' };

export default async function CombosPage() {
  if (DEMO_ACTIVO) return <CombosClient />;
  const user = await getCurrentUser();
  // Los mismos que fn_guardar_combo, y que editan ofertas.
  if (user!.role !== 'admin' && user!.role !== 'supervisor') redirect('/productos');
  return <CombosClient />;
}
