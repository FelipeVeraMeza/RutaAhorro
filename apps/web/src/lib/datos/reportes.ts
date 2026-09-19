'use client';

import { diaLocal, sumarDias } from '@rutaahorro/core';
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

export interface RepositorioReportes {
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
  async ventasPorDia(rango) {
    return semillaDiaria(rango);
  },

  async ventasPorProducto(rango, verCostos) {
    const dias = Math.max(1, semillaDiaria(rango).length);
    return DEMO_PRODUCTOS.map((p, i) => {
      // Determinista a propósito: el mismo producto vende lo mismo en cada
      // recarga. Números que bailan solos hacen dudar del reporte entero.
      const unidades = Math.max(1, Math.round(((i * 7) % 11) + 2) * Math.ceil(dias / 7));
      const ingresos = unidades * p.sale_price;
      const costo = unidades * p.avg_cost;
      return {
        productoId: p.id,
        nombre: p.name,
        categoriaId: p.categoria,
        unidades,
        ingresos,
        ...(verCostos ? { costo, utilidad: ingresos - costo } : {}),
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

  async ajustes() {
    // Los ajustes de demo salen del kardex local, que sí es real: lo que se
    // ajustó en la pantalla de Inventario aparece acá.
    const { db } = await import('../offline/db');
    const raw = await db().meta.get('demo:movimientos');
    const movs = raw?.value
      ? (JSON.parse(raw.value) as Array<{
          fecha: string; tipo: string; productoNombre: string;
          cantidad: number; motivo: string | null; usuario: string | null;
        }>)
      : [];
    const costos = JSON.parse((await db().meta.get('demo:costos'))?.value ?? '{}') as Record<string, number>;
    return movs
      .filter((m) => ['ajuste_positivo', 'ajuste_negativo', 'merma', 'toma_inventario'].includes(m.tipo))
      .map((m) => ({
        fecha: m.fecha,
        tipo: m.tipo,
        productoNombre: m.productoNombre,
        cantidad: m.cantidad,
        motivo: m.motivo,
        impacto: Math.round(m.cantidad * (Object.values(costos)[0] ?? 0)),
        usuario: m.usuario,
      }));
  },
};

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const repoSupabase: RepositorioReportes = {
  async ventasPorDia({ desde, hasta }) {
    const { data, error } = await supabase()
      .from('v_sales_daily')
      .select('sale_date, sales_count, total_amount, average_ticket')
      .gte('sale_date', desde)
      .lte('sale_date', hasta)
      .order('sale_date');
    if (error) throw error;
    return (data ?? []).map((d) => ({
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
    const { data, error } = await supabase()
      .from('v_sales_by_product')
      .select('product_id, product_name, category_id, units_sold, revenue, cost, gross_profit')
      .gte('sale_date', desde)
      .lte('sale_date', hasta);
    if (error) throw error;

    const porProducto = new Map<string, VentaPorProducto>();
    for (const f of data ?? []) {
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
    const { data, error } = await supabase()
      .from('v_sales_by_user')
      .select('user_id, full_name, sales_count, total_amount')
      .gte('sale_date', desde)
      .lte('sale_date', hasta);
    if (error) throw error;

    const porUsuario = new Map<string, VentaPorUsuario>();
    for (const f of data ?? []) {
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
    const { data, error } = await supabase()
      .from('v_inventory_valued')
      .select('product_id, name, category_name, quantity, avg_cost, cost_value, sale_value')
      .gt('quantity', 0)
      .order('cost_value', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((p) => ({
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
    const { data, error } = await supabase()
      .from('v_stale_products')
      .select('product_id, name, quantity, cost_value, days_idle')
      .gte('days_idle', diasMinimos)
      .gt('quantity', 0)
      .order('cost_value', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((p) => ({
      productoId: p.product_id as string,
      nombre: (p.name as string) ?? 'Producto',
      cantidad: Number(p.quantity ?? 0),
      valorCosto: Number(p.cost_value ?? 0),
      diasSinVender: Number(p.days_idle ?? 0),
    }));
  },

  async ajustes({ desde, hasta }) {
    const { data, error } = await supabase()
      .from('v_adjustments')
      .select('adj_date, movement_type, product_name, quantity, reason, value_impact, created_by_name')
      .gte('adj_date', desde)
      .lte('adj_date', hasta)
      .order('adj_date', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((a) => ({
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
