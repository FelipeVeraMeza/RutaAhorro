import { esCodigoSeguimiento } from '@rutaahorro/core';
import { clienteAdmin } from '@/lib/supabase/admin';
import { DEMO_ACTIVO } from '@/lib/demo';
import { tenantTienda } from '@/lib/tienda/catalogo';
import { pedidosDemo } from '@/lib/tienda/pedidosDemo';
import { ipDe, limitar } from '@/lib/limites';

/**
 * GET /api/tienda/pedidos/estado?codigos=A,B — el estado de los pedidos de
 * "Mis pedidos" (RF-T43). Solo con el código, que no se puede adivinar; no
 * devuelve datos de contacto.
 */
export async function GET(request: Request) {
  const limite = limitar('seguimiento', ipDe(request));
  if (limite) return limite;
  const codigos = (new URL(request.url).searchParams.get('codigos') ?? '')
    .split(',').map((c) => c.trim().toUpperCase()).filter(esCodigoSeguimiento).slice(0, 20);
  const sinCache = { headers: { 'Cache-Control': 'no-store' } };
  if (!codigos.length) return Response.json({ pedidos: [] }, sinCache);

  if (DEMO_ACTIVO) {
    const pedidos = pedidosDemo().filter((p) => codigos.includes(p.codigo))
      .map((p) => ({ codigo: p.codigo, numero: p.numero, estado: p.estado, total: p.total }));
    return Response.json({ pedidos }, sinCache);
  }
  const tenant = tenantTienda();
  const admin = clienteAdmin();
  if (!tenant || !admin) return Response.json({ pedidos: [] }, sinCache);
  const { data, error } = await admin.rpc('fn_estado_pedidos_web', { p_tenant: tenant, p_codigos: codigos });
  if (error) return Response.json({ pedidos: [] }, sinCache);
  return Response.json({ pedidos: data ?? [] }, sinCache);
}
