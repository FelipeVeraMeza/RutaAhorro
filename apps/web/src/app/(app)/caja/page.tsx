import { createClient } from '@/lib/supabase/server';
import { exigirRol } from '@/lib/permisos';
import { DEMO_ACTIVO } from '@/lib/demo';
import { cookies } from 'next/headers';
import { DEMO_COOKIE_CAJA, leerCajaDemo, resumenCajaDemo } from '@/lib/demo/caja';
import { CajaClient } from './CajaClient';

export const metadata = { title: 'Caja' };

export default async function CajaPage() {
  // Bodega no tiene caja ni ve dinero (matriz del doc 02).
  const user = await exigirRol(['admin', 'supervisor', 'vendedor']);

  if (DEMO_ACTIVO) {
    // La caja de la maqueta vive en una cookie (lib/demo/caja.ts): se abre,
    // recibe movimientos y se cierra como la real.
    const c = leerCajaDemo((await cookies()).get(DEMO_COOKIE_CAJA)?.value, user.id);
    const puedeVerHistorial = user.role === 'admin' || user.role === 'supervisor';
    return (
      <CajaClient
        session={c.abierta ? { id: c.id, opened_at: c.abiertaEn, opening_amount: c.apertura } : null}
        resumen={c.abierta ? resumenCajaDemo(c) : null}
        movimientos={c.abierta ? c.movs : []}
        historial={puedeVerHistorial ? c.cierres : []}
        usuarioId={user.id}
        nombre={user.fullName}
      />
    );
  }

  const client = await createClient();

  const { data: session } = await client
    .from('cash_sessions')
    .select('id, opened_at, opening_amount')
    .eq('user_id', user.id)
    .eq('status', 'abierta')
    .maybeSingle();

  let resumen: Record<string, unknown> | null = null;
  let movimientos: Array<{ id: string; type: string; amount: number; reason: string; created_at: string }> = [];

  // Todo lo que sigue depende solo de la sesión y del rol: va en paralelo.
  // En fila eran cuatro viajes a Supabase uno tras otro.
  const puedeVerHistorial = user.role === 'admin' || user.role === 'supervisor';
  const sinFilas = Promise.resolve({ data: [] as never[] });
  const [rResumen, rMovs, { data: historial }, { data: ajenas }] = await Promise.all([
    session ? client.rpc('fn_cash_session_summary', { p_session_id: session.id }) : Promise.resolve({ data: null }),
    session
      ? client
          .from('cash_movements')
          .select('id, type, amount, reason, created_at')
          .eq('cash_session_id', session.id)
          .order('created_at', { ascending: false })
      : sinFilas,
    // Historial de cierres: solo para quien puede verlo (matriz de permisos)
    puedeVerHistorial
    ? client
        .from('v_cash_sessions_summary')
        .select('session_id, full_name, opened_at, closed_at, difference, sales_total, status')
        .eq('status', 'cerrada')
        .order('closed_at', { ascending: false })
        .limit(10)
    : sinFilas,

  // Cajas que otro dejó abiertas (RF-M6-10). fn_close_cash_session ya deja que
  // un admin o supervisor las cierre; lo que faltaba era poder verlas. Una
  // caja abierta de ayer impide que su dueño abra la de hoy, y la única salida
  // era el panel de Supabase.
    puedeVerHistorial
    ? client
        .from('v_cash_sessions_summary')
        .select('session_id, full_name, opened_at, sales_total, expected_amount, user_id, status')
        .eq('status', 'abierta')
        .neq('user_id', user.id)
        .order('opened_at')
    : sinFilas,
  ]);
  resumen = (rResumen.data as Record<string, unknown>) ?? null;
  movimientos = (rMovs.data ?? []) as typeof movimientos;

  return (
    <CajaClient
      session={session ?? null}
      resumen={resumen}
      movimientos={movimientos}
      historial={historial ?? []}
      cajasAjenas={(ajenas ?? []) as Array<{
        session_id: string; full_name: string | null; opened_at: string;
        sales_total: number | null; expected_amount: number | null;
      }>}
    />
  );
}
