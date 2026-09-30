import { createClient } from '@/lib/supabase/server';
import { exigirRol } from '@/lib/permisos';
import { cookies } from 'next/headers';
import { DEMO_ACTIVO } from '@/lib/demo';
import { DEMO_COOKIE_CAJA, leerCajaDemo } from '@/lib/demo/caja';
import { PosClient } from './PosClient';

export const metadata = { title: 'Vender' };

export default async function PosPage() {
  // Bodega no vende (matriz del doc 02). Antes entraba al POS al iniciar sesión.
  const user = await exigirRol(['admin', 'supervisor', 'vendedor']);
  const puedeForzarStock = user.role === 'admin' || user.role === 'supervisor';

  // En demo la caja parte abierta (lib/demo/caja.ts); si se cerró en
  // Caja, el POS pide abrirla, igual que en producción.
  if (DEMO_ACTIVO) {
    const caja = leerCajaDemo((await cookies()).get(DEMO_COOKIE_CAJA)?.value, user.id);
    return (
      <PosClient hasOpenSession={caja.abierta} local="Almacén RutaAhorro" cajero={user.fullName}
                 usuarioId={user.id} puedeForzarStock={puedeForzarStock} />
    );
  }

  const client = await createClient();

  // ¿Tiene caja abierta? Sin caja no se puede vender (RF-M5-16).
  // Las dos consultas no dependen una de la otra: van en paralelo.
  const [{ data: session }, { data: tenant }] = await Promise.all([client
    .from('cash_sessions')
    .select('id, opened_at, opening_amount')
    .eq('user_id', user.id)
    .eq('status', 'abierta')
    .maybeSingle(),

  // Nombre del local para encabezar el comprobante (RF-M5-14). Si la consulta
  // falla, el comprobante sale sin encabezado: no vale la pena impedir una
  // venta por un nombre.
  client
    .from('tenants')
    .select('name')
    .eq('id', user.tenantId)
    .maybeSingle()]);

  return (
    <PosClient
      hasOpenSession={Boolean(session)}
      local={tenant?.name ?? ''}
      cajero={user.fullName}
      usuarioId={user.id}
      puedeForzarStock={puedeForzarStock}
    />
  );
}
