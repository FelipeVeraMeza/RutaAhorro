import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { RecepcionClient } from './RecepcionClient';

export const metadata = { title: 'Recibir mercadería' };

export default async function RecepcionPage() {
  const user = await getCurrentUser();
  if (!['admin', 'supervisor', 'bodega'].includes(user!.role)) redirect('/');
  return <RecepcionClient />;
}
