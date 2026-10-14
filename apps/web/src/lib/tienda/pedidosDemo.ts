import type { EstadoPedidoWeb } from '@rutaahorro/core';

/**
 * Los pedidos de la maqueta (NEXT_PUBLIC_DEMO): viven en la memoria del
 * servidor, para recorrer la tienda y "Pedidos web" sin Supabase. Se pierden
 * al reiniciar, como todo en la maqueta.
 */
export interface PedidoDemo {
  id: string;
  numero: number;
  codigo: string;
  clientUuid: string;
  nombre: string;
  celular: string;
  correo: string | null;
  nota: string | null;
  estado: EstadoPedidoWeb;
  motivo: string | null;
  total: number;
  ahorro: number;
  creado: string;
  actualizado: string;
  items: Array<{ product_id: string; nombre: string; cantidad: number; precio_lista: number; precio_unitario: number; subtotal: number }>;
  historial: Array<{ estado: EstadoPedidoWeb; fecha: string }>;
}

const g = globalThis as unknown as { __pedidosDemo?: PedidoDemo[] };
export function pedidosDemo(): PedidoDemo[] {
  g.__pedidosDemo ??= [];
  return g.__pedidosDemo;
}
