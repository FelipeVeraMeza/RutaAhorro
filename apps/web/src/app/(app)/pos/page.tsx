import { getCurrentUser, createClient } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { PosClient } from './PosClient';

export const metadata = { title: 'Vender' };

export default async function PosPage() {
  // En demo la caja esta siempre abierta: el objetivo es ver el POS, no
  // tropezar con el requisito de abrir caja en cada recarga.
  if (DEMO_ACTIVO) {
    return <PosClient hasOpenSession local="Almacén RutaAhorro" cajero="Demo" />;
  }

  const user = await getCurrentUser();
  const client = await createClient();

  // ¿Tiene caja abierta? Sin caja no se puede vender (RF-M5-16).
  const { data: session } = await client
    .from('cash_sessions')
    .select('id, opened_at, opening_amount')
    .eq('user_id', user!.id)
    .eq('status', 'abierta')
    .maybeSingle();

  // Nombre del local para encabezar el comprobante (RF-M5-14). Si la consulta
  // falla, el comprobante sale sin encabezado: no vale la pena impedir una
  // venta por un nombre.
  const { data: tenant } = await client
    .from('tenants')
    .select('name')
    .eq('id', user!.tenantId)
    .maybeSingle();

  return (
    <PosClient
      hasOpenSession={Boolean(session)}
      local={tenant?.name ?? ''}
      cajero={user!.fullName}
    />
  );
}
