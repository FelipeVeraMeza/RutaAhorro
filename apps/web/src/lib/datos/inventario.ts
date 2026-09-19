'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db } from '../offline/db';
import { syncCatalog } from '../offline/catalog';
import { DEMO_LOTES } from '../demo/data';

/**
 * Movimientos de inventario: ajustes, mermas y kardex (módulo M4).
 *
 * El kardex es inmutable (ADR-006): corregir nunca significa editar un
 * movimiento, sino agregar uno compensatorio. Por eso aquí no existe ninguna
 * función de editar ni borrar movimientos — y no es un olvido.
 */

export type TipoMovimiento =
  | 'inventario_inicial' | 'venta' | 'anulacion_venta' | 'recepcion'
  | 'anulacion_recepcion' | 'ajuste_positivo' | 'ajuste_negativo'
  | 'merma' | 'toma_inventario' | 'traslado';

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  inventario_inicial: 'Inventario inicial',
  venta: 'Venta',
  anulacion_venta: 'Anulación de venta',
  recepcion: 'Recepción',
  anulacion_recepcion: 'Anulación de recepción',
  ajuste_positivo: 'Ajuste (suma)',
  ajuste_negativo: 'Ajuste (resta)',
  merma: 'Merma',
  toma_inventario: 'Toma de inventario',
  traslado: 'Traspaso',
};

/** Motivos frecuentes: escribirlos a mano cada vez genera datos inconsistentes. */
export const MOTIVOS_SUGERIDOS = [
  'Producto vencido',
  'Producto dañado',
  'Robo o pérdida',
  'Error de digitación',
  'Diferencia de conteo',
  'Consumo interno',
  'Devolución a proveedor',
];

export interface Movimiento {
  id: string;
  fecha: string;
  productoId: string;
  productoNombre: string;
  tipo: TipoMovimiento;
  cantidad: number;
  saldo: number;
  motivo: string | null;
  usuario: string | null;
}

/**
 * Un lote de un producto perecible.
 *
 * `estado` viene calculado desde la base (`v_expiring_lots`) y no en el
 * navegador: el umbral depende de `expiry_alert_days` de cada producto, que la
 * pantalla no tiene. Calcularlo acá habría significado inventar un número fijo
 * para todos los productos, y el pan y el queso no se avisan con los mismos
 * días.
 */
export interface Lote {
  id: string;
  productoId: string;
  productoNombre: string;
  codigo: string | null;
  unidad: string;
  vence: string;
  diasParaVencer: number;
  cantidad: number;
  costoUnitario: number;
  valorEnRiesgo: number;
  estado: 'vencido' | 'por_vencer' | 'vigente';
}

export const ETIQUETA_ESTADO_LOTE: Record<Lote['estado'], string> = {
  vencido: 'Vencido',
  por_vencer: 'Por vencer',
  vigente: 'Vigente',
};

export type Ubicacion = 'sala' | 'bodega';
export const ETIQUETA_UBICACION: Record<Ubicacion, string> = { sala: 'Sala de ventas', bodega: 'Bodega' };

export interface RepositorioInventario {
  kardex(productoId: string | null, limite?: number): Promise<Movimiento[]>;
  /** Lotes con existencia, del que vence antes al que vence después (FEFO). */
  lotes(): Promise<Lote[]>;
  /**
   * Da de baja un lote completo como merma, con motivo obligatorio.
   *
   * No borra el lote: descuenta su cantidad por el kardex y lo desactiva. Un
   * producto que se botó por vencido es un hecho del negocio y tiene que poder
   * explicarse después (ADR-006).
   */
  darDeBajaLote(loteId: string, motivo: string): Promise<void>;
  ajustar(datos: {
    productoId: string;
    nuevaCantidad: number;
    tipo: 'ajuste_positivo' | 'ajuste_negativo' | 'merma';
    motivo: string;
    /** La cantidad real es la de ESTA ubicación, no la del total del local. */
    ubicacion: Ubicacion;
  }): Promise<void>;
  /** Traspaso entre bodega y sala (0014). No cambia el total ni el costo. */
  reponer(datos: { productoId: string; cantidad: number; desde: Ubicacion; hacia: Ubicacion; motivo?: string }): Promise<void>;
  aplicarToma(items: Array<{ productoId: string; contado: number }>, ubicacion: Ubicacion): Promise<{
    diferencias: number;
    valorDiferencia: number;
  }>;
}

const KEY = 'demo:movimientos';

async function leerMovs(): Promise<Movimiento[]> {
  const raw = await db().meta.get(KEY);
  return raw?.value ? (JSON.parse(raw.value) as Movimiento[]) : [];
}

async function registrarMov(m: Omit<Movimiento, 'id' | 'fecha'>) {
  const movs = await leerMovs();
  movs.unshift({ ...m, id: `mv${Date.now()}${Math.random().toString(16).slice(2, 6)}`, fecha: new Date().toISOString() });
  await db().meta.put({ key: KEY, value: JSON.stringify(movs.slice(0, 500)) });
}

const KEY_LOTES_BAJA = 'demo:lotes-dados-de-baja';

async function lotesDadosDeBaja(): Promise<string[]> {
  const raw = await db().meta.get(KEY_LOTES_BAJA);
  return raw?.value ? (JSON.parse(raw.value) as string[]) : [];
}

const repoLocal: RepositorioInventario = {
  async kardex(productoId, limite = 100) {
    const movs = await leerMovs();
    return (productoId ? movs.filter((m) => m.productoId === productoId) : movs).slice(0, limite);
  },

  async lotes() {
    const dados = await lotesDadosDeBaja();
    return DEMO_LOTES
      .filter((l) => !dados.includes(l.lot_id))
      .map((l) => ({
        id: l.lot_id,
        productoId: l.product_id,
        productoNombre: l.product_name,
        codigo: l.lot_code,
        unidad: l.unit,
        vence: l.expiry_date,
        diasParaVencer: l.days_to_expiry,
        cantidad: l.quantity,
        costoUnitario: l.unit_cost,
        valorEnRiesgo: l.value_at_risk,
        estado: l.expiry_status,
      }))
      .sort((a, b) => a.vence.localeCompare(b.vence));
  },

  async darDeBajaLote(loteId, motivo) {
    if (motivo.trim() === '') throw new Error('MOTIVO_REQUERIDO');
    const lote = DEMO_LOTES.find((l) => l.lot_id === loteId);
    if (!lote) throw new Error('NO_ENCONTRADO');
    if ((await lotesDadosDeBaja()).includes(loteId)) return;

    const p = await db().products.get(lote.product_id);
    const saldo = p ? Math.max(0, p.stock - lote.quantity) : 0;
    if (p) await db().products.put({ ...p, stock: saldo, updatedAt: new Date().toISOString() });

    await registrarMov({
      productoId: lote.product_id, productoNombre: lote.product_name,
      tipo: 'merma', cantidad: -lote.quantity, saldo,
      motivo, usuario: 'Modo demo',
    });
    await db().meta.put({
      key: KEY_LOTES_BAJA,
      value: JSON.stringify([...(await lotesDadosDeBaja()), loteId]),
    });
  },

  async ajustar({ productoId, nuevaCantidad, tipo, motivo }) {
    if (motivo.trim() === '') throw new Error('MOTIVO_REQUERIDO');
    const p = await db().products.get(productoId);
    if (!p) throw new Error('PRODUCTO_NO_ENCONTRADO');

    const delta = nuevaCantidad - p.stock;
    if (delta === 0) return;

    await db().products.put({ ...p, stock: nuevaCantidad, updatedAt: new Date().toISOString() });
    await registrarMov({
      productoId, productoNombre: p.name, tipo,
      cantidad: delta, saldo: nuevaCantidad,
      motivo, usuario: 'Modo demo',
    });
  },

  async reponer() {
    // La maqueta no distingue ubicaciones.
    throw new Error('NO_DISPONIBLE_EN_DEMO');
  },

  async aplicarToma(items) {
    const costos = JSON.parse((await db().meta.get('demo:costos'))?.value ?? '{}') as Record<string, number>;
    let diferencias = 0;
    let valorDiferencia = 0;

    for (const it of items) {
      const p = await db().products.get(it.productoId);
      if (!p) continue;
      const delta = it.contado - p.stock;
      if (delta === 0) continue;

      diferencias++;
      valorDiferencia += Math.round(delta * (costos[it.productoId] ?? 0));

      await db().products.put({ ...p, stock: it.contado, updatedAt: new Date().toISOString() });
      await registrarMov({
        productoId: it.productoId, productoNombre: p.name,
        tipo: 'toma_inventario', cantidad: delta, saldo: it.contado,
        motivo: 'Toma de inventario', usuario: 'Modo demo',
      });
    }
    return { diferencias, valorDiferencia };
  },
};

const repoSupabase: RepositorioInventario = {
  async lotes() {
    // v_expiring_lots trae los tres estados, no solo los que vencen: el nombre
    // engaña un poco. El `estado` lo calcula la vista con el
    // `expiry_alert_days` de cada producto.
    const { data, error } = await supabase()
      .from('v_expiring_lots')
      .select('lot_id, product_id, product_name, lot_code, expiry_date, quantity, unit_cost, value_at_risk, days_to_expiry, expiry_status, unit')
      .order('expiry_date', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((l) => ({
      id: l.lot_id as string,
      productoId: l.product_id as string,
      productoNombre: (l.product_name as string) ?? 'Producto',
      codigo: (l.lot_code as string | null) ?? null,
      unidad: (l.unit as string) ?? 'unidad',
      vence: l.expiry_date as string,
      diasParaVencer: Number(l.days_to_expiry ?? 0),
      cantidad: Number(l.quantity ?? 0),
      costoUnitario: Number(l.unit_cost ?? 0),
      valorEnRiesgo: Number(l.value_at_risk ?? 0),
      estado: l.expiry_status as Lote['estado'],
    }));
  },

  async darDeBajaLote(loteId, motivo) {
    const { error } = await supabase().rpc('fn_write_off_lot', {
      p_lot_id: loteId,
      p_reason: motivo,
    });
    if (error) throw error;
  },

  async kardex(productoId, limite = 100) {
    let q = supabase()
      .from('inventory_movements')
      .select('id, created_at, product_id, movement_type, quantity, balance_after, reason, products(name), profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(limite);
    if (productoId) q = q.eq('product_id', productoId);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((m) => ({
      id: m.id as string,
      fecha: m.created_at as string,
      productoId: m.product_id as string,
      productoNombre: (m.products as unknown as { name: string } | null)?.name ?? 'Producto',
      tipo: m.movement_type as TipoMovimiento,
      cantidad: Number(m.quantity ?? 0),
      saldo: Number(m.balance_after ?? 0),
      motivo: m.reason as string | null,
      usuario: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? null,
    }));
  },

  async ajustar({ productoId, nuevaCantidad, tipo, motivo, ubicacion }) {
    const { error } = await supabase().rpc('fn_adjust_stock', {
      p_product_id: productoId,
      p_new_quantity: nuevaCantidad,
      p_movement_type: tipo,
      p_reason: motivo,
      p_ubicacion: ubicacion,
    });
    if (error) throw error;
  },

  async reponer({ productoId, cantidad, desde, hacia, motivo }) {
    const { error } = await supabase().rpc('fn_transfer_stock', {
      p_product_id: productoId, p_cantidad: cantidad,
      p_desde: desde, p_hacia: hacia, p_reason: motivo ?? null,
    });
    if (error) throw error;
  },

  async aplicarToma(items, ubicacion) {
    const client = supabase();
    const { data: { user } } = await client.auth.getUser();
    const { data: perfil } = await client.from('profiles').select('tenant_id, store_id').eq('id', user!.id).single();

    const { data: conteo, error: e1 } = await client
      .from('stock_counts')
      .insert({ tenant_id: perfil!.tenant_id, store_id: perfil!.store_id })
      .select('id').single();
    if (e1) throw e1;

    const { data, error } = await client.rpc('fn_apply_stock_count', {
      p_count_id: conteo.id,
      p_items: items.map((i) => ({ product_id: i.productoId, counted_qty: i.contado })),
      p_ubicacion: ubicacion,
    });
    if (error) throw error;

    const r = data as { differences: unknown[]; difference_value: number };
    return { diferencias: (r.differences ?? []).length, valorDiferencia: r.difference_value ?? 0 };
  },
};

/**
 * Lo que mueve stock. Después de cada una se sincroniza el catálogo del
 * navegador: el POS mostraba el stock de antes de reponer (Sala 0 cuando ya
 * había 5) hasta la sincronización periódica.
 */
const MUEVEN_STOCK = new Set(['ajustar', 'reponer', 'aplicarToma', 'darDeBajaLote']);

const repoSupabaseSincronizado = new Proxy(repoSupabase, {
  get(objetivo, clave, receptor) {
    const valor = Reflect.get(objetivo, clave, receptor);
    if (typeof valor !== 'function' || !MUEVEN_STOCK.has(String(clave))) return valor;
    return async (...args: unknown[]) => {
      const r = await (valor as (...a: unknown[]) => Promise<unknown>).apply(objetivo, args);
      void syncCatalog().catch(() => {});
      return r;
    };
  },
});

export function repoInventario(): RepositorioInventario {
  return DEMO_ACTIVO ? repoLocal : repoSupabaseSincronizado;
}
