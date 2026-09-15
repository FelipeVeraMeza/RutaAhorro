import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { UsuariosClient } from './UsuariosClient';

export const metadata = { title: 'Usuarios' };

export default async function UsuariosPage() {
  const user = await getCurrentUser();

  // Solo el administrador gestiona usuarios (matriz del doc 02)
  if (user!.role !== 'admin') redirect('/');

  return <UsuariosClient miId={user!.id} />;
}
