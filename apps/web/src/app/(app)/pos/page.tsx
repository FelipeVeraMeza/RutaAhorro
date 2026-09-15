import { getCurrentUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import { PosClient } from './PosClient';

export const metadata = { title: 'Vender' };

export default async function PosPage() {
  const user = await getCurrentUser();
  const client = await createClient();

  // ¿Tiene caja abierta? Sin caja no se puede vender (RF-M5-16).
  const { data: session } = await client
    .from('cash_sessions')
    .select('id, opened_at, opening_amount')
    .eq('user_id', user!.id)
    .eq('status', 'abierta')
    .maybeSingle();

  return <PosClient hasOpenSession={Boolean(session)} />;
}
