'use client';

import { resumenFactura, diaLocal, type RegistroDte } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { getMeta, setMeta } from '../offline/db';
import { todasLasFilas } from './paginas';

/**
 * Facturación (0026): factura manual, notas de crédito, facturas recibidas,
 * resumen mensual y el estado del emisor real.
 *
 * En producción todo se escribe con funciones de la base (las tablas no
 * tienen política de escritura, regla 14), salvo las credenciales del SII,
 * que van a la ruta del servidor que las cifra. En la maqueta vive en el
 * navegador y no mueve stock: sirve para ver la pantalla, no para probarla.
 */

export type EstadoFactura = 'emitida' | 'por_emitir' | 'emitiendo' | 'error' | 'descartada';
export type FormaPago = 'contado' | 'credito';

export interface Receptor {
  rut: string;
  razon_social: string;
  giro: string;
  direccion: string;
  comuna: string;
  ciudad?: string | null;
  correo?: string | null;
}

export interface LineaRegistrada {
  id: string;
  linea: number;
  productId: string | null;
  nombre: string;
  descripcion: string | null;
  unidad: string | null;
  cantidad: number;
  precio: number;
  descuento: number;
  monto: number;
  devuelto: number;
  tasa: number;
}

export interface NotaCredito {
  id: string;
  numero: number;
  motivo: string;
  monto: number;
  esTotal: boolean;
  creadaEn: string;
  dte: RegistroDte | null;
}

export interface Factura {
  id: string;
  numero: number;
  modo: 'simulacion' | 'portal_sii';
  estado: EstadoFactura;
  receptor: Receptor;
  formaPago: FormaPago;
  fechaEmision: string;
  observaciones: string | null;
  neto: number;
  iva: number;
  ivaPct: number;
  impuestosAdicionales: number;
  total: number;
  folio: number | null;
  dte: RegistroDte | null;
  lineas: LineaRegistrada[];
  notasCredito: NotaCredito[];
  ultimoError: string | null;
  tienePdf: boolean;
  creadaEn: string;
}

export interface LineaNueva {
  productId?: string | null;
  nombre: string;
  descripcion?: string | null;
  cantidad: number;
  precio: number;
  descuento?: number;
}

export interface FacturaNueva {
  clientUuid: string;
  clienteId?: string | null;
  receptor: Receptor;
  formaPago: FormaPago;
  observaciones?: string | null;
  lineas: LineaNueva[];
}

export type TipoRecibida = 33 | 34 | 46 | 56 | 61;

export interface FacturaRecibida {
  id: string;
  supplierId: string | null;
  rutEmisor: string;
  razonSocial: string;
  tipo: TipoRecibida;
  folio: number;
  fechaEmision: string;
  neto: number;
  exento: number;
  iva: number;
  otrosImpuestos: number;
  total: number;
  notas: string | null;
  estado: 'vigente' | 'anulada';
  anuladaMotivo: string | null;
}

export type RecibidaNueva = Omit<FacturaRecibida, 'id' | 'estado' | 'anuladaMotivo' | 'total'> & {
  /** La recepción de la que viene: anularla la saca del libro (0034). */
  receiptId?: string | null;
};

export interface ResumenMes {
  mes: string;           // 'AAAA-MM-01'
  ventas: { neto: number; iva: number; adicionales: number; total: number;
            boletas: number; facturas: number; notas: number; voucher: number; simulados: boolean };
  compras: { neto: number; iva: number; otros: number; total: number; documentos: number };
}

export interface EstadoEmisionSii {
  activa: boolean;
  encendida: boolean;
  credenciales: boolean;
  rutUsuario: string | null;
  rutEmpresa: string | null;
  actualizadoEn: string | null;
  enCola: number;
  conError: number;
  /** 0028: los datos del emisor en Configuración (salen impresos). */
  emisor: boolean;
  /** Un ensayo exitoso con las credenciales guardadas hoy: sin él no se enciende. */
  ensayoVigente: boolean;
  ultimoEnsayo: { en: string; ok: boolean; totalPortal: number | null; razonSocialSii: string | null; error: string | null } | null;
}

export interface RepositorioFacturacion {
  /** Las del mes ('AAAA-MM'), las más nuevas primero. */
  emitidas(mes: string): Promise<Factura[]>;
  obtener(id: string): Promise<Factura | null>;
  emitir(f: FacturaNueva): Promise<Factura>;
  /** Líneas y cantidades a devolver; null = todo lo que queda. */
  notaCredito(id: string, items: Array<{ lineaId: string; cantidad: number }> | null, motivo: string): Promise<void>;
  reintentar(id: string): Promise<void>;
  descartar(id: string, motivo: string): Promise<void>;
  recibidas(mes: string): Promise<FacturaRecibida[]>;
  registrarRecibida(d: RecibidaNueva): Promise<FacturaRecibida>;
  anularRecibida(id: string, motivo: string): Promise<void>;
  /** Los últimos `meses` meses con ventas o compras, el más nuevo primero. */
  resumen(meses: number): Promise<ResumenMes[]>;
  estadoSii(): Promise<EstadoEmisionSii>;
  activarSii(activa: boolean): Promise<EstadoEmisionSii>;
  guardarCredenciales(d: { rut_usuario: string; clave_sii: string; clave_certificado: string; rut_empresa: string }): Promise<void>;
  borrarCredenciales(): Promise<void>;
}

/** 'AAAA-MM' → ['AAAA-MM-01', primer día del mes siguiente]. */
export function rangoMes(mes: string): [string, string] {
  const [a, m] = mes.split('-').map(Number);
  const sig = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return [`${mes}-01`, `${sig}-01`];
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------
type Fila = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

const aDte = (d: Fila | null | undefined): RegistroDte | null => (d ? (d as unknown as RegistroDte) : null);

function aFactura(f: Fila): Factura {
  const lineas = ((f.factura_lineas ?? f.lineas ?? []) as Fila[]).map((l) => ({
    id: l.id as string, linea: n(l.linea), productId: (l.product_id as string) ?? null,
    nombre: l.nombre as string, descripcion: (l.descripcion as string) ?? null, unidad: (l.unidad as string) ?? null,
    cantidad: n(l.cantidad), precio: n(l.precio), descuento: n(l.descuento), monto: n(l.monto),
    devuelto: n(l.devuelto), tasa: n(l.tasa),
  })).sort((a, b) => a.linea - b.linea);
  const notas = ((f.factura_notas_credito ?? f.notas_credito ?? []) as Fila[]).map((x) => ({
    id: x.id as string, numero: n(x.numero), motivo: x.motivo as string, monto: n(x.monto),
    esTotal: Boolean(x.es_total), creadaEn: x.created_at as string, dte: aDte(x.dte as Fila),
  })).sort((a, b) => a.numero - b.numero);
  return {
    id: f.id as string, numero: n(f.numero), modo: f.modo as Factura['modo'], estado: f.estado as EstadoFactura,
    receptor: f.receptor as Receptor, formaPago: f.forma_pago as FormaPago, fechaEmision: f.fecha_emision as string,
    observaciones: (f.observaciones as string) ?? null, neto: n(f.neto), iva: n(f.iva), ivaPct: n(f.iva_pct),
    impuestosAdicionales: n(f.impuestos_adicionales), total: n(f.total),
    folio: f.folio == null ? null : n(f.folio), dte: aDte(f.dte as Fila), lineas, notasCredito: notas,
    ultimoError: (f.ultimo_error as string) ?? null, tienePdf: Boolean(f.pdf_path), creadaEn: f.created_at as string,
  };
}

const COLS_DTE = 'id, tipo, folio, ambiente, estado, fecha_emision, emitido_en, emisor, receptor, detalle, neto, exento, iva, iva_pct, impuestos_adicionales, impuestos_detalle, total, referencia';
const SELECT_FACTURA = `*, factura_lineas(*), dte:dte_documentos!facturas_dte_id_fkey(${COLS_DTE}), `
  + `factura_notas_credito(id, numero, motivo, monto, es_total, created_at, dte:dte_documentos!factura_notas_credito_dte_id_fkey(${COLS_DTE}))`;

function aRecibida(r: Fila): FacturaRecibida {
  return {
    id: r.id as string, supplierId: (r.supplier_id as string) ?? null, rutEmisor: r.rut_emisor as string,
    razonSocial: r.razon_social as string, tipo: n(r.tipo) as TipoRecibida, folio: n(r.folio),
    fechaEmision: r.fecha_emision as string, neto: n(r.neto), exento: n(r.exento), iva: n(r.iva),
    otrosImpuestos: n(r.otros_impuestos), total: n(r.total), notas: (r.notas as string) ?? null,
    estado: r.estado as FacturaRecibida['estado'], anuladaMotivo: (r.anulada_motivo as string) ?? null,
  };
}

function aEstado(e: Fila): EstadoEmisionSii {
  return {
    activa: Boolean(e.activa), encendida: Boolean(e.encendida), credenciales: Boolean(e.credenciales),
    rutUsuario: (e.rut_usuario as string) ?? null, rutEmpresa: (e.rut_empresa as string) ?? null,
    actualizadoEn: (e.actualizado_en as string) ?? null, enCola: n(e.en_cola), conError: n(e.con_error),
    emisor: Boolean(e.emisor), ensayoVigente: Boolean(e.ensayo_vigente),
    ultimoEnsayo: e.ultimo_ensayo ? (() => {
      const u = e.ultimo_ensayo as { en: string; ok: boolean; detalle?: Record<string, unknown> };
      return { en: u.en, ok: Boolean(u.ok), totalPortal: u.detalle?.total_portal != null ? Number(u.detalle.total_portal) : null,
        razonSocialSii: (u.detalle?.razon_social_sii as string) ?? null, error: (u.detalle?.error as string) ?? null };
    })() : null,
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

async function rutaServidor(metodo: 'POST' | 'DELETE', cuerpo?: unknown) {
  const r = await fetch('/api/facturacion/credenciales', {
    method: metodo, headers: { 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message ?? 'No se pudo guardar');
  }
}

const supabaseRepo: RepositorioFacturacion = {
  async emitidas(mes) {
    const [desde, hasta] = rangoMes(mes);
    // Por páginas (la API corta en 1.000 sin avisar): el libro del mes salía
    // incompleto y el CSV para el contador también.
    const data = await todasLasFilas<unknown>((d, h) => supabase().from('facturas').select(SELECT_FACTURA)
      .gte('fecha_emision', desde).lt('fecha_emision', hasta)
      .order('numero', { ascending: false }).order('id').range(d, h));
    return data.map((f) => aFactura(f as Fila));
  },
  async obtener(id) {
    const { data, error } = await supabase().from('facturas').select(SELECT_FACTURA).eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? aFactura(data as Fila) : null;
  },
  async emitir(f) {
    const r = await rpc<Fila>('fn_emitir_factura_manual', { p_datos: {
      client_uuid: f.clientUuid, cliente_id: f.clienteId ?? null, receptor: f.receptor, forma_pago: f.formaPago,
      observaciones: f.observaciones ?? null,
      lineas: f.lineas.map((l) => ({ product_id: l.productId ?? null, nombre: l.nombre, descripcion: l.descripcion ?? null,
        cantidad: l.cantidad, precio: l.precio, descuento: l.descuento ?? 0 })),
    } });
    return aFactura(r);
  },
  async notaCredito(id, items, motivo) {
    await rpc('fn_nota_credito_factura', { p_factura: id, p_motivo: motivo,
      p_items: items ? items.map((i) => ({ linea_id: i.lineaId, cantidad: i.cantidad })) : null });
  },
  async reintentar(id) { await rpc('fn_reintentar_factura', { p_factura: id }); },
  async descartar(id, motivo) { await rpc('fn_descartar_factura', { p_factura: id, p_motivo: motivo }); },
  async recibidas(mes) {
    const [desde, hasta] = rangoMes(mes);
    const data = await todasLasFilas<unknown>((d, h) => supabase().from('facturas_recibidas').select('*')
      .gte('fecha_emision', desde).lt('fecha_emision', hasta)
      .order('fecha_emision', { ascending: false }).order('id').range(d, h));
    return data.map((r) => aRecibida(r as Fila));
  },
  async registrarRecibida(d) {
    return aRecibida(await rpc<Fila>('fn_registrar_factura_recibida', { p_datos: {
      supplier_id: d.supplierId, rut_emisor: d.rutEmisor, razon_social: d.razonSocial, tipo: d.tipo, folio: d.folio,
      fecha_emision: d.fechaEmision, neto: d.neto, exento: d.exento, iva: d.iva, otros_impuestos: d.otrosImpuestos,
      notas: d.notas, receipt_id: d.receiptId ?? null,
    } }));
  },
  async anularRecibida(id, motivo) { await rpc('fn_anular_factura_recibida', { p_id: id, p_motivo: motivo }); },
  async resumen(meses) {
    const [{ data: v, error: e1 }, { data: c, error: e2 }] = await Promise.all([
      supabase().from('v_ventas_mensuales').select('*').order('mes', { ascending: false }).limit(meses),
      supabase().from('v_compras_mensuales').select('*').order('mes', { ascending: false }).limit(meses),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const porMes = new Map<string, ResumenMes>();
    const vacio = (mes: string): ResumenMes => ({
      mes, ventas: { neto: 0, iva: 0, adicionales: 0, total: 0, boletas: 0, facturas: 0, notas: 0, voucher: 0, simulados: false },
      compras: { neto: 0, iva: 0, otros: 0, total: 0, documentos: 0 },
    });
    for (const r of (v ?? []) as Fila[]) {
      const m = porMes.get(r.mes as string) ?? vacio(r.mes as string);
      m.ventas = { neto: n(r.neto), iva: n(r.iva), adicionales: n(r.impuestos_adicionales), total: n(r.total),
        boletas: n(r.boletas), facturas: n(r.facturas), notas: n(r.notas_credito), voucher: n(r.ventas_voucher),
        simulados: Boolean(r.incluye_simulados) };
      porMes.set(m.mes, m);
    }
    for (const r of (c ?? []) as Fila[]) {
      const m = porMes.get(r.mes as string) ?? vacio(r.mes as string);
      m.compras = { neto: n(r.neto), iva: n(r.iva), otros: n(r.otros_impuestos), total: n(r.total), documentos: n(r.documentos) };
      porMes.set(m.mes, m);
    }
    return [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes)).slice(0, meses);
  },
  async estadoSii() { return aEstado(await rpc<Fila>('fn_estado_emision_sii', {})); },
  async activarSii(activa) { return aEstado(await rpc<Fila>('fn_activar_emision_sii', { p_activa: activa })); },
  guardarCredenciales: (d) => rutaServidor('POST', d),
  borrarCredenciales: () => rutaServidor('DELETE'),
};

// ---------------------------------------------------------------------------
// Maqueta: en el navegador, sin stock ni SII
// ---------------------------------------------------------------------------
const CLAVE_DEMO = 'demo:facturacion';
interface Demo { facturas: Factura[]; recibidas: FacturaRecibida[] }
async function leerDemo(): Promise<Demo> {
  const crudo = await getMeta(CLAVE_DEMO);
  return crudo ? JSON.parse(crudo) : { facturas: [], recibidas: [] };
}
const guardarDemo = (d: Demo) => setMeta(CLAVE_DEMO, JSON.stringify(d));

/** Maqueta de 0034: anular una recepción saca su factura del libro de compras. */
export async function anularRecibidaPorRecepcionDemo(receiptId: string, motivo: string): Promise<void> {
  const d = await leerDemo();
  await guardarDemo({ ...d, recibidas: d.recibidas.map((r) => ((r as RecibidaNueva).receiptId === receiptId && r.estado === 'vigente'
    ? { ...r, estado: 'anulada', anuladaMotivo: `Recepción anulada: ${motivo}` } : r)) });
}
const mesDe = (fecha: string) => fecha.slice(0, 7);
// El día del local (regla 17), no el del celular.
const hoy = async () => diaLocal(new Date(), (await (await import('./configuracion')).configuracionLocal()).zonaHoraria);

const demoRepo: RepositorioFacturacion = {
  async emitidas(mes) { return (await leerDemo()).facturas.filter((f) => mesDe(f.fechaEmision) === mes); },
  async obtener(id) { return (await leerDemo()).facturas.find((f) => f.id === id) ?? null; },
  async emitir(f) {
    const d = await leerDemo();
    const previa = d.facturas.find((x) => x.id === f.clientUuid);
    if (previa) return previa;
    const r = resumenFactura(f.lineas.map((l) => ({ ...l, productId: l.productId ?? null })));
    if (r.errores.length) throw new Error(r.errores[0]);
    const numero = d.facturas.length + 1;
    const factura: Factura = {
      id: f.clientUuid, numero, modo: 'simulacion', estado: 'emitida', receptor: f.receptor, formaPago: f.formaPago,
      fechaEmision: await hoy(), observaciones: f.observaciones ?? null, neto: r.neto, iva: r.iva, ivaPct: 19,
      impuestosAdicionales: r.totalAdicionales, total: r.total, folio: numero, dte: null,
      lineas: f.lineas.map((l, i) => ({ id: `${f.clientUuid}-${i}`, linea: i + 1, productId: l.productId ?? null, nombre: l.nombre,
        descripcion: l.descripcion ?? null, unidad: null, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento ?? 0,
        monto: Math.round(l.cantidad * l.precio) - (l.descuento ?? 0), devuelto: 0, tasa: 0 })),
      notasCredito: [], ultimoError: null, tienePdf: false, creadaEn: new Date().toISOString(),
    };
    await guardarDemo({ ...d, facturas: [factura, ...d.facturas] });
    return factura;
  },
  async notaCredito() { throw new Error('Las notas de crédito necesitan la base real'); },
  async reintentar() { /* en la maqueta no hay cola */ },
  async descartar() { /* en la maqueta no hay cola */ },
  async recibidas(mes) { return (await leerDemo()).recibidas.filter((r) => mesDe(r.fechaEmision) === mes); },
  async registrarRecibida(x) {
    const d = await leerDemo();
    // Las mismas reglas que fn_registrar_factura_recibida (regla de la
    // maqueta: no enseñar algo que la base rechaza). Antes la misma factura
    // se podía registrar dos veces y con fecha de mañana.
    const rut = (v: string) => v.replace(/[^0-9kK]/g, '').toUpperCase();
    if (d.recibidas.some((r) => r.estado === 'vigente' && rut(r.rutEmisor) === rut(x.rutEmisor)
        && r.tipo === x.tipo && Number(r.folio) === Number(x.folio))) {
      throw new Error('FACTURA_RECIBIDA_DUPLICADA');
    }
    if (x.fechaEmision > await hoy()) throw new Error('FECHA_INVALIDA');
    const r: FacturaRecibida = { ...x, id: crypto.randomUUID(), total: x.neto + x.exento + x.iva + x.otrosImpuestos,
      estado: 'vigente', anuladaMotivo: null };
    await guardarDemo({ ...d, recibidas: [r, ...d.recibidas] });
    return r;
  },
  async anularRecibida(id, motivo) {
    const d = await leerDemo();
    await guardarDemo({ ...d, recibidas: d.recibidas.map((r) => (r.id === id ? { ...r, estado: 'anulada', anuladaMotivo: motivo } : r)) });
  },
  async resumen() { return []; },
  async estadoSii() {
    return { activa: false, encendida: false, credenciales: false, rutUsuario: null, rutEmpresa: null, actualizadoEn: null, enCola: 0, conError: 0,
      emisor: false, ensayoVigente: false, ultimoEnsayo: null };
  },
  async activarSii() { throw new Error('La emisión real necesita la base real'); },
  async guardarCredenciales() { throw new Error('La emisión real necesita la base real'); },
  async borrarCredenciales() { /* nada que borrar */ },
};

export function repoFacturacion(): RepositorioFacturacion {
  return DEMO_ACTIVO ? demoRepo : supabaseRepo;
}
