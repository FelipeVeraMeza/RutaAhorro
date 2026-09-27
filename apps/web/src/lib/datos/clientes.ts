'use client';

import type { ClienteConPrecios } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { getMeta, setMeta } from '../offline/db';

/**
 * Clientes y precio por cliente (0022, RQ-07, RQ-20, RQ-21).
 *
 * En producción se escriben con `fn_guardar_cliente` y
 * `fn_guardar_precios_cliente` (las tablas no tienen política de escritura,
 * regla 14). Para vender, la lista viaja al celular junto con el catálogo
 * (`syncClientes`), así el POS elige al cliente sin conexión.
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
  descuentoPct: number;
  notas: string | null;
  activo: boolean;
  /** Precio especial de cada unidad, por id de producto. */
  precios: Record<string, number>;
}

export type DatosCliente = Omit<Cliente, 'id' | 'precios'>;

export interface RepositorioClientes {
  listar(): Promise<Cliente[]>;
  /** Crea (sin id) o cambia un cliente. Devuelve su id. */
  guardar(id: string | null, datos: DatosCliente): Promise<string>;
  /** Reemplaza los precios especiales del cliente. */
  guardarPrecios(id: string, precios: Record<string, number>): Promise<void>;
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
  const [{ data, error }, { data: precios, error: e2 }] = await Promise.all([
    q, supabase().from('cliente_precios').select('cliente_id, product_id, precio'),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  const porCliente = new Map<string, Record<string, number>>();
  for (const p of precios ?? []) {
    const m = porCliente.get(p.cliente_id as string) ?? {};
    m[p.product_id as string] = Number(p.precio);
    porCliente.set(p.cliente_id as string, m);
  }
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
    precios: porCliente.get(r.id as string) ?? {},
  }));
}

const paraVender = (c: Cliente): ClienteConPrecios => ({
  id: c.id, nombre: c.nombre, rut: c.rut, giro: c.giro, direccion: c.direccion,
  descuentoPct: c.descuentoPct, precios: c.precios,
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
  async guardarPrecios(id, precios) {
    const { error } = await supabase().rpc('fn_guardar_precios_cliente', {
      p_cliente_id: id,
      p_precios: Object.entries(precios).map(([product_id, precio]) => ({ product_id, precio })),
    });
    if (error) throw error;
    void syncClientes().catch(() => {});
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
    const previo = lista.find((c) => c.id === id);
    const fila: Cliente = { ...datos, id: nuevoId, precios: previo?.precios ?? {} };
    await setMeta(CLAVE_DEMO, JSON.stringify(id ? lista.map((c) => (c.id === id ? fila : c)) : [...lista, fila]));
    return nuevoId;
  },
  async guardarPrecios(id, precios) {
    const lista = await demoLista();
    await setMeta(CLAVE_DEMO, JSON.stringify(lista.map((c) => (c.id === id ? { ...c, precios } : c))));
  },
};

export function repoClientes(): RepositorioClientes {
  return DEMO_ACTIVO ? demoRepo : supabaseRepo;
}
