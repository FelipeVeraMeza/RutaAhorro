'use client';

import type { Combo } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { getMeta, setMeta } from '../offline/db';

/**
 * Combos entre productos distintos (0023).
 *
 * Se escriben con `fn_guardar_combo` (sin política de escritura, regla 14) y
 * viajan al celular con el catálogo, para que el POS los aplique sin conexión.
 * Con las ofertas del local apagadas, el celular los recibe vacíos: son una
 * promoción, y la base tampoco los aceptaría.
 */
export interface ComboEditable extends Combo {
  activo: boolean;
}

export interface RepositorioCombos {
  listar(): Promise<ComboEditable[]>;
  /** Crea (sin id) o cambia un combo. Devuelve su id. */
  guardar(c: Omit<ComboEditable, 'id'> & { id?: string | null }): Promise<string>;
}

const CLAVE_VENDER = 'catalog:combos';
const CLAVE_DEMO = 'demo:combos';

async function leerDeBase(soloActivos: boolean): Promise<ComboEditable[]> {
  let q = supabase().from('combos')
    .select('id, nombre, precio, vigente_desde, vigente_hasta, is_active, combo_items(product_id, cantidad)')
    .order('nombre');
  if (soloActivos) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    nombre: r.nombre as string,
    precio: Number(r.precio),
    vigenteDesde: (r.vigente_desde as string) ?? null,
    vigenteHasta: (r.vigente_hasta as string) ?? null,
    activo: Boolean(r.is_active),
    items: ((r.combo_items as { product_id: string; cantidad: number }[]) ?? [])
      .map((i) => ({ productId: i.product_id, cantidad: Number(i.cantidad) })),
  }));
}

/** Baja al celular los combos activos. `ofertasActivas` en false los deja vacíos. */
export async function syncCombos(ofertasActivas: boolean): Promise<void> {
  const lista = ofertasActivas ? await leerDeBase(true) : [];
  await setMeta(CLAVE_VENDER, JSON.stringify(lista));
}

/** Los combos que el POS aplica, desde el celular. */
export async function combosParaVender(): Promise<Combo[]> {
  if (DEMO_ACTIVO) return (await demoLista()).filter((c) => c.activo);
  const crudo = await getMeta(CLAVE_VENDER);
  return crudo ? JSON.parse(crudo) : [];
}

const supabaseRepo: RepositorioCombos = {
  listar: () => leerDeBase(false),
  async guardar(c) {
    const { data, error } = await supabase().rpc('fn_guardar_combo', {
      p_id: c.id ?? null,
      p_datos: {
        nombre: c.nombre, precio: c.precio, activo: c.activo,
        vigente_desde: c.vigenteDesde || null, vigente_hasta: c.vigenteHasta || null,
        items: c.items.map((i) => ({ product_id: i.productId, cantidad: i.cantidad })),
      },
    });
    if (error) throw error;
    return data as string;
  },
};

async function demoLista(): Promise<ComboEditable[]> {
  const crudo = await getMeta(CLAVE_DEMO);
  return crudo ? JSON.parse(crudo) : [];
}

const demoRepo: RepositorioCombos = {
  listar: demoLista,
  async guardar(c) {
    const lista = await demoLista();
    const id = c.id ?? crypto.randomUUID();
    const fila: ComboEditable = { ...c, id };
    await setMeta(CLAVE_DEMO, JSON.stringify(c.id ? lista.map((x) => (x.id === id ? fila : x)) : [...lista, fila]));
    window.dispatchEvent(new Event('catalogo-actualizado'));
    return id;
  },
};

export function repoCombos(): RepositorioCombos {
  return DEMO_ACTIVO ? demoRepo : supabaseRepo;
}
