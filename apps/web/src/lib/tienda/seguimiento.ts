import { esCodigoSeguimiento, type EstadoPedidoWeb } from '@rutaahorro/core';
import { clienteAdmin } from '@/lib/supabase/admin';
import { DEMO_ACTIVO } from '@/lib/demo';
import { tenantTienda } from './catalogo';
import { pedidosDemo } from './pedidosDemo';

/** Lo que muestra el seguimiento de un pedido: sin celular ni correo. */
export interface Seguimiento {
  numero: number;
  codigo: string;
  estado: EstadoPedidoWeb;
  total: number;
  ahorro: number;
  nota: string | null;
  motivo: string | null;
  nombre: string;
  creado: string;
  actualizado: string;
  items: Array<{ product_id: string | null; nombre: string; cantidad: number; precio_lista: number; precio_unitario: number; subtotal: number }>;
  historial: Array<{ estado: EstadoPedidoWeb; fecha: string }>;
}

/** El pedido con ese código, del local de la tienda. Null si no existe o el código no es válido. */
export async function seguimientoPedido(codigo: string): Promise<Seguimiento | null> {
  const c = codigo.trim().toUpperCase();
  if (!esCodigoSeguimiento(c)) return null;
  if (DEMO_ACTIVO) {
    const p = pedidosDemo().find((x) => x.codigo === c);
    return p ? {
      numero: p.numero, codigo: p.codigo, estado: p.estado, total: p.total, ahorro: p.ahorro, nota: p.nota, motivo: p.motivo,
      nombre: p.nombre.split(' ')[0], creado: p.creado, actualizado: p.actualizado, items: p.items, historial: p.historial,
    } : null;
  }
  const tenant = tenantTienda();
  const admin = clienteAdmin();
  if (!tenant || !admin) return null;
  const { data, error } = await admin.rpc('fn_seguimiento_pedido_web', { p_tenant: tenant, p_codigo: c });
  if (error) {
    if (error.code !== 'PGRST202' && error.code !== '42883') console.error('[seguimiento] error', error.code);
    return null;
  }
  return (data as Seguimiento | null) ?? null;
}
