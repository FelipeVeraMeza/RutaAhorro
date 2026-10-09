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
}

const TOPE_PEDIDOS = 20;
const SIN_PEDIDOS: PedidoEnviado[] = [];

const pedidos = crearAlmacen<PedidoEnviado[]>('tienda:pedidos', SIN_PEDIDOS, (x) =>
  Array.isArray(x) ? x.filter((p) => p && typeof p.fecha === 'string' && Array.isArray(p.lineas)) : null);

export const useDatosCliente = datos.usar;
export const usePedidos = pedidos.usar;

export function guardarDatosCliente(d: DatosCliente) {
  datos.guardar({ nombre: d.nombre.trim(), celular: d.celular.trim(), correo: d.correo.trim() });
}

/** Anota el pedido enviado por WhatsApp, el más nuevo primero. */
export function anotarPedido(p: PedidoEnviado) {
  pedidos.guardar([p, ...pedidos.leer()].slice(0, TOPE_PEDIDOS));
}

/** Todo lo que la tienda guarda en este navegador (RNF-T24): datos, pedidos y carrito. */
export function borrarMisDatos() {
  datos.guardar(SIN_DATOS);
  pedidos.guardar(SIN_PEDIDOS);
  vaciarCarrito();
}
