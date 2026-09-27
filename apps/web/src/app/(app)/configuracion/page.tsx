import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { ConfiguracionClient } from './ConfiguracionClient';

export const metadata = { title: 'Configuración' };

export default async function ConfiguracionPage() {
  const user = await getCurrentUser();
  // Solo el administrador. La base lo impone igual (fn_guardar_configuracion,
  // fn_guardar_impuesto): ocultar la pantalla no es la protección.
  if (user!.role !== 'admin') redirect('/');
  return <ConfiguracionClient />;
}
