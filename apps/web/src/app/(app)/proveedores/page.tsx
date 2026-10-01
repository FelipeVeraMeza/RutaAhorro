import { exigirRol } from '@/lib/permisos';
import { createClient } from '@/lib/supabase/server';
import { DEMO_ACTIVO } from '@/lib/demo';
import { ProveedoresClient } from './ProveedoresClient';

export const metadata = { title: 'Compras' };

export default async function ProveedoresPage({ searchParams }: {
  searchParams: Promise<{ vista?: string; aviso?: string; detalle?: string }>;
}) {
  // El vendedor no participa en compras (matriz del doc 02)
  const user = await exigirRol(['admin', 'supervisor', 'bodega']);
  const { vista, aviso, detalle } = await searchParams;
  // Lo que pasó con la factura de la recepción recién confirmada (RF-M3-13).
  const avisoRecepcion = aviso === 'factura_por_pagar'
    ? { tipo: 'ok' as const, texto: 'Mercadería recibida. La factura quedó en Por pagar con su vencimiento.' }
    : aviso === 'factura_no_registrada'
      ? { tipo: 'error' as const, texto: `La mercadería quedó recibida, pero la factura no se registró por pagar${detalle ? `: ${detalle.slice(0, 160)}` : ''}. Regístrala en Por pagar.` }
      : null;

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
      verPorPagar={user.role === 'admin' || user.role === 'supervisor'}
      avisoInicial={avisoRecepcion}
      vistaInicial={vista === 'comprar' || vista === 'recepciones' || (vista === 'pagar' && user.role !== 'bodega') ? vista : 'proveedores'}
    />
  );
}
