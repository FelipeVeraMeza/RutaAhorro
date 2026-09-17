import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { VentasClient } from './VentasClient';

export const metadata = { title: 'Ventas' };

export default async function VentasPage() {
  const user = await getCurrentUser();

  // Un vendedor no revisa el historial completo del local (matriz del doc 02).
  if (!['admin', 'supervisor'].includes(user!.role)) redirect('/');

  // Anular es de admin y supervisor, y fn_void_sale además le exige al
  // supervisor que la venta sea del día. La pantalla no repite esa segunda
  // regla: la base la aplica y el error se explica solo.
  return <VentasClient puedeAnular={['admin', 'supervisor'].includes(user!.role)} />;
}
