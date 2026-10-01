'use client';

import type { ClienteConPrecios } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { getMeta, setMeta } from '../offline/db';

/**
 * Clientes (0022, RQ-20, RQ-21): para la factura y el fiado.
 *
 * En producción se escriben con `fn_guardar_cliente` (la tabla no tiene
 * política de escritura, regla 14). Para vender, la lista viaja al celular
 * junto con el catálogo (`syncClientes`), así el POS elige al cliente sin
 * conexión. Desde 0032 un cliente no tiene precio propio: lo que tuviera
 * guardado (% y precios especiales) no se lee ni viaja al POS.
 */
export interface Cliente {
  id: string;
  rut: string | null;
  nombre: string;
  giro: string | null;
  direccion: string | null;
  comuna: string | null;
  telefono: string | null;
  email: string | null;
  /** Sin efecto desde 0032; al guardar se escribe 0. */
  descuentoPct: number;
  notas: string | null;
  activo: boolean;
}

export type DatosCliente = Omit<Cliente, 'id'>;

export interface RepositorioClientes {
  listar(): Promise<Cliente[]>;
  /** Crea (sin id) o cambia un cliente. Devuelve su id. */
  guardar(id: string | null, datos: DatosCliente): Promise<string>;
}

const CLAVE_VENDER = 'catalog:clientes';
const CLAVE_DEMO = 'demo:clientes';

const aDatos = (d: DatosCliente) => ({
  rut: d.rut, nombre: d.nombre, giro: d.giro, direccion: d.direccion, comuna: d.comuna,
  telefono: d.telefono, email: d.email, descuento_pct: d.descuentoPct, notas: d.notas, activo: d.activo,
});

async function leerDeBase(soloActivos: boolean): Promise<Cliente[]> {
  let q = supabase().from('clientes')
    .select('id, rut, nombre, giro, direccion, comuna, telefono, email, descuento_pct, notas, is_active')
    .order('nombre');
  if (soloActivos) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    rut: (r.rut as string) ?? null,
    nombre: r.nombre as string,
    giro: (r.giro as string) ?? null,
    direccion: (r.direccion as string) ?? null,
    comuna: (r.comuna as string) ?? null,
    telefono: (r.telefono as string) ?? null,
    email: (r.email as string) ?? null,
    descuentoPct: Number(r.descuento_pct ?? 0),
    notas: (r.notas as string) ?? null,
    activo: Boolean(r.is_active),
  }));
}

const paraVender = (c: Cliente): ClienteConPrecios => ({
  id: c.id, nombre: c.nombre, rut: c.rut, giro: c.giro, direccion: c.direccion,
  // 0032 · El POS no aplica precio por cliente: no viaja.
  descuentoPct: 0, precios: {},
});

/** Baja al celular los clientes activos, para elegirlos en el POS sin conexión. */
export async function syncClientes(): Promise<void> {
  const lista = await leerDeBase(true);
  await setMeta(CLAVE_VENDER, JSON.stringify(lista.map(paraVender)));
}

/** Los clientes que el POS puede elegir, desde el celular. */
export async function clientesParaVender(): Promise<ClienteConPrecios[]> {
  if (DEMO_ACTIVO) {
    return (await demoLista()).filter((c) => c.activo).map(paraVender);
  }
  const crudo = await getMeta(CLAVE_VENDER);
  return crudo ? JSON.parse(crudo) : [];
}

const supabaseRepo: RepositorioClientes = {
  listar: () => leerDeBase(false),
  async guardar(id, datos) {
    const { data, error } = await supabase().rpc('fn_guardar_cliente', { p_id: id, p_datos: aDatos(datos) });
    if (error) throw error;
    void syncClientes().catch(() => {});
    return data as string;
  },
};

// ---------------------------------------------------------------------------
// Maqueta: la lista vive en `meta` del navegador
// ---------------------------------------------------------------------------
async function demoLista(): Promise<Cliente[]> {
  const crudo = await getMeta(CLAVE_DEMO);
  return crudo ? JSON.parse(crudo) : [];
}

const soloDigitos = (rut: string | null) => rut?.replace(/[^0-9kK]/g, '').toUpperCase() || null;

const demoRepo: RepositorioClientes = {
  listar: demoLista,
  async guardar(id, datos) {
    const lista = await demoLista();
    const rut = soloDigitos(datos.rut);
    if (rut && lista.some((c) => c.id !== id && soloDigitos(c.rut) === rut)) {
      throw new Error('CLIENTE_RUT_DUPLICADO');
    }
    const nuevoId = id ?? crypto.randomUUID();
    const fila: Cliente = { ...datos, id: nuevoId };
    await setMeta(CLAVE_DEMO, JSON.stringify(id ? lista.map((c) => (c.id === id ? fila : c)) : [...lista, fila]));
    return nuevoId;
  },
};

export function repoClientes(): RepositorioClientes {
  return DEMO_ACTIVO ? demoRepo : supabaseRepo;
}
