'use client';

import { weightedAverageCost } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db, normalizeSearch } from '../offline/db';

/**
 * Proveedores y recepción de mercadería (módulo M3).
 *
 * La recepción es la única puerta por la que entra stock comprado, y es la que
 * recalcula el costo promedio ponderado. Por eso en producción no escribe
 * tablas directamente: llama a `fn_confirm_receipt`, que hace todo dentro de
 * una transacción. Si algo falla a mitad, no queda stock sumado sin recepción
 * registrada.
 */

export interface Proveedor {
  id: string;
  nombre: string;
  rut: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
}

export interface LineaRecepcion {
  productId: string;
  nombre: string;
  cantidad: number;
  costoUnitario: number;
  costoAnterior: number;
  perecible: boolean;
  lote?: string;
  vencimiento?: string;
}

export interface Recepcion {
  id: string;
  proveedorNombre: string | null;
  documento: string | null;
  tipoDocumento: string;
  fecha: string;
  total: number;
  estado: 'confirmada' | 'anulada';
  lineas: number;
}

export interface RepositorioProveedores {
  listar(incluirInactivos?: boolean): Promise<Proveedor[]>;
  crear(p: Omit<Proveedor, 'id' | 'activo'>): Promise<{ id: string }>;
  actualizar(id: string, p: Omit<Proveedor, 'id' | 'activo'>): Promise<void>;
  desactivar(id: string): Promise<void>;
  recepciones(limite?: number): Promise<Recepcion[]>;
  confirmarRecepcion(datos: {
    proveedorId: string | null;
    tipoDocumento: string;
    documento: string | null;
    lineas: LineaRecepcion[];
  }): Promise<{ id: string; total: number }>;
  anularRecepcion(id: string, motivo: string): Promise<void>;
}

// --------------------------------------------------------------- demo local
const KEY_PROV = 'demo:proveedores';
const KEY_REC = 'demo:recepciones';

const SEMILLA: Proveedor[] = [
  { id: 'pr1', nombre: 'Distribuidora Sur Ltda.', rut: '76.543.210-K', contacto: 'Ana Muñoz', telefono: '+56 9 8765 4321', email: 'ventas@dsur.cl', activo: true },
  { id: 'pr2', nombre: 'Lácteos del Valle', rut: '77.111.222-3', contacto: 'Pedro Lagos', telefono: '+56 9 5555 1234', email: 'pedidos@lacteosvalle.cl', activo: true },
  { id: 'pr3', nombre: 'Comercial Aseo SpA', rut: '78.999.888-7', contacto: null, telefono: '+56 2 2345 6789', email: null, activo: true },
];

async function leerJson<T>(key: string, semilla: T): Promise<T> {
  const raw = await db().meta.get(key);
  if (raw?.value) return JSON.parse(raw.value) as T;
  await db().meta.put({ key, value: JSON.stringify(semilla) });
  return semilla;
}

async function guardarJson(key: string, valor: unknown) {
  await db().meta.put({ key, value: JSON.stringify(valor) });
}

const repoLocal: RepositorioProveedores = {
  async listar(incluirInactivos = false) {
    const ps = await leerJson<Proveedor[]>(KEY_PROV, SEMILLA);
    return ps.filter((p) => incluirInactivos || p.activo)
             .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  },

  async crear(p) {
    const ps = await leerJson<Proveedor[]>(KEY_PROV, SEMILLA);
    const id = `pr${Date.now()}`;
    ps.push({ ...p, id, activo: true });
    await guardarJson(KEY_PROV, ps);
    return { id };
  },

  async actualizar(id, datos) {
    const ps = await leerJson<Proveedor[]>(KEY_PROV, SEMILLA);
    const i = ps.findIndex((x) => x.id === id);
    if (i === -1) throw new Error('NO_ENCONTRADO');
    ps[i] = { ...ps[i], ...datos };
    await guardarJson(KEY_PROV, ps);
  },

  async desactivar(id) {
    const ps = await leerJson<Proveedor[]>(KEY_PROV, SEMILLA);
    const p = ps.find((x) => x.id === id);
    if (!p) throw new Error('NO_ENCONTRADO');
    p.activo = false;
    await guardarJson(KEY_PROV, ps);
  },

  async recepciones(limite = 30) {
    const rs = await leerJson<Recepcion[]>(KEY_REC, []);
    return rs.slice(0, limite);
  },

  async confirmarRecepcion({ proveedorId, tipoDocumento, documento, lineas }) {
    const proveedores = await leerJson<Proveedor[]>(KEY_PROV, SEMILLA);
    const total = lineas.reduce((s, l) => s + Math.round(l.cantidad * l.costoUnitario), 0);
    const id = `rc${Date.now()}`;

    // Sube el stock y recalcula el costo promedio, igual que fn_confirm_receipt
    const costos = JSON.parse((await db().meta.get('demo:costos'))?.value ?? '{}') as Record<string, number>;

    for (const l of lineas) {
      const prod = await db().products.get(l.productId);
      if (!prod) continue;

      const nuevoCosto = weightedAverageCost({
        currentStock: prod.stock,
        currentAvgCost: costos[l.productId] ?? 0,
        incomingQty: l.cantidad,
        incomingUnitCost: l.costoUnitario,
      });
      costos[l.productId] = nuevoCosto;

      await db().products.put({
        ...prod,
        stock: prod.stock + l.cantidad,
        updatedAt: new Date().toISOString(),
      });
    }
    await db().meta.put({ key: 'demo:costos', value: JSON.stringify(costos) });

    const rs = await leerJson<Recepcion[]>(KEY_REC, []);
    rs.unshift({
      id,
      proveedorNombre: proveedores.find((p) => p.id === proveedorId)?.nombre ?? null,
      documento, tipoDocumento,
      fecha: new Date().toISOString(),
      total, estado: 'confirmada', lineas: lineas.length,
    });
    await guardarJson(KEY_REC, rs);

    return { id, total };
  },

  async anularRecepcion(id) {
    const rs = await leerJson<Recepcion[]>(KEY_REC, []);
    const r = rs.find((x) => x.id === id);
    if (!r) throw new Error('NO_ENCONTRADO');
    if (r.estado === 'anulada') throw new Error('RECEPCION_YA_ANULADA');
    r.estado = 'anulada';
    await guardarJson(KEY_REC, rs);
  },
};

// ---------------------------------------------------------------- supabase
const repoSupabase: RepositorioProveedores = {
  async listar(incluirInactivos = false) {
    let q = supabase().from('suppliers').select('id, name, rut, contact_name, phone, email, is_active');
    if (!incluirInactivos) q = q.eq('is_active', true);
    const { data, error } = await q.order('name');
    if (error) throw error;
    return (data ?? []).map((s) => ({
      id: s.id as string,
      nombre: s.name as string,
      rut: s.rut as string | null,
      contacto: s.contact_name as string | null,
      telefono: s.phone as string | null,
      email: s.email as string | null,
      activo: Boolean(s.is_active),
    }));
  },

  async crear(p) {
    const client = supabase();
    const { data: { user } } = await client.auth.getUser();
    const { data: perfil } = await client.from('profiles').select('tenant_id').eq('id', user!.id).single();

    const { data, error } = await client
      .from('suppliers')
      .insert({
        tenant_id: perfil!.tenant_id,
        name: p.nombre, rut: p.rut, contact_name: p.contacto,
        phone: p.telefono, email: p.email,
      })
      .select('id').single();
    if (error) throw error;
    return { id: data.id as string };
  },

  async actualizar(id, p) {
    const { error } = await supabase().from('suppliers').update({
      name: p.nombre, rut: p.rut, contact_name: p.contacto,
      phone: p.telefono, email: p.email,
    }).eq('id', id);
    if (error) throw error;
  },

  async desactivar(id) {
    const { error } = await supabase().from('suppliers').update({ is_active: false }).eq('id', id);
    if (error) throw error;
  },

  async recepciones(limite = 30) {
    const { data, error } = await supabase()
      .from('purchase_receipts')
      .select('id, document_type, document_number, received_at, total_amount, status, suppliers(name), purchase_receipt_items(id)')
      .order('received_at', { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string,
      proveedorNombre: (r.suppliers as unknown as { name: string } | null)?.name ?? null,
      documento: r.document_number as string | null,
      tipoDocumento: r.document_type as string,
      fecha: r.received_at as string,
      total: Number(r.total_amount ?? 0),
      estado: r.status as 'confirmada' | 'anulada',
      lineas: (r.purchase_receipt_items as unknown as unknown[] ?? []).length,
    }));
  },

  async confirmarRecepcion({ proveedorId, tipoDocumento, documento, lineas }) {
    // Transaccional en la base: stock, kardex y costo promedio, o nada.
    const { data, error } = await supabase().rpc('fn_confirm_receipt', {
      p_supplier_id: proveedorId,
      p_document_type: tipoDocumento,
      p_document_number: documento,
      p_received_at: new Date().toISOString(),
      p_items: lineas.map((l) => ({
        product_id: l.productId,
        quantity: l.cantidad,
        unit_cost: l.costoUnitario,
        ...(l.lote ? { lot_code: l.lote } : {}),
        ...(l.vencimiento ? { expiry_date: l.vencimiento } : {}),
      })),
    });
    if (error) throw error;
    const r = data as { receipt_id: string; total_amount: number };
    return { id: r.receipt_id, total: r.total_amount };
  },

  async anularRecepcion(id, motivo) {
    const { error } = await supabase().rpc('fn_void_receipt', {
      p_receipt_id: id, p_reason: motivo,
    });
    if (error) throw error;
  },
};

export function repoProveedores(): RepositorioProveedores {
  return DEMO_ACTIVO ? repoLocal : repoSupabase;
}

/** Búsqueda de productos para la recepción (usa el catálogo local). */
export async function buscarParaRecepcion(termino: string) {
  const q = normalizeSearch(termino);
  if (q.length < 2) return [];
  const todos = await db().products.toArray();
  const costos = JSON.parse((await db().meta.get('demo:costos'))?.value ?? '{}') as Record<string, number>;
  return todos
    .filter((p) => p.isActive && (p.nameSearch.includes(q) || (p.sku && normalizeSearch(p.sku).includes(q))))
    .slice(0, 12)
    .map((p) => ({
      productId: p.id,
      nombre: p.name,
      perecible: p.tracksExpiry,
      costoAnterior: costos[p.id] ?? 0,
      stock: p.stock,
    }));
}
