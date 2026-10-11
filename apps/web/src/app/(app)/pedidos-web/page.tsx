import { exigirRol } from '@/lib/permisos';
import { createClient } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { PedidosWebClient } from './PedidosWebClient';

export const metadata = { title: 'Pedidos web' };

/**
 * RF-T49 · Los pedidos de la tienda online (docs/33). Los ven y los mueven
 * los que atienden: admin, supervisor y vendedor (los mismos de la RLS de
 * 0040). Bodega no: traen el celular del cliente.
 */
export default async function PedidosWebPage() {
  await exigirRol(['admin', 'supervisor', 'vendedor']);
  let local = 'el local';
  let direccion: string | null = null;
  if (!DEMO_ACTIVO) {
    const sb = await createClient();
    const [{ data: t }, { data: s }] = await Promise.all([
      sb.from('tenants').select('name').maybeSingle(),
      sb.from('stores').select('address').eq('is_active', true).order('created_at').limit(1).maybeSingle(),
    ]);
    local = t?.name || local;
    direccion = s?.address ?? null;
  } else {
    local = 'Almacén de ejemplo';
    direccion = 'Av. Siempre Viva 742, Santiago';
  }
  return <PedidosWebClient local={local} direccion={direccion} />;
}
