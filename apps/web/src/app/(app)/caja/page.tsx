import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { CajaClient } from './CajaClient';

export const metadata = { title: 'Caja' };

export default async function CajaPage() {
  const user = await getCurrentUser();
  const client = await createClient();

  const { data: session } = await client
    .from('cash_sessions')
    .select('id, opened_at, opening_amount')
    .eq('user_id', user!.id)
    .eq('status', 'abierta')
    .maybeSingle();

  let resumen: Record<string, unknown> | null = null;
  let movimientos: Array<{ id: string; type: string; amount: number; reason: string; created_at: string }> = [];

  if (session) {
    const { data } = await client.rpc('fn_cash_session_summary', { p_session_id: session.id });
    resumen = (data as Record<string, unknown>) ?? null;

    const { data: movs } = await client
      .from('cash_movements')
      .select('id, type, amount, reason, created_at')
      .eq('cash_session_id', session.id)
      .order('created_at', { ascending: false });
    movimientos = movs ?? [];
  }

  // Historial de cierres: solo para quien puede verlo (matriz de permisos)
  const puedeVerHistorial = user!.role === 'admin' || user!.role === 'supervisor';
  const { data: historial } = puedeVerHistorial
    ? await client
        .from('v_cash_sessions_summary')
        .select('session_id, full_name, opened_at, closed_at, difference, sales_total, status')
        .eq('status', 'cerrada')
        .order('closed_at', { ascending: false })
        .limit(10)
    : { data: [] };

  return (
    <CajaClient
      session={session ?? null}
      resumen={resumen}
      movimientos={movimientos}
      historial={historial ?? []}
    />
  );
}
