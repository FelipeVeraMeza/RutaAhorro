import { exigirRol } from '@/lib/permisos';
import { createClient } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { ProveedoresClient } from './ProveedoresClient';

export const metadata = { title: 'Compras' };

export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  // El vendedor no participa en compras (matriz del doc 02)
  const user = await exigirRol(['admin', 'supervisor', 'bodega']);
  const { vista } = await searchParams;

  // El nombre del local encabeza el pedido que se manda al proveedor.
  let local = 'Almacén RutaAhorro';
  if (!DEMO_ACTIVO) {
    const client = await createClient();
    const { data } = await client.from('tenants').select('name').eq('id', user.tenantId).maybeSingle();
    local = data?.name ?? '';
  }

  // Anular recepción es solo del administrador (RF-M3-09). El costo estimado
  // del pedido, también: bodega y supervisor no ven costos.
  return (
    <ProveedoresClient
      puedeAnular={user.role === 'admin'}
      verCostos={user.role === 'admin'}
      local={local}
      vistaInicial={vista === 'comprar' || vista === 'recepciones' ? vista : 'proveedores'}
    />
  );
}
