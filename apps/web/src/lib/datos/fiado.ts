'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
// IndexedDB y la caja de demo solo hacen falta en la maqueta (RNF-62).
const getMeta = async (k: string) => (await import('../offline/db')).getMeta(k);
const setMeta = async (k: string, v: string) => (await import('../offline/db')).setMeta(k, v);

/**
 * Venta fiada y cuenta corriente del cliente (RF-M5-30, 0029).
 *
 * La cuenta es una lista inmutable de movimientos: cargo por cada venta
 * fiada, abono cuando paga, y la anulación o devolución de una venta fiada
 * rebaja la deuda. El saldo es la suma. Se escribe solo con funciones
 * (`fn_register_sale`, `fn_abonar_cuenta`, `fn_tope_credito`): la tabla no
 * tiene política de escritura (regla 14).
 *
 * Lo fiado NO entra al efectivo esperado de la caja; un abono en efectivo
 * sí, en la caja de quien lo recibe.
 */
export type TipoMovimiento = 'cargo' | 'abono' | 'anulacion' | 'devolucion';
export type MetodoAbono = 'efectivo' | 'transferencia' | 'debito' | 'credito';

export interface CuentaCliente {
  clienteId: string;
  nombre: string;
  /** Hasta cuánto se le fía. 0 = no se le fía. */
  tope: number;
  /** Lo que debe hoy. */
  saldo: number;
  /** Lo que todavía se le puede fiar. */
  disponible: number;
  ultimoAbono: string | null;
}

export interface MovimientoCuenta {
  id: string;
  tipo: TipoMovimiento;
  monto: number;
  fecha: string;
  metodo: MetodoAbono | null;
  nota: string | null;
  folio: number | null;
}

export const NOMBRE_MOVIMIENTO: Record<TipoMovimiento, string> = {
  cargo: 'Compra fiada',
  abono: 'Abono',
  anulacion: 'Venta anulada',
  devolucion: 'Devolución',
};

/** Lo que cada movimiento le hace a la deuda: el cargo la sube, el resto la baja. */
export const signoMovimiento = (t: TipoMovimiento) => (t === 'cargo' ? 1 : -1);

const cuenta = (clienteId: string, nombre: string, tope: number, saldo: number, ultimoAbono: string | null): CuentaCliente => ({
  clienteId, nombre, tope, saldo, disponible: Math.max(tope - saldo, 0), ultimoAbono,
});

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------
const base = {
  async cuentas(): Promise<CuentaCliente[]> {
    const { data, error } = await supabase().from('v_cuenta_clientes')
      .select('cliente_id, nombre, credito_tope, saldo, ultimo_abono').order('nombre');
    if (error) throw error;
    return (data ?? []).map((r) => cuenta(
      r.cliente_id as string, r.nombre as string, Number(r.credito_tope ?? 0), Number(r.saldo ?? 0),
      (r.ultimo_abono as string) ?? null));
  },
  async movimientos(clienteId: string): Promise<MovimientoCuenta[]> {
    const { data, error } = await supabase().from('cuenta_cliente_movimientos')
      .select('id, tipo, monto, created_at, metodo, nota, sales(folio)')
      .eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string, tipo: r.tipo as TipoMovimiento, monto: Number(r.monto),
      fecha: r.created_at as string, metodo: (r.metodo as MetodoAbono) ?? null, nota: (r.nota as string) ?? null,
      folio: (r.sales as unknown as { folio: number } | null)?.folio ?? null,
    }));
  },
  async abonar(clienteId: string, monto: number, metodo: MetodoAbono, nota: string | null): Promise<number> {
    const { data, error } = await supabase().rpc('fn_abonar_cuenta', {
      p_cliente: clienteId, p_monto: monto, p_metodo: metodo, p_nota: nota,
    });
    if (error) throw error;
    return Number((data as { saldo: number }).saldo);
  },
  async fijarTope(clienteId: string, tope: number): Promise<void> {
    const { error } = await supabase().rpc('fn_tope_credito', { p_cliente: clienteId, p_tope: tope });
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// Maqueta: los movimientos y los topes viven en `meta` del navegador
// ---------------------------------------------------------------------------
const CLAVE_MOVS = 'demo:fiado';
const CLAVE_TOPES = 'demo:fiado-topes';
const CLAVE_CLIENTES = 'demo:clientes';

interface MovDemo extends MovimientoCuenta { clienteId: string }

async function leer<T>(clave: string, vacio: T): Promise<T> {
  const crudo = await getMeta(clave);
  return crudo ? JSON.parse(crudo) as T : vacio;
}

async function saldoDemo(clienteId: string): Promise<number> {
  const movs = await leer<MovDemo[]>(CLAVE_MOVS, []);
  return movs.filter((m) => m.clienteId === clienteId).reduce((s, m) => s + signoMovimiento(m.tipo) * m.monto, 0);
}

async function agregarDemo(m: Omit<MovDemo, 'id' | 'fecha'>) {
  const movs = await leer<MovDemo[]>(CLAVE_MOVS, []);
  movs.unshift({ ...m, id: crypto.randomUUID(), fecha: new Date().toISOString() });
  await setMeta(CLAVE_MOVS, JSON.stringify(movs.slice(0, 500)));
}

const demo: typeof base = {
  async cuentas() {
    const clientes = await leer<Array<{ id: string; nombre: string }>>(CLAVE_CLIENTES, []);
    const topes = await leer<Record<string, number>>(CLAVE_TOPES, {});
    const movs = await leer<MovDemo[]>(CLAVE_MOVS, []);
    return clientes.map((c) => {
      const propios = movs.filter((m) => m.clienteId === c.id);
      const saldo = propios.reduce((s, m) => s + signoMovimiento(m.tipo) * m.monto, 0);
      return cuenta(c.id, c.nombre, topes[c.id] ?? 0, saldo, propios.find((m) => m.tipo === 'abono')?.fecha ?? null);
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  },
  async movimientos(clienteId) {
    return (await leer<MovDemo[]>(CLAVE_MOVS, [])).filter((m) => m.clienteId === clienteId);
  },
  // Las mismas reglas que fn_abonar_cuenta.
  async abonar(clienteId, monto, metodo, nota) {
    if (!Number.isInteger(monto) || monto <= 0) throw new Error('MONTO_INVALIDO');
    const saldo = await saldoDemo(clienteId);
    if (monto > saldo) throw new Error('ABONO_EXCEDE_SALDO');
    if (metodo === 'efectivo') {
      const { cajaDemo, usuarioDemoActual } = await import('../demo/caja');
      const r = cajaDemo.abono(usuarioDemoActual(), monto);
      if (r.error) throw new Error(r.error.message);
    }
    await agregarDemo({ clienteId, tipo: 'abono', monto, metodo, nota: nota?.trim() || null, folio: null });
    return saldo - monto;
  },
  async fijarTope(clienteId, tope) {
    if (!Number.isInteger(tope) || tope < 0 || tope > 5_000_000) throw new Error('TOPE_CREDITO_INVALIDO');
    const topes = await leer<Record<string, number>>(CLAVE_TOPES, {});
    topes[clienteId] = tope;
    await setMeta(CLAVE_TOPES, JSON.stringify(topes));
  },
};

const repo = () => (DEMO_ACTIVO ? demo : base);

export const cuentasClientes = () => repo().cuentas();
export const movimientosCuenta = (clienteId: string) => repo().movimientos(clienteId);
export const abonarCuenta = (clienteId: string, monto: number, metodo: MetodoAbono, nota: string | null) =>
  repo().abonar(clienteId, monto, metodo, nota);
export const fijarTopeCredito = (clienteId: string, tope: number) => repo().fijarTope(clienteId, tope);

/** La cuenta de un cliente (tope, saldo, disponible), o null si no se pudo leer. */
export async function cuentaDe(clienteId: string): Promise<CuentaCliente | null> {
  return (await cuentasClientes()).find((c) => c.clienteId === clienteId) ?? null;
}

/**
 * En la maqueta, la venta fiada deja su cargo como lo haría fn_register_sale.
 * Se valida el tope igual que la base: la maqueta no enseña algo que la base
 * rechazaría.
 */
export async function cargoFiadoDemo(clienteId: string, monto: number, folio: number): Promise<void> {
  const topes = await leer<Record<string, number>>(CLAVE_TOPES, {});
  if ((await saldoDemo(clienteId)) + monto > (topes[clienteId] ?? 0)) throw new Error('FIADO_EXCEDE_TOPE');
  await agregarDemo({ clienteId, tipo: 'cargo', monto, metodo: null, nota: null, folio });
}

/** En la maqueta, anular una venta fiada rebaja la deuda (como el disparador de 0029). */
export async function anulacionFiadoDemo(clienteId: string, monto: number, folio: number): Promise<void> {
  const rebaja = Math.min(monto, await saldoDemo(clienteId));
  if (rebaja > 0) await agregarDemo({ clienteId, tipo: 'anulacion', monto: rebaja, metodo: null, nota: `Venta folio ${folio} anulada`, folio });
}
