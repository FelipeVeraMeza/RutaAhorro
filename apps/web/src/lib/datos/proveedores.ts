'use client';

import { weightedAverageCost } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db } from '../offline/db';
import { syncCatalog } from '../offline/catalog';
import { repoProductos } from '../productos';

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
  /**
   * Stock actual del producto. Se necesita para calcular el costo promedio
   * ponderado que se le muestra al usuario: sin el stock, el promedio no se
   * puede ponderar y el numero mostrado seria simplemente el costo entrante.
   */
  stock: number;
  perecible: boolean;
  /** Para validar la cantidad: entera si se cuenta por unidad. */
  unidad?: string;
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
  /** Solo la maqueta: lo recibido y el costo de antes, para poder anularla. */
  detalle?: Array<{ productId: string; cantidad: number; costo: number; costoAntes: number }>;
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
  /** Devuelve si su factura por pagar ya estaba pagada (y por eso no se anuló). */
  anularRecepcion(id: string, motivo: string): Promise<{ facturaYaPagada: boolean }>;
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

    const detalle: NonNullable<Recepcion['detalle']> = [];
    for (const l of lineas) {
      const prod = await db().products.get(l.productId);
      if (!prod) continue;
      detalle.push({ productId: l.productId, cantidad: l.cantidad, costo: l.costoUnitario, costoAntes: costos[l.productId] ?? 0 });

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
      total, estado: 'confirmada', lineas: lineas.length, detalle,
    });
    await guardarJson(KEY_REC, rs);

    return { id, total };
  },

  // Como fn_void_receipt (0031): saca el stock, devuelve el costo promedio y
  // anula la factura por pagar si no se pagó.
  async anularRecepcion(id, motivo) {
    const rs = await leerJson<Recepcion[]>(KEY_REC, []);
    const r = rs.find((x) => x.id === id);
    if (!r) throw new Error('NO_ENCONTRADO');
    if (r.estado === 'anulada') throw new Error('RECEPCION_YA_ANULADA');
    const costos = JSON.parse((await db().meta.get('demo:costos'))?.value ?? '{}') as Record<string, number>;
    for (const l of r.detalle ?? []) {
      const prod = await db().products.get(l.productId);
      if (!prod) continue;
      if (prod.stock < l.cantidad) throw new Error('STOCK_INSUFICIENTE');
    }
    for (const l of r.detalle ?? []) {
      const prod = await db().products.get(l.productId);
      if (!prod) continue;
      const queda = prod.stock - l.cantidad;
      const actual = costos[l.productId] ?? 0;
      const resto = actual * prod.stock - l.cantidad * l.costo;
      costos[l.productId] = queda > 0 && resto >= 0 ? Math.round(resto / queda) : l.costoAntes;
      await db().products.put({ ...prod, stock: queda, updatedAt: new Date().toISOString() });
    }
    await db().meta.put({ key: 'demo:costos', value: JSON.stringify(costos) });
    r.estado = 'anulada';
    await guardarJson(KEY_REC, rs);
    const { anularPorRecepcionDemo } = await import('./porPagar');
    const { anularRecibidaPorRecepcionDemo } = await import('./facturacion');
    await anularRecibidaPorRecepcionDemo(id, motivo);
    return { facturaYaPagada: await anularPorRecepcionDemo(id, motivo) };
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
    if (!user) throw new Error('NO_AUTENTICADO');
    const { data: perfil, error: e0 } = await client.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
    if (e0) throw e0;
    if (!perfil) throw new Error('NO_AUTENTICADO');

    const { data, error } = await client
      .from('suppliers')
      .insert({
        tenant_id: perfil.tenant_id,
        name: p.nombre, rut: p.rut, contact_name: p.contacto,
        phone: p.telefono, email: p.email,
      })
      .select('id').single();
    if (error) throw error;
    return { id: data.id as string };
  },

  // Con `select`: la política deja editar solo al administrador, y para
  // supervisor y bodega el update no daba error, no tocaba ninguna fila, y
  // la pantalla decía "guardado" con los datos de antes.
  async actualizar(id, p) {
    const { data, error } = await supabase().from('suppliers').update({
      name: p.nombre, rut: p.rut, contact_name: p.contacto,
      phone: p.telefono, email: p.email,
    }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('SIN_PERMISO');
  },

  async desactivar(id) {
    const { data, error } = await supabase().from('suppliers').update({ is_active: false }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('SIN_PERMISO');
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
      // Sin p_received_at: la base pone su hora. Con la del celular, un
      // reloj adelantado dejaba la recepción (y su factura en el libro de
      // compras) con fecha de mañana.
      p_items: lineas.map((l) => ({
        product_id: l.productId,
        quantity: l.cantidad,
        unit_cost: l.costoUnitario,
        ...(l.lote ? { lot_code: l.lote } : {}),
        ...(l.vencimiento ? { expiry_date: l.vencimiento } : {}),
      })),
    });
    if (error) throw error;
    // Lo recibido tiene que aparecer en el POS ahora, no en 10 minutos.
    void syncCatalog().catch(() => {});
    const r = data as { receipt_id: string; total_amount: number };
    return { id: r.receipt_id, total: r.total_amount };
  },

  async anularRecepcion(id, motivo) {
    const { data, error } = await supabase().rpc('fn_void_receipt', {
      p_receipt_id: id, p_reason: motivo,
    });
    if (error) throw error;
    void syncCatalog().catch(() => {});
    // Antes de 0031 la respuesta no traía la marca: se toma como "no pagada".
    return { facturaYaPagada: (data as { factura_ya_pagada?: boolean } | null)?.factura_ya_pagada === true };
  },
};

export function repoProveedores(): RepositorioProveedores {
  return DEMO_ACTIVO ? repoLocal : repoSupabase;
}

/**
 * Búsqueda de productos para la recepción.
 *
 * Delega en el repositorio de productos en vez de leer IndexedDB directamente.
 * La versión anterior sacaba el costo de la clave `demo:costos`, que solo
 * escribe el repositorio local: en producción devolvía 0 para todo, y con
 * costo anterior 0 el aviso de variación de costo (RF-M3-08) no se disparaba
 * nunca. Pasando por el repositorio, cada modo entrega su costo real.
 */
export async function buscarParaRecepcion(termino: string) {
  if (termino.trim().length < 2) return [];
  const encontrados = await repoProductos().listar(
    { busqueda: termino, soloActivos: true },
    true,
  );
  return encontrados.slice(0, 12).map(paraRecepcion);
}

/**
 * Datos de un producto llegado por escáner.
 *
 * El lector solo entrega el código; el costo anterior y el stock hay que
 * buscarlos igual que en la búsqueda por nombre. Sin esto, una línea agregada
 * escaneando parte con costo 0 y se puede confirmar una recepción que deja el
 * costo promedio del producto en cero.
 */
export async function productoParaRecepcion(
  productId: string,
  _nombre?: string,
): Promise<ReturnType<typeof paraRecepcion> | null> {
  // Por id y no buscando el nombre: con un nombre común ("Pan") la búsqueda
  // trae muchos, y el escaneado podía quedar fuera.
  const p = await repoProductos().obtener(productId, true);
  return p && p.activo ? paraRecepcion(p) : null;
}

function paraRecepcion(p: {
  id: string; nombre: string; perecible: boolean;
  costoPromedio?: number; stock: number; unidad?: string;
}) {
  return {
    productId: p.id,
    nombre: p.nombre,
    unidad: p.unidad ?? 'unidad',
    perecible: p.perecible,
    costoAnterior: p.costoPromedio ?? 0,
    stock: p.stock,
  };
}

/**
 * El proveedor de la última recepción confirmada de cada producto (RF-M3-12),
 * para armar el pedido sugerido por proveedor. `product_suppliers` existe
 * desde 0001 pero ninguna función lo llena; la recepción sí sabe de quién vino.
 */
export async function ultimoProveedorPorProducto(): Promise<Map<string, { id: string; nombre: string }>> {
  const mapa = new Map<string, { id: string; nombre: string }>();
  if (DEMO_ACTIVO) {
    // La maqueta no guarda qué productos trajo cada recepción: se reparte por
    // rubro entre los tres proveedores de ejemplo, para poder probar el pedido.
    const { DEMO_PRODUCTOS } = await import('../demo/data');
    const ps = await leerJson<Proveedor[]>(KEY_PROV, SEMILLA);
    const de = (id: string) => ps.find((x) => x.id === id && x.activo);
    for (const p of DEMO_PRODUCTOS) {
      const prov = de(p.categoria === 'Lácteos' ? 'pr2' : p.categoria === 'Limpieza' ? 'pr3' : 'pr1');
      if (prov) mapa.set(p.id, { id: prov.id, nombre: prov.nombre });
    }
    return mapa;
  }
  // Por páginas: la API entrega 1.000 filas como máximo, y sin orden esas
  // 1.000 eran cualquiera. Con más líneas recibidas que eso, el "último
  // proveedor" de un producto salía de una recepción vieja, o no salía.
  const data: Array<Record<string, unknown>> = [];
  for (let desde = 0; desde < 50_000; desde += 1000) {
    const { data: pagina, error } = await supabase().from('purchase_receipt_items')
      .select('product_id, recepcion:purchase_receipts!inner(received_at, status, supplier_id, proveedor:suppliers(name))')
      .eq('recepcion.status', 'confirmada')
      .order('id')
      .range(desde, desde + 999);
    if (error) throw error;
    data.push(...(pagina ?? []));
    if ((pagina ?? []).length < 1000) break;
  }
  const filas = data.map((f) => {
    const r = f.recepcion as unknown as { received_at: string; supplier_id: string | null; proveedor: { name: string } | null };
    return { productId: f.product_id as string, fecha: r.received_at, id: r.supplier_id, nombre: r.proveedor?.name ?? null };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const f of filas) {
    if (!mapa.has(f.productId) && f.id && f.nombre) mapa.set(f.productId, { id: f.id, nombre: f.nombre });
  }
  return mapa;
}
