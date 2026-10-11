'use client';

import type { DatosCliente, LineaCarritoTienda } from '@rutaahorro/core';
import { crearAlmacen } from './almacen';
import { vaciarCarrito } from './carrito';

/**
 * "Mi cuenta" de la tienda, sin cuenta: los datos del cliente y sus pedidos
 * quedan en SU navegador, para no escribirlos en cada pedido. No se mandan a
 * ninguna parte hasta que él envía un pedido. Cuentas de verdad (con clave,
 * pedidos en la base) llegan con el pedido en línea (docs/30, etapa 2).
 */
export const SIN_DATOS: DatosCliente = { nombre: '', celular: '', correo: '' };

const datos = crearAlmacen<DatosCliente>('tienda:cliente', SIN_DATOS, (x) => {
  const d = x as Partial<DatosCliente> | null;
  return d && typeof d.nombre === 'string' && typeof d.celular === 'string'
    ? { nombre: d.nombre, celular: d.celular, correo: typeof d.correo === 'string' ? d.correo : '' }
    : null;
});

export interface PedidoEnviado {
  fecha: string;
  lineas: LineaCarritoTienda[];
  total: number;
  /** 0040 · Pedido hecho en la tienda (no por WhatsApp): su número y código de seguimiento. */
  numero?: number;
  codigo?: string;
}

const TOPE_PEDIDOS = 20;
const SIN_PEDIDOS: PedidoEnviado[] = [];

const pedidos = crearAlmacen<PedidoEnviado[]>('tienda:pedidos', SIN_PEDIDOS, (x) =>
  Array.isArray(x)
    ? x.filter((p) => p && typeof p.fecha === 'string' && Array.isArray(p.lineas) && typeof p.total === 'number').slice(0, TOPE_PEDIDOS)
    : null);

export const useDatosCliente = datos.usar;
export const usePedidos = pedidos.usar;

export function guardarDatosCliente(d: DatosCliente) {
  datos.guardar({ nombre: d.nombre.trim(), celular: d.celular.trim(), correo: d.correo.trim() });
}

/** Anota el pedido enviado, el más nuevo primero. Un pedido con código no se anota dos veces. */
export function anotarPedido(p: PedidoEnviado) {
  const otros = p.codigo ? pedidos.leer().filter((x) => x.codigo !== p.codigo) : pedidos.leer();
  pedidos.guardar([p, ...otros].slice(0, TOPE_PEDIDOS));
}

/** Al abrir un seguimiento: si el pedido no estaba en "Mis pedidos", se agrega (sin sus líneas). */
export function recordarPedidoWeb(p: { codigo: string; numero: number; total: number; fecha: string }) {
  if (pedidos.leer().some((x) => x.codigo === p.codigo)) return;
  anotarPedido({ fecha: p.fecha, lineas: [], total: p.total, numero: p.numero, codigo: p.codigo });
}

/** Todo lo que la tienda guarda en este navegador (RNF-T24): datos, pedidos y carrito. */
export function borrarMisDatos() {
  datos.guardar(SIN_DATOS);
  pedidos.guardar(SIN_PEDIDOS);
  vaciarCarrito();
}
