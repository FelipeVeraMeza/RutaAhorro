'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { getMeta, setMeta } from '../offline/db';

/**
 * Descuento autorizado en el mostrador (RQ-17, 0036).
 *
 * John o María José guardan un PIN en Mi cuenta. En Vender, cuando el
 * descuento pasa el tope del vendedor, uno de ellos escribe su PIN en ese
 * mismo celular y queda una autorización de un solo uso por 15 minutos, que
 * viaja con la venta. Necesita internet: el PIN se revisa en la base.
 */
export interface Autorizador {
  id: string;
  nombre: string;
  /** Hasta cuánto puede autorizar (su propio tope). */
  tope: number;
}

interface Repositorio {
  guardarPin(pin: string, yo: { id: string; nombre: string; tope: number }): Promise<void>;
  autorizadores(): Promise<Autorizador[]>;
  /** Devuelve el id de la autorización. Lanza PIN_INCORRECTO si no corresponde. */
  autorizar(d: { autorizadorId: string; pin: string; pct: number; motivo?: string }): Promise<string>;
}

const supabaseRepo: Repositorio = {
  async guardarPin(pin) {
    const { error } = await supabase().rpc('fn_guardar_pin', { p_pin: pin });
    if (error) throw error;
  },
  async autorizadores() {
    const { data, error } = await supabase().rpc('fn_autorizadores');
    if (error) throw error;
    return ((data ?? []) as Array<{ id: string; nombre: string; tope: number }>)
      .map((a) => ({ id: a.id, nombre: a.nombre, tope: Number(a.tope ?? 0) }));
  },
  async autorizar({ autorizadorId, pin, pct, motivo }) {
    const { data, error } = await supabase().rpc('fn_autorizar_descuento', {
      p_autorizador: autorizadorId, p_pin: pin, p_pct: pct, p_motivo: motivo ?? null,
    });
    if (error) throw error;
    // Un PIN malo no levanta error en la base (si no, el intento fallido no
    // quedaría anotado y el bloqueo por 5 intentos no funcionaría): vuelve null.
    if (!data) throw new Error('PIN_INCORRECTO');
    return data as string;
  },
};

// --------------------------------------------------------------- maqueta
const CLAVE = 'demo:pines';
type PinDemo = Autorizador & { pin: string; malos: number[] };
const leer = async (): Promise<PinDemo[]> => JSON.parse((await getMeta(CLAVE)) ?? '[]');

const demoRepo: Repositorio = {
  async guardarPin(pin, yo) {
    if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN_INVALIDO');
    const lista = (await leer()).filter((x) => x.id !== yo.id);
    await setMeta(CLAVE, JSON.stringify([...lista, { ...yo, pin, malos: [] }]));
  },
  async autorizadores() {
    return (await leer()).map(({ id, nombre, tope }) => ({ id, nombre, tope }));
  },
  async autorizar({ autorizadorId, pin, pct }) {
    const lista = await leer();
    const a = lista.find((x) => x.id === autorizadorId);
    if (!a) throw new Error('SIN_PIN');
    const recientes = a.malos.filter((t) => t > Date.now() - 15 * 60_000);
    if (recientes.length >= 5) throw new Error('PIN_BLOQUEADO');
    if (a.pin !== pin) {
      a.malos = [...recientes, Date.now()];
      await setMeta(CLAVE, JSON.stringify(lista));
      throw new Error('PIN_INCORRECTO');
    }
    if (pct > a.tope + 0.01) throw new Error('AUTORIZACION_EXCEDE_TOPE');
    return crypto.randomUUID();
  },
};

export function repoAutorizaciones(): Repositorio {
  return DEMO_ACTIVO ? demoRepo : supabaseRepo;
}
