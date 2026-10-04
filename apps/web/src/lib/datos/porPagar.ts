'use client';

import { diaLocal, diasEntre } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { todas } from './paginar';
import { DEMO_ACTIVO } from '../demo';
// La maqueta (IndexedDB, la caja de demo, los proveedores de ejemplo) se
// carga solo en demo: este módulo lo usa el Inicio y no debe sumarle peso
// (RNF-62).
const meta = () => import('../offline/db');

/**
 * Cuentas por pagar a proveedores (RF-M3-13, 0030).
 *
 * Cada factura de proveedor con su vencimiento y su estado. Se escribe solo
 * con funciones (`fn_registrar_factura_proveedor`, `fn_pagar_factura_proveedor`,
 * `fn_anular_factura_proveedor`); la leen admin y supervisor.
 */
export type MetodoPagoProveedor = 'transferencia' | 'efectivo_caja' | 'cheque' | 'otro';

export const NOMBRE_METODO_PROVEEDOR: Record<MetodoPagoProveedor, string> = {
  transferencia: 'Transferencia',
  efectivo_caja: 'Efectivo de la caja',
  cheque: 'Cheque',
  otro: 'Otro',
};

export interface FacturaProveedor {
  id: string;
  proveedorId: string;
  proveedor: string;
  numero: string;
  emitida: string | null;
  /** AAAA-MM-DD */
  vence: string;
  monto: number;
  nota: string | null;
  pagadaEn: string | null;
  metodo: MetodoPagoProveedor | null;
  anulada: boolean;
  /** La recepción de la que viene (solo la maqueta lo guarda aquí). */
  receiptId?: string | null;
}

export interface NuevaFactura {
  proveedorId?: string;
  receiptId?: string;
  numero?: string;
  monto?: number;
  emitida?: string;
  vence: string;
  nota?: string;
}

/** Cuántos días faltan para que venza (negativo: vencida), contando días del local. */
export const diasParaVencer = (vence: string, hoy: string) => diasEntre(hoy, vence);

// ---------------------------------------------------------------------------
const base = {
  async listar(): Promise<FacturaProveedor[]> {
    // Por páginas: con el historial de pagadas, pasadas las 1.000 facturas la
    // API cortaba las de vencimiento más lejano, justo las pendientes, y el
    // Inicio dejaba de avisarlas.
    const data = await todas((a, b) => supabase().from('facturas_proveedor')
      .select('id, supplier_id, numero, emitida, vence, monto, nota, pagada_en, pago_metodo, anulada_en, suppliers(name)')
      .order('vence').order('id').range(a, b));
    return data.map((r) => ({
      id: r.id as string,
      proveedorId: r.supplier_id as string,
      proveedor: (r.suppliers as unknown as { name: string } | null)?.name ?? '—',
      numero: r.numero as string,
      emitida: (r.emitida as string) ?? null,
      vence: r.vence as string,
      monto: Number(r.monto),
      nota: (r.nota as string) ?? null,
      pagadaEn: (r.pagada_en as string) ?? null,
      metodo: (r.pago_metodo as MetodoPagoProveedor) ?? null,
      anulada: r.anulada_en != null,
    }));
  },
  async registrar(f: NuevaFactura): Promise<string> {
    const { data, error } = await supabase().rpc('fn_registrar_factura_proveedor', {
      p_datos: {
        supplier_id: f.proveedorId ?? null, receipt_id: f.receiptId ?? null, numero: f.numero ?? null,
        monto: f.monto ?? null, emitida: f.emitida ?? null, vence: f.vence, nota: f.nota ?? null,
      },
    });
    if (error) throw error;
    return data as string;
  },
  async pagar(id: string, metodo: MetodoPagoProveedor): Promise<void> {
    const { error } = await supabase().rpc('fn_pagar_factura_proveedor', { p_id: id, p_metodo: metodo, p_nota: null });
    if (error) throw error;
  },
  async anular(id: string, motivo: string): Promise<void> {
    const { error } = await supabase().rpc('fn_anular_factura_proveedor', { p_id: id, p_motivo: motivo });
    if (error) throw error;
  },
};

// --------------------------------------------------------------- maqueta
const CLAVE = 'demo:por-pagar';
const leer = async (): Promise<FacturaProveedor[]> => JSON.parse((await (await meta()).getMeta(CLAVE)) ?? '[]');
const guardar = async (l: FacturaProveedor[]) => (await meta()).setMeta(CLAVE, JSON.stringify(l));

// Las mismas reglas que las funciones de 0030: la maqueta no enseña algo que
// la base rechazaría.
const demo: typeof base = {
  listar: async () => (await leer()).sort((a, b) => a.vence.localeCompare(b.vence)),
  async registrar(f) {
    const lista = await leer();
    // La recepción pasa sus datos explícitos (proveedor, número y total).
    const { proveedorId, numero, monto } = f;
    if (!proveedorId) throw new Error('PROVEEDOR_REQUERIDO');
    if (!numero?.trim()) throw new Error('NUMERO_FACTURA_REQUERIDO');
    if (!monto || monto <= 0) throw new Error('MONTO_INVALIDO');
    if (!f.vence) throw new Error('VENCIMIENTO_FACTURA_REQUERIDO');
    if (f.emitida && f.vence < f.emitida) throw new Error('VENCE_ANTES_DE_EMITIDA');
    if (lista.some((x) => !x.anulada && x.proveedorId === proveedorId && x.numero.trim().toUpperCase() === numero!.trim().toUpperCase())) {
      throw new Error('FACTURA_PROVEEDOR_DUPLICADA');
    }
    const { repoProveedores } = await import('./proveedores');
    const provs = await repoProveedores().listar(true);
    const id = crypto.randomUUID();
    lista.push({
      id, proveedorId, proveedor: provs.find((p) => p.id === proveedorId)?.nombre ?? 'Proveedor',
      numero: numero!.trim(), emitida: f.emitida ?? null, vence: f.vence, monto, nota: f.nota?.trim() || null,
      pagadaEn: null, metodo: null, anulada: false, receiptId: f.receiptId ?? null,
    });
    await guardar(lista);
    return id;
  },
  async pagar(id, metodo) {
    const lista = await leer();
    const f = lista.find((x) => x.id === id);
    if (!f) throw new Error('FACTURA_NO_ENCONTRADA');
    if (f.anulada) throw new Error('FACTURA_ANULADA');
    if (f.pagadaEn) throw new Error('FACTURA_YA_PAGADA');
    if (metodo === 'efectivo_caja') {
      const { cajaDemo, usuarioDemoActual } = await import('../demo/caja');
      const r = await cajaDemo.movimiento(usuarioDemoActual(), 'egreso', f.monto, `Pago factura N° ${f.numero} · ${f.proveedor}`);
      if (r.error) throw new Error(r.error.message);
    }
    f.pagadaEn = new Date().toISOString(); f.metodo = metodo;
    await guardar(lista);
  },
  async anular(id, motivo) {
    if (!motivo.trim()) throw new Error('MOTIVO_REQUERIDO');
    const lista = await leer();
    const f = lista.find((x) => x.id === id);
    if (!f) throw new Error('FACTURA_NO_ENCONTRADA');
    if (f.pagadaEn) throw new Error('FACTURA_YA_PAGADA');
    f.anulada = true;
    await guardar(lista);
  },
};

/**
 * En la maqueta, anular una recepción anula su factura si no está pagada
 * (como fn_void_receipt en 0031). Devuelve true si ya estaba pagada.
 */
export async function anularPorRecepcionDemo(receiptId: string, motivo: string): Promise<boolean> {
  const lista = await leer();
  const propias = lista.filter((x) => x.receiptId === receiptId && !x.anulada);
  for (const f of propias) if (!f.pagadaEn) { f.anulada = true; f.nota = `Recepción anulada: ${motivo.trim()}`; }
  await guardar(lista);
  return propias.some((f) => f.pagadaEn);
}

const repo = () => (DEMO_ACTIVO ? demo : base);
export const facturasProveedor = () => repo().listar();
export const registrarFacturaProveedor = (f: NuevaFactura) => repo().registrar(f);
export const pagarFacturaProveedor = (id: string, metodo: MetodoPagoProveedor) => repo().pagar(id, metodo);
export const anularFacturaProveedor = (id: string, motivo: string) => repo().anular(id, motivo);

/**
 * Lo pendiente que vence dentro de `dias` días (o ya venció), para el aviso
 * de Inicio. Ordenado por vencimiento.
 */
export async function porVencer(zona: string, dias = 7): Promise<Array<FacturaProveedor & { dias: number }>> {
  const hoy = diaLocal(new Date(), zona);
  return (await facturasProveedor())
    .filter((f) => !f.pagadaEn && !f.anulada)
    .map((f) => ({ ...f, dias: diasParaVencer(f.vence, hoy) }))
    .filter((f) => f.dias <= dias);
}
