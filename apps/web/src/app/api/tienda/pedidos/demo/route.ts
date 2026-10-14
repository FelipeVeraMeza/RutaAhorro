import { esEstadoPedido, puedeCambiarEstado } from '@rutaahorro/core';
import { DEMO_ACTIVO } from '@/lib/demo';
import { pedidosDemo } from '@/lib/tienda/pedidosDemo';

/**
 * Solo en la maqueta (NEXT_PUBLIC_DEMO): "Pedidos web" lee y mueve los
 * pedidos que se hicieron en la tienda de la maqueta. En producción no existe
 * (404): ahí todo pasa por la base con su RLS.
 */
export async function GET() {
  if (!DEMO_ACTIVO) return new Response(null, { status: 404 });
  return Response.json({ pedidos: pedidosDemo() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!DEMO_ACTIVO) return new Response(null, { status: 404 });
  const { id, estado, motivo } = await request.json().catch(() => ({}));
  const p = pedidosDemo().find((x) => x.id === id);
  if (!p) return Response.json({ error: { code: 'PEDIDO_NO_ENCONTRADO', message: 'No existe ese pedido' } }, { status: 404 });
  if (!esEstadoPedido(estado) || !puedeCambiarEstado(p.estado, estado)) {
    return Response.json({ error: { code: 'CAMBIO_DE_ESTADO_INVALIDO', message: 'Ese cambio de estado no se puede hacer' } }, { status: 409 });
  }
  if (estado === 'cancelado' && !String(motivo ?? '').trim()) {
    return Response.json({ error: { code: 'MOTIVO_REQUERIDO', message: 'Escribe el motivo' } }, { status: 400 });
  }
  const ahora = new Date().toISOString();
  p.estado = estado;
  p.actualizado = ahora;
  if (estado === 'cancelado') p.motivo = String(motivo).trim().slice(0, 300);
  p.historial.push({ estado, fecha: ahora });
  return Response.json({ id: p.id, estado });
}
