/**
 * La caja del MODO DEMO.
 *
 * Antes la maqueta mostraba siempre la misma caja abierta y los botones
 * llamaban a Supabase: "Cerrar caja", "+ Ingreso" y "Abrir caja" terminaban
 * en "Ocurrió un problema". No había cómo recorrer el turno de un vendedor.
 *
 * Vive en una cookie y no en IndexedDB porque la pantalla de Caja (y el POS,
 * que pregunta si hay caja abierta) se arman en el servidor. Guarda solo
 * totales y los últimos movimientos: una cookie no pasa de 4 KB.
 */
import { DEMO_CAJA, DEMO_MOVIMIENTOS_CAJA, DEMO_CIERRES } from './data';

export const DEMO_COOKIE_CAJA = 'demo_caja';

export interface MovimientoDemo { id: string; type: 'ingreso' | 'egreso'; amount: number; reason: string; created_at: string }
export interface CierreDemo {
  session_id: string; full_name: string | null; opened_at: string;
  closed_at: string | null; difference: number | null; sales_total: number | null;
}

export interface CajaDemo {
  usuario: string;
  abierta: boolean;
  id: string;
  apertura: number;
  abiertaEn: string;
  ventas: { n: number; total: number; porMedio: Record<string, number>; redondeo?: number };
  /** Abonos de fiado recibidos en efectivo en esta caja (0029). */
  abonos?: number;
  movs: MovimientoDemo[];
  cierres: CierreDemo[];
}

/** La caja de ejemplo con que parte cada cuenta: abierta, con ventas del día. */
export function cajaInicial(usuario: string): CajaDemo {
  return {
    usuario,
    abierta: true,
    id: DEMO_CAJA.id,
    apertura: DEMO_CAJA.opening_amount,
    abiertaEn: DEMO_CAJA.opened_at,
    ventas: { n: DEMO_CAJA.sales_count, total: DEMO_CAJA.sales_total, porMedio: { ...DEMO_CAJA.by_payment_method } },
    movs: DEMO_MOVIMIENTOS_CAJA.map((m) => ({ ...m, type: m.type as 'ingreso' | 'egreso' })),
    cierres: DEMO_CIERRES,
  };
}

export function leerCajaDemo(valor: string | undefined, usuario: string): CajaDemo {
  if (valor) {
    try {
      const c = JSON.parse(decodeURIComponent(valor)) as CajaDemo;
      if (c.usuario === usuario && Array.isArray(c.movs)) return c;
    } catch { /* cookie vieja o rota: se parte de nuevo */ }
  }
  return cajaInicial(usuario);
}

const suma = (movs: MovimientoDemo[], t: 'ingreso' | 'egreso') =>
  movs.filter((m) => m.type === t).reduce((s, m) => s + m.amount, 0);

/** Lo que devuelve fn_cash_session_summary, calculado desde la cookie. */
export function resumenCajaDemo(c: CajaDemo) {
  const cash_sales = c.ventas.porMedio.efectivo ?? 0;
  const cash_in = suma(c.movs, 'ingreso');
  const cash_out = suma(c.movs, 'egreso');
  const abonos_efectivo = c.abonos ?? 0;
  return {
    opening_amount: c.apertura,
    cash_sales, cash_in, cash_out, abonos_efectivo,
    ajuste_redondeo: c.ventas.redondeo ?? 0,
    fiado: c.ventas.porMedio.fiado ?? 0,
    // Igual que fn_cash_session_summary (0029): lo fiado no está en el cajón.
    expected_amount: c.apertura + cash_sales + cash_in - cash_out + abonos_efectivo,
    sales_count: c.ventas.n,
    sales_total: c.ventas.total,
    average_ticket: c.ventas.n ? Math.round(c.ventas.total / c.ventas.n) : 0,
    by_payment_method: c.ventas.porMedio,
  };
}

// --------------------------------------------------------------- navegador

/** El id de la cuenta de demo con que se entró, leído de las cookies. */
export function usuarioDemoActual(): string {
  const galleta = (n: string) => document.cookie.split('; ').find((x) => x.startsWith(`${n}=`))?.slice(n.length + 1);
  try {
    const cuenta = JSON.parse(decodeURIComponent(galleta('demo_cuenta') ?? '')) as { id?: string };
    if (typeof cuenta.id === 'string') return cuenta.id;
  } catch { /* sin cuenta propia: la de ejemplo del rol */ }
  return `demo-${galleta('demo_rol') ?? 'admin'}`;
}

export function leerCajaDemoNavegador(usuario: string): CajaDemo {
  return leerEnNavegador(usuario);
}

function leerEnNavegador(usuario: string): CajaDemo {
  const par = document.cookie.split('; ').find((x) => x.startsWith(`${DEMO_COOKIE_CAJA}=`));
  return leerCajaDemo(par?.slice(DEMO_COOKIE_CAJA.length + 1), usuario);
}

function escribir(c: CajaDemo) {
  const recortada = { ...c, movs: c.movs.slice(0, 15), cierres: c.cierres.slice(0, 5) };
  document.cookie = `${DEMO_COOKIE_CAJA}=${encodeURIComponent(JSON.stringify(recortada))}; path=/; SameSite=Lax`;
}

type Resultado = Promise<{ error: { message: string } | null }>;

/** Las mismas reglas que la base: una caja abierta por persona, motivo obligatorio. */
export const cajaDemo = {
  async abrir(usuario: string, monto: number): Resultado {
    const c = leerEnNavegador(usuario);
    if (c.abierta) return { error: { message: 'CAJA_YA_ABIERTA' } };
    // Como fn_open_cash_session desde 0037.
    if (!(monto >= 0)) return { error: { message: 'MONTO_NEGATIVO' } };
    escribir({
      ...c, abierta: true, id: `caja-${Date.now()}`, apertura: monto, abiertaEn: new Date().toISOString(),
      ventas: { n: 0, total: 0, porMedio: {}, redondeo: 0 }, movs: [], abonos: 0,
    });
    return { error: null };
  },

  async movimiento(usuario: string, type: 'ingreso' | 'egreso', amount: number, reason: string): Resultado {
    const c = leerEnNavegador(usuario);
    if (!c.abierta) return { error: { message: 'CAJA_NO_ABIERTA' } };
    if (!reason.trim()) return { error: { message: 'MOTIVO_REQUERIDO' } };
    if (!(amount > 0)) return { error: { message: 'MONTO_INVALIDO' } };
    c.movs.unshift({ id: `m${Date.now()}`, type, amount, reason, created_at: new Date().toISOString() });
    escribir(c);
    return { error: null };
  },

  async cerrar(usuario: string, nombre: string, contado: number, nota = ''): Resultado {
    const c = leerEnNavegador(usuario);
    if (!c.abierta) return { error: { message: 'CAJA_YA_CERRADA' } };
    if (!(contado >= 0)) return { error: { message: 'MONTO_NEGATIVO' } };
    const r = resumenCajaDemo(c);
    // Igual que fn_close_cash_session: descuadrada no se cierra sin explicar.
    if (contado !== r.expected_amount && !nota.trim()) return { error: { message: 'MOTIVO_REQUERIDO' } };
    c.cierres.unshift({
      session_id: c.id, full_name: nombre, opened_at: c.abiertaEn, closed_at: new Date().toISOString(),
      difference: contado - r.expected_amount, sales_total: c.ventas.total,
    });
    escribir({ ...c, abierta: false });
    return { error: null };
  },

  /** Un abono de fiado en efectivo entra al cajón de quien lo recibe. */
  abono(usuario: string, monto: number): { error: { message: string } | null } {
    const c = leerEnNavegador(usuario);
    if (!c.abierta) return { error: { message: 'CAJA_NO_ABIERTA' } };
    escribir({ ...c, abonos: (c.abonos ?? 0) + monto });
    return { error: null };
  },

  /** Cada venta de la maqueta suma a la caja abierta de quien la cobró. */
  registrarVenta(usuario: string, total: number, pagos: Array<{ method: string; amount: number }>) {
    try {
      const c = leerEnNavegador(usuario);
      if (!c.abierta) return;
      c.ventas.n += 1;
      c.ventas.total += total;
      for (const p of pagos) c.ventas.porMedio[p.method] = (c.ventas.porMedio[p.method] ?? 0) + p.amount;
      // RF-M5-28 · pagado todo en efectivo, lo cobrado menos el total.
      if (pagos.length && pagos.every((p) => p.method === 'efectivo')) {
        c.ventas.redondeo = (c.ventas.redondeo ?? 0) + pagos.reduce((s, p) => s + p.amount, 0) - total;
      }
      escribir(c);
    } catch { /* la venta vale igual; la caja de la maqueta no la suma */ }
  },
};
