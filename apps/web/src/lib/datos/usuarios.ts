'use client';

import { supabase } from '../supabase/client';
import { DEMO_ACTIVO } from '../demo';
import { db } from '../offline/db';
import type { Rol } from '../navegacion';

/**
 * Gestión de usuarios del local (RF-M1-03, RF-M1-12, RF-M1-14).
 *
 * El administrador invita por correo y el empleado define su propia
 * contraseña desde el enlace. El administrador nunca la conoce: eso evita que
 * una acción quede atribuida a alguien que no la hizo, que es la base de toda
 * la trazabilidad del sistema.
 */

export interface Usuario {
  id: string;
  nombre: string;
  email: string | null;
  rol: Rol;
  activo: boolean;
  ultimaActividad: string | null;
  descuentoMax: number;
}

export interface RepositorioUsuarios {
  listar(): Promise<Usuario[]>;
  invitar(datos: { nombre: string; email: string; rol: Rol }): Promise<void>;
  cambiarRol(id: string, rol: Rol): Promise<void>;
  desactivar(id: string): Promise<void>;
  reactivar(id: string): Promise<void>;
}

const KEY = 'demo:usuarios';

const SEMILLA: Usuario[] = [
  { id: 'demo-admin', nombre: 'Felipe Vera', email: 'felipe@rutaahorro.cl', rol: 'admin', activo: true, ultimaActividad: new Date().toISOString(), descuentoMax: 100 },
  { id: 'demo-supervisor', nombre: 'Marcela Soto', email: 'marcela@rutaahorro.cl', rol: 'supervisor', activo: true, ultimaActividad: new Date(Date.now() - 12 * 60000).toISOString(), descuentoMax: 10 },
  { id: 'demo-vendedor', nombre: 'Jorge Peña', email: 'jorge@rutaahorro.cl', rol: 'vendedor', activo: true, ultimaActividad: new Date(Date.now() - 3 * 60000).toISOString(), descuentoMax: 0 },
  { id: 'demo-bodega', nombre: 'Luis Rojas', email: 'luis@rutaahorro.cl', rol: 'bodega', activo: true, ultimaActividad: new Date(Date.now() - 4 * 3600000).toISOString(), descuentoMax: 0 },
];

const DESCUENTO_POR_ROL: Record<Rol, number> = {
  admin: 100, supervisor: 10, vendedor: 0, bodega: 0,
};

async function leerLocal(): Promise<Usuario[]> {
  const raw = await db().meta.get(KEY);
  if (raw?.value) return JSON.parse(raw.value) as Usuario[];
  await db().meta.put({ key: KEY, value: JSON.stringify(SEMILLA) });
  return SEMILLA;
}

async function guardarLocal(us: Usuario[]) {
  await db().meta.put({ key: KEY, value: JSON.stringify(us) });
}

const repoLocal: RepositorioUsuarios = {
  listar: leerLocal,

  async invitar({ nombre, email, rol }) {
    const us = await leerLocal();
    if (us.some((u) => u.email?.toLowerCase() === email.toLowerCase())) {
      throw new Error('CORREO_YA_REGISTRADO');
    }
    us.push({
      id: `u${Date.now()}`,
      nombre, email, rol, activo: true,
      ultimaActividad: null,          // aún no ha entrado
      descuentoMax: DESCUENTO_POR_ROL[rol],
    });
    await guardarLocal(us);
  },

  async cambiarRol(id, rol) {
    const us = await leerLocal();
    const u = us.find((x) => x.id === id);
    if (!u) throw new Error('NO_ENCONTRADO');
    u.rol = rol;
    u.descuentoMax = DESCUENTO_POR_ROL[rol];
    await guardarLocal(us);
  },

  async desactivar(id) {
    const us = await leerLocal();
    const u = us.find((x) => x.id === id);
    if (!u) throw new Error('NO_ENCONTRADO');
    u.activo = false;
    await guardarLocal(us);
  },

  async reactivar(id) {
    const us = await leerLocal();
    const u = us.find((x) => x.id === id);
    if (!u) throw new Error('NO_ENCONTRADO');
    u.activo = true;
    await guardarLocal(us);
  },
};

const repoSupabase: RepositorioUsuarios = {
  async listar() {
    const { data, error } = await supabase()
      .from('profiles')
      .select('id, full_name, email, role, is_active, last_seen_at, max_discount_pct')
      .order('full_name');
    if (error) throw error;
    return (data ?? []).map((p) => ({
      id: p.id as string,
      nombre: (p.full_name as string) || 'Sin nombre',
      email: p.email as string | null,
      rol: p.role as Rol,
      activo: Boolean(p.is_active),
      ultimaActividad: p.last_seen_at as string | null,
      descuentoMax: Number(p.max_discount_pct ?? 0),
    }));
  },

  async invitar({ nombre, email, rol }) {
    // La invitación la emite el servidor: crear usuarios en Auth requiere la
    // llave de servicio, que jamás puede estar en el navegador (RNF-25).
    const res = await fetch('/api/usuarios/invitar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, email, rol }),
    });
    if (!res.ok) {
      const cuerpo = await res.json().catch(() => ({}));
      throw new Error(cuerpo?.error?.code ?? 'ERROR_INTERNO');
    }
  },

  async cambiarRol(id, rol) {
    const { error } = await supabase()
      .from('profiles')
      .update({ role: rol, max_discount_pct: DESCUENTO_POR_ROL[rol] })
      .eq('id', id);
    if (error) throw error;
  },

  async desactivar(id) {
    const { error } = await supabase().from('profiles').update({ is_active: false }).eq('id', id);
    if (error) throw error;
  },

  async reactivar(id) {
    const { error } = await supabase().from('profiles').update({ is_active: true }).eq('id', id);
    if (error) throw error;
  },
};

export function repoUsuarios(): RepositorioUsuarios {
  return DEMO_ACTIVO ? repoLocal : repoSupabase;
}
