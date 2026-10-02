'use client';

import { diaLocal, sumarDias, netAmount } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import {
  DEMO_PRODUCTOS, DEMO_VENTAS_HOY, DEMO_INVENTARIO_VALORIZADO,
} from '../demo/data';

/**
 * Reportes del negocio (módulo M7).
 *
 * Las siete vistas que alimentan esto —v_sales_daily, v_sales_by_product,
 * v_sales_by_user, v_inventory_valued, v_stale_products, v_adjustments— están
 * escritas desde la migración 0005 y **ninguna pantalla las consultaba**. El
 * inventario de alcance las marca como "hecho en la base, falta la pantalla",
 * que es trabajo ya pagado produciendo cero valor: el dueño no tenía forma de
 * saber qué se vende, qué deja margen ni qué plata tiene dormida en la bodega.
 *
 * El corte por fechas se hace en la consulta y no en el navegador: con tres
 * meses de operación, traerse todas las ventas para filtrar acá es traerse
 * todas las ventas.
 */

export interface RangoFechas {
  /** ISO 'YYYY-MM-DD', inclusive. */
  desde: string;
  /** ISO 'YYYY-MM-DD', inclusive. */
  hasta: string;
}

export interface VentaPorDia {
  fecha: string;
  ventas: number;
  total: number;
  ticketPromedio: number;
}

export interface VentaPorProducto {
  productoId: string;
  nombre: string;
  categoriaId: string | null;
  unidades: number;
  ingresos: number;
  /** Solo para quien puede ver costos. */
  costo?: number;
  utilidad?: number;
}

export interface VentaPorUsuario {
  usuarioId: string;
  nombre: string;
  ventas: number;
  total: number;
}

export interface FilaInventarioValorizado {
  productoId: string;
  nombre: string;
  categoria: string | null;
  cantidad: number;
  costoUnitario: number;
  valorCosto: number;
  valorVenta: number;
}

export interface ProductoSinMovimiento {
  productoId: string;
  nombre: string;
  cantidad: number;
  valorCosto: number;
  diasSinVender: number;
}

export interface Ajuste {
  fecha: string;
  tipo: string;
  productoNombre: string;
  cantidad: number;
  motivo: string | null;
  impacto: number;
  usuario: string | null;
}

/** Una venta, lo mínimo para agruparla por hora (RF-M7-13). */
export interface VentaCruda { fecha: string; total: number }

/** RF-M7-15 · anulaciones y devoluciones del período, con quién las hizo. */
export interface ControlAnulaciones {
  anulaciones: Array<{ folio: number; fecha: string; total: number; motivo: string | null; anulo: string | null; vendio: string | null }>;
  devoluciones: Array<{ numero: number; fecha: string; monto: number; motivo: string; hizo: string | null; folio: number | null }>;
}

/** RF-M7-16 · una fila por línea vendida, para el contador. */
export interface LineaVendida {
  folio: number; fecha: string; estado: string; documento: string; vendedor: string | null;
  producto: string; cantidad: number; precioUnitario: number; descuento: number; subtotal: number;
  totalVenta: number; mediosDePago: string;
}

export interface RepositorioReportes {
  ventasCrudas(rango: RangoFechas): Promise<VentaCruda[]>;
  controlAnulaciones(rango: RangoFechas): Promise<ControlAnulaciones>;
  ventasDetalladas(rango: RangoFechas): Promise<LineaVendida[]>;
  ventasPorDia(rango: RangoFechas): Promise<VentaPorDia[]>;
  ventasPorProducto(rango: RangoFechas, verCostos: boolean): Promise<VentaPorProducto[]>;
  ventasPorUsuario(rango: RangoFechas): Promise<VentaPorUsuario[]>;
  inventarioValorizado(): Promise<FilaInventarioValorizado[]>;
  sinMovimiento(diasMinimos: number): Promise<ProductoSinMovimiento[]>;
  ajustes(rango: RangoFechas): Promise<Ajuste[]>;
}

/** Hoy en la zona del local, como 'YYYY-MM-DD'. */
export function hoyLocal(zona: string): string {
  return diaLocal(new Date(), zona);
}

/** El día N días antes de hoy, en la zona del local. */
export function hace(dias: number, zona: string): string {
  return sumarDias(hoyLocal(zona), -dias);
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

/**
 * En demo los reportes se arman desde el catálogo de ejemplo.
 *
 * No son cifras al azar: se derivan de los mismos productos que se ven en las
 * otras pantallas, para que los números concuerden. Un reporte que no cuadra
 * con el inventario que está al lado enseña a desconfiar de los reportes.
 */
function semillaDiaria(rango: RangoFechas): VentaPorDia[] {
  const salida: VentaPorDia[] = [];
  const fin = new Date(`${rango.hasta}T12:00:00`);
  const ini = new Date(`${rango.desde}T12:00:00`);

  for (let d = new Date(ini); d <= fin; d.setDate(d.getDate() + 1)) {
    const fecha = d.toISOString().slice(0, 10);
    const diaSemana = d.getDay();
    // Domingo cerrado, sábado fuerte: es como se mueve un almacén de barrio.
    if (diaSemana === 0) continue;
    const factor = diaSemana === 6 ? 1.4 : 0.75 + ((d.getDate() % 7) / 10);
    const total = Math.round(DEMO_VENTAS_HOY.total * factor);
    const ventas = Math.round(DEMO_VENTAS_HOY.cantidad * factor);
    salida.push({
      fecha, ventas, total,
      ticketPromedio: ventas > 0 ? Math.round(total / ventas) : 0,
    });
  }
  return salida;
}

const repoLocal: RepositorioReportes = {
  async ventasCrudas(rango) {
    const { repoVentas } = await import('./ventas');
    const v = await repoVentas().listar({ ...rango, incluirAnuladas: false, limite: 100_000 });
    return v.map((x) => ({ fecha: x.fecha, total: x.total }));
  },

  async controlAnulaciones(rango) {
    const { repoVentas } = await import('./ventas');
    const v = await repoVentas().listar({ ...rango, incluirAnuladas: true, limite: 100_000 });
    return {
      anulaciones: v.filter((x) => x.anulada).map((x) => ({
        folio: x.folio, fecha: x.anuladaEn ?? x.fecha, total: x.total, motivo: x.motivoAnulacion, anulo: x.anuladaPor, vendio: x.vendedor,
      })),
      devoluciones: [],
    };
  },

  async ventasDetalladas(rango) {
    const { repoVentas } = await import('./ventas');
    const v = await repoVentas().listar({ ...rango, incluirAnuladas: true, limite: 100_000 });
    const filas: LineaVendida[] = [];
    for (const x of v) {
      const d = await repoVentas().detalle(x.id);
      for (const l of d?.lineas ?? []) {
        filas.push({
          folio: x.folio, fecha: x.fecha, estado: x.anulada ? 'anulada' : 'completada', documento: x.documento.tipo,
          vendedor: x.vendedor, producto: l.productoNombre, cantidad: l.cantidad, precioUnitario: l.precioUnitario,
          descuento: l.descuento, subtotal: l.subtotal, totalVenta: x.total,
          mediosDePago: (d?.pagos ?? []).map((p) => `${p.metodo} ${p.monto}`).join(' + '),
        });
      }
    }
    return filas;
  },

  async ventasPorDia(rango) {
    // Hoy sale de las ventas hechas de verdad en este navegador, igual que
    // "Vendido hoy" del Inicio: si no, el gráfico y la tarjeta no cuadraban.
    const { configuracionLocal } = await import('./configuracion');
    const { repoVentas } = await import('./ventas');
    const hoy = hoyLocal((await configuracionLocal()).zonaHoraria);
    const dias = semillaDiaria(rango).filter((d) => d.fecha !== hoy);
    if (rango.desde <= hoy && hoy <= rango.hasta) {
      const v = await repoVentas().listar({ desde: hoy, hasta: hoy, incluirAnuladas: false, limite: 100_000 });
      const total = v.reduce((s, x) => s + x.total, 0);
      if (v.length) dias.push({ fecha: hoy, ventas: v.length, total, ticketPromedio: Math.round(total / v.length) });
    }
    return dias;
  },

  async ventasPorProducto(rango, verCostos) {
    const semilla = semillaDiaria(rango);
    const dias = Math.max(1, semilla.length);
    // Lo vendido por producto suma lo mismo que Ventas en el período: antes
    // Productos decía $1.011.800 y Ventas $4.799.869 para los mismos 30 días.
    const base = DEMO_PRODUCTOS.map((_, i) => Math.max(1, Math.round(((i * 7) % 11) + 2) * Math.ceil(dias / 7)));
    const totalBase = base.reduce((s, u, i) => s + u * DEMO_PRODUCTOS[i].sale_price, 0);
    const totalVentas = semilla.reduce((s, d) => s + d.total, 0);
    const escala = totalBase > 0 && totalVentas > 0 ? totalVentas / totalBase : 1;
    return DEMO_PRODUCTOS.map((p, i) => {
      // Determinista a propósito: el mismo producto vende lo mismo en cada
      // recarga. Números que bailan solos hacen dudar del reporte entero.
      const unidades = Math.max(1, Math.round(base[i] * escala));
      const ingresos = unidades * p.sale_price;
      const costo = unidades * p.avg_cost;
      return {
        productoId: p.id,
        nombre: p.name,
        categoriaId: p.categoria,
        unidades,
        ingresos,
        // Igual que v_sales_by_product (0033): el ingreso sin IVA menos el costo neto.
        ...(verCostos ? { costo, utilidad: netAmount(ingresos) - costo } : {}),
      };
    }).sort((a, b) => b.ingresos - a.ingresos);
  },

  async ventasPorUsuario(rango) {
    const total = semillaDiaria(rango).reduce((s, d) => s + d.total, 0);
    const ventas = semillaDiaria(rango).reduce((s, d) => s + d.ventas, 0);
    return [
      { usuarioId: 'demo-vendedor', nombre: 'Jorge Peña', ventas: Math.round(ventas * 0.55), total: Math.round(total * 0.55) },
      { usuarioId: 'demo-supervisor', nombre: 'Marcela Soto', ventas: Math.round(ventas * 0.3), total: Math.round(total * 0.3) },
      { usuarioId: 'demo-admin', nombre: 'Felipe Vera', ventas: Math.round(ventas * 0.15), total: Math.round(total * 0.15) },
    ];
  },

  async inventarioValorizado() {
    return DEMO_INVENTARIO_VALORIZADO.map((p) => ({
      productoId: p.product_id,
      nombre: p.name,
      categoria: p.category_name,
      cantidad: p.quantity,
      costoUnitario: p.avg_cost,
      valorCosto: p.cost_value,
      valorVenta: p.sale_value,
    }));
  },

  async sinMovimiento(diasMinimos) {
    return DEMO_PRODUCTOS
      .map((p, i) => ({
        productoId: p.id,
        nombre: p.name,
        cantidad: p.stock,
        valorCosto: Math.round(p.stock * p.avg_cost),
        diasSinVender: (i * 13) % 120,
      }))
      .filter((p) => p.diasSinVender >= diasMinimos && p.cantidad > 0)
      .sort((a, b) => b.valorCosto - a.valorCosto);
  },

  async ajustes({ desde, hasta }) {
    // Los ajustes de demo salen del kardex local, que sí es real: lo que se
    // ajustó en la pantalla de Inventario aparece acá. Con el día del local y
    // el costo de CADA producto: antes se usaba el del primero que hubiera,
    // y salían todos los días, sin mirar el rango elegido.
    const { db } = await import('../offline/db');
    const { configuracionLocal } = await import('./configuracion');
    const { zonaHoraria } = await configuracionLocal();
    const raw = await db().meta.get('demo:movimientos');
    const movs = raw?.value
      ? (JSON.parse(raw.value) as Array<{
          fecha: string; tipo: string; productoId?: string; productoNombre: string;
          cantidad: number; motivo: string | null; usuario: string | null;
        }>)
      : [];
    const costos = JSON.parse((await db().meta.get('demo:costos'))?.value ?? '{}') as Record<string, number>;
    return movs
      .filter((m) => ['ajuste_positivo', 'ajuste_negativo', 'merma', 'toma_inventario'].includes(m.tipo))
      .map((m) => ({ m, dia: diaLocal(new Date(m.fecha), zonaHoraria) }))
      .filter(({ dia }) => dia >= desde && dia <= hasta)
      .map(({ m, dia }) => ({
        fecha: dia,
        tipo: m.tipo,
        productoNombre: m.productoNombre,
        cantidad: m.cantidad,
        motivo: m.motivo,
        impacto: Math.round(m.cantidad * (m.productoId ? costos[m.productoId] ?? 0 : 0)),
        usuario: m.usuario,
      }));
  },
};

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/** Los bordes del rango en la zona del local, como hace Ventas. */
async function bordes({ desde, hasta }: RangoFechas) {
  const { configuracionLocal } = await import('./configuracion');
  const { rangoDeDias } = await import('@rutaahorro/core');
  return rangoDeDias(desde, hasta, (await configuracionLocal()).zonaHoraria);
}

/** Todas las filas de una consulta, de a 1.000 (el tope de la API). */
async function todas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const salida: T[] = [];
  for (let desde = 0; desde < 50_000; desde += 1000) {
    const { data, error } = await pedir(desde, desde + 999);
    if (error) throw error;
    salida.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return salida;
}

const nombre = (x: unknown) => ((x as { full_name?: string } | null)?.full_name) ?? null;

const repoSupabase: RepositorioReportes = {
  async ventasCrudas(rango) {
    const r = await bordes(rango);
    const filas = await todas((a, b) => supabase().from('sales').select('sold_at, total')
      .eq('status', 'completada').gte('sold_at', r.desde).lt('sold_at', r.hasta).order('sold_at').range(a, b));
    return filas.map((f) => ({ fecha: f.sold_at as string, total: Number(f.total ?? 0) }));
  },

  async controlAnulaciones(rango) {
    const r = await bordes(rango);
    const [anuladas, devs] = await Promise.all([
      todas((a, b) => supabase().from('sales')
        .select('folio, voided_at, total, void_reason, anulo:profiles!sales_voided_by_fkey(full_name), vendio:profiles!sales_sold_by_fkey(full_name)')
        .eq('status', 'anulada').gte('voided_at', r.desde).lt('voided_at', r.hasta).order('voided_at', { ascending: false }).range(a, b)),
      todas((a, b) => supabase().from('sale_returns')
        .select('numero, created_at, monto, motivo, hizo:profiles!sale_returns_created_by_fkey(full_name), venta:sales(folio)')
        .gte('created_at', r.desde).lt('created_at', r.hasta).order('created_at', { ascending: false }).range(a, b)),
    ]);
    return {
      anulaciones: anuladas.map((f) => ({
        folio: Number(f.folio), fecha: f.voided_at as string, total: Number(f.total ?? 0),
        motivo: (f.void_reason as string | null) ?? null, anulo: nombre(f.anulo), vendio: nombre(f.vendio),
      })),
      devoluciones: devs.map((f) => ({
        numero: Number(f.numero), fecha: f.created_at as string, monto: Number(f.monto ?? 0), motivo: f.motivo as string,
        hizo: nombre(f.hizo), folio: ((f.venta as { folio?: number } | null)?.folio) ?? null,
      })),
    };
  },

  async ventasDetalladas(rango) {
    const r = await bordes(rango);
    const ventas = await todas((a, b) => supabase().from('sales')
      .select('folio, sold_at, total, status, document_type, vendedor:profiles!sales_sold_by_fkey(full_name), sale_items(product_name, quantity, unit_price, discount_amount, subtotal), sale_payments(method, amount)')
      .gte('sold_at', r.desde).lt('sold_at', r.hasta).order('sold_at').range(a, b));
    const filas: LineaVendida[] = [];
    for (const v of ventas) {
      const medios = ((v.sale_payments ?? []) as Array<{ method: string; amount: number }>).map((p) => `${p.method} ${p.amount}`).join(' + ');
      for (const l of (v.sale_items ?? []) as Array<Record<string, unknown>>) {
        filas.push({
          folio: Number(v.folio), fecha: v.sold_at as string, estado: v.status as string,
          documento: (v.document_type as string | null) ?? 'boleta', vendedor: nombre(v.vendedor),
          producto: (l.product_name as string) ?? 'Producto', cantidad: Number(l.quantity ?? 0),
          precioUnitario: Number(l.unit_price ?? 0), descuento: Number(l.discount_amount ?? 0),
          subtotal: Number(l.subtotal ?? 0), totalVenta: Number(v.total ?? 0), mediosDePago: medios,
        });
      }
    }
    return filas;
  },

  // Todas las consultas de abajo van por páginas (`todas`): la API corta en
  // 1.000 filas y estas vistas traen una fila por producto (o vendedor) y
  // día. Un mes de 100 productos son 3.000 filas: el reporte sumaba solo las
  // primeras 1.000 y mostraba ventas, utilidad e inventario cortos sin aviso.
  async ventasPorDia({ desde, hasta }) {
    const data = await todas((a, b) => supabase()
      .from('v_sales_daily')
      .select('sale_date, sales_count, total_amount, average_ticket')
      .gte('sale_date', desde)
      .lte('sale_date', hasta)
      .order('sale_date')
      .range(a, b));
    return data.map((d) => ({
      fecha: d.sale_date as string,
      ventas: Number(d.sales_count ?? 0),
      total: Number(d.total_amount ?? 0),
      ticketPromedio: Number(d.average_ticket ?? 0),
    }));
  },

  async ventasPorProducto({ desde, hasta }, verCostos) {
    // La vista trae una fila por producto y día. Se suma acá porque PostgREST
    // no agrupa: es el único caso del módulo donde el navegador hace cuentas,
    // y sobre un conjunto ya acotado por fecha.
    const data = await todas((a, b) => supabase()
      .from('v_sales_by_product')
      .select('product_id, product_name, category_id, units_sold, revenue, cost, gross_profit')
      .gte('sale_date', desde)
      .lte('sale_date', hasta)
      .order('sale_date').order('product_id').order('product_name')
      .range(a, b));

    const porProducto = new Map<string, VentaPorProducto>();
    for (const f of data) {
      const id = f.product_id as string;
      const previo = porProducto.get(id) ?? {
        productoId: id,
        nombre: (f.product_name as string) ?? 'Producto',
        categoriaId: (f.category_id as string | null) ?? null,
        unidades: 0, ingresos: 0,
        ...(verCostos ? { costo: 0, utilidad: 0 } : {}),
      };
      previo.unidades += Number(f.units_sold ?? 0);
      previo.ingresos += Number(f.revenue ?? 0);
      if (verCostos) {
        previo.costo = (previo.costo ?? 0) + Number(f.cost ?? 0);
        previo.utilidad = (previo.utilidad ?? 0) + Number(f.gross_profit ?? 0);
      }
      porProducto.set(id, previo);
    }
    return [...porProducto.values()].sort((a, b) => b.ingresos - a.ingresos);
  },

  async ventasPorUsuario({ desde, hasta }) {
    const data = await todas((a, b) => supabase()
      .from('v_sales_by_user')
      .select('user_id, full_name, sales_count, total_amount')
      .gte('sale_date', desde)
      .lte('sale_date', hasta)
      .order('sale_date').order('user_id')
      .range(a, b));

    const porUsuario = new Map<string, VentaPorUsuario>();
    for (const f of data) {
      const id = (f.user_id as string) ?? 'sin-usuario';
      const previo = porUsuario.get(id)
        ?? { usuarioId: id, nombre: (f.full_name as string) ?? 'Sin nombre', ventas: 0, total: 0 };
      previo.ventas += Number(f.sales_count ?? 0);
      previo.total += Number(f.total_amount ?? 0);
      porUsuario.set(id, previo);
    }
    return [...porUsuario.values()].sort((a, b) => b.total - a.total);
  },

  async inventarioValorizado() {
    const data = await todas((a, b) => supabase()
      .from('v_inventory_valued')
      .select('product_id, name, category_name, quantity, avg_cost, cost_value, sale_value')
      .gt('quantity', 0)
      .order('cost_value', { ascending: false }).order('product_id')
      .range(a, b));
    return data.map((p) => ({
      productoId: p.product_id as string,
      nombre: (p.name as string) ?? 'Producto',
      categoria: (p.category_name as string | null) ?? null,
      cantidad: Number(p.quantity ?? 0),
      costoUnitario: Number(p.avg_cost ?? 0),
      valorCosto: Number(p.cost_value ?? 0),
      valorVenta: Number(p.sale_value ?? 0),
    }));
  },

  async sinMovimiento(diasMinimos) {
    const data = await todas((a, b) => supabase()
      .from('v_stale_products')
      .select('product_id, name, quantity, cost_value, days_idle')
      .gte('days_idle', diasMinimos)
      .gt('quantity', 0)
      .order('cost_value', { ascending: false }).order('product_id')
      .range(a, b));
    return data.map((p) => ({
      productoId: p.product_id as string,
      nombre: (p.name as string) ?? 'Producto',
      cantidad: Number(p.quantity ?? 0),
      valorCosto: Number(p.cost_value ?? 0),
      diasSinVender: Number(p.days_idle ?? 0),
    }));
  },

  async ajustes({ desde, hasta }) {
    const data = await todas((a, b) => supabase()
      .from('v_adjustments')
      .select('adj_date, movement_type, product_name, quantity, reason, value_impact, created_by_name')
      .gte('adj_date', desde)
      .lte('adj_date', hasta)
      .order('adj_date', { ascending: false }).order('product_id').order('movement_type').order('quantity')
      .range(a, b));
    return data.map((a) => ({
      fecha: a.adj_date as string,
      tipo: a.movement_type as string,
      productoNombre: (a.product_name as string) ?? 'Producto',
      cantidad: Number(a.quantity ?? 0),
      motivo: (a.reason as string | null) ?? null,
      impacto: Number(a.value_impact ?? 0),
      usuario: (a.created_by_name as string | null) ?? null,
    }));
  },
};

export function repoReportes(): RepositorioReportes {
  return DEMO_ACTIVO ? repoLocal : repoSupabase;
}
