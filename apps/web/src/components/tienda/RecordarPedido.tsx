'use client';

import { useEffect } from 'react';
import { recordarPedidoWeb } from '@/lib/tienda/cliente';

/**
 * Anota el pedido en "Mis pedidos" de este navegador al abrir su seguimiento,
 * por si se hizo en otra pestaña o llegó por un enlace (RF-T43).
 */
export function RecordarPedido(p: { codigo: string; numero: number; total: number; fecha: string }) {
  useEffect(() => { recordarPedidoWeb(p); }, [p.codigo]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
