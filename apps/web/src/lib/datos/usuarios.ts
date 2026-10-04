'use client';

import { maxDiscountFor, type UserRole } from '@rutaahorro/core';
import { supabase } from '../supabase/client';
import { topeDescuentoDe } from './configuracion';
import { DEMO_ACTIVO, DEMO_CLAVE } from '../demo';
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
  /** RF-M1-20 · entró (o todavía no) con la contraseña temporal y no la ha cambiado. */
  claveTemporal?: boolean;
}

export interface RepositorioUsuarios {
  listar(): Promise<Usuario[]>;
  invitar(datos: { nombre: string; email: string; rol: Rol }): Promise<void>;
  /**
   * Crear la cuenta con una contraseña temporal, sin correo. La persona la
   * cambia por una suya al primer ingreso.
   */
  crearConClave(datos: { nombre: string; email: string; rol: Rol; clave: string }): Promise<void>;
  /** Contraseña temporal para quien olvidó la suya. */
  restablecerClave(id: string, clave: string): Promise<void>;
  cambiarRol(id: string, rol: Rol): Promise<void>;
  desactivar(id: string): Promise<void>;
  reactivar(id: string): Promise<void>;
}

/** Versión 2: los correos son los de las cuentas de ejemplo de /login, y cada una guarda su clave. */
const KEY = 'demo:usuarios:v2';

/** En la maqueta la clave vive junto al usuario. Nunca en producción. */
type UsuarioDemo = Usuario & { clave: string };

const SEMILLA: UsuarioDemo[] = [
  { id: 'demo-admin', nombre: 'Felipe Vera', email: 'admin@demo.cl', rol: 'admin', activo: true, ultimaActividad: new Date().toISOString(), descuentoMax: 100, clave: DEMO_CLAVE },
  { id: 'demo-supervisor', nombre: 'Marcela Soto', email: 'supervisor@demo.cl', rol: 'supervisor', activo: true, ultimaActividad: new Date(Date.now() - 12 * 60000).toISOString(), descuentoMax: 10, clave: DEMO_CLAVE },
  { id: 'demo-vendedor', nombre: 'Jorge Peña', email: 'vendedor@demo.cl', rol: 'vendedor', activo: true, ultimaActividad: new Date(Date.now() - 3 * 60000).toISOString(), descuentoMax: 0, clave: DEMO_CLAVE },
  { id: 'demo-bodega', nombre: 'Luis Rojas', email: 'bodega@demo.cl', rol: 'bodega', activo: true, ultimaActividad: new Date(Date.now() - 4 * 3600000).toISOString(), descuentoMax: 0, clave: DEMO_CLAVE },
];

async function leerLocal(): Promise<UsuarioDemo[]> {
  const raw = await db().meta.get(KEY);
  if (raw?.value) return JSON.parse(raw.value) as UsuarioDemo[];
  await db().meta.put({ key: KEY, value: JSON.stringify(SEMILLA) });
  return SEMILLA.map((u) => ({ ...u }));
}

async function guardarLocal(us: UsuarioDemo[]) {
  await db().meta.put({ key: KEY, value: JSON.stringify(us) });
}

/**
 * La cuenta de demo con ese correo, para /login. Las de ejemplo y las que el
 * administrador creó en Usuarios con su clave temporal.
 */
export async function cuentaDemoPorCorreo(correo: string): Promise<{
  id: string; nombre: string; correo: string; rol: Rol; clave: string; activo: boolean;
} | null> {
  const u = (await leerLocal()).find((x) => x.email?.toLowerCase() === correo.toLowerCase());
  return u ? { id: u.id, nombre: u.nombre, correo: u.email ?? correo, rol: u.rol, clave: u.clave, activo: u.activo } : null;
}

const repoLocal: RepositorioUsuarios = {
  async listar() {
    // La clave no sale del repositorio: la pantalla no tiene por qué verla.
    return (await leerLocal()).map(({ clave: _clave, ...u }) => u);
  },

  async invitar({ nombre, email, rol }) {
    // En la maqueta no hay correo: queda con la clave de ejemplo.
    await repoLocal.crearConClave({ nombre, email, rol, clave: DEMO_CLAVE });
  },

  async crearConClave({ nombre, email, rol, clave }) {
    const us = await leerLocal();
    if (us.some((u) => u.email?.toLowerCase() === email.toLowerCase())) {
      throw new Error('CORREO_YA_REGISTRADO');
    }
    us.push({
      id: `u${Date.now()}`,
      nombre, email: email.toLowerCase(), rol, activo: true,
      ultimaActividad: null,          // aún no ha entrado
      descuentoMax: maxDiscountFor(rol as UserRole),
      clave,
      claveTemporal: true,
    });
    await guardarLocal(us);
  },

  async restablecerClave(id, clave) {
    const us = await leerLocal();
    const u = us.find((x) => x.id === id);
    if (!u) throw new Error('NO_ENCONTRADO');
    u.clave = clave;
    u.claveTemporal = true;
    await guardarLocal(us);
  },

  async cambiarRol(id, rol) {
    const us = await leerLocal();
    const u = us.find((x) => x.id === id);
    if (!u) throw new Error('NO_ENCONTRADO');
    u.rol = rol;
    u.descuentoMax = maxDiscountFor(rol as UserRole);
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
    // Si la ruta falla (sin llave de servicio, sin permiso) la lista sale igual, sin la marca.
    const temporales = new Set<string>(await fetch('/api/usuarios/estado')
      .then((r) => (r.ok ? r.json() : { claveTemporal: [] }))
      .then((j: { claveTemporal?: string[] }) => j.claveTemporal ?? [])
      .catch(() => []));
    return (data ?? []).map((p) => ({
      id: p.id as string,
      nombre: (p.full_name as string) || 'Sin nombre',
      email: p.email as string | null,
      rol: p.role as Rol,
      activo: Boolean(p.is_active),
      ultimaActividad: p.last_seen_at as string | null,
      descuentoMax: Number(p.max_discount_pct ?? 0),
      claveTemporal: temporales.has(p.id as string),
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

  async crearConClave(datos) {
    await llamar('/api/usuarios/crear', datos);
  },

  async restablecerClave(id, clave) {
    await llamar('/api/usuarios/clave', { id, clave });
  },

  // Con `select`: si RLS no deja, el update no da error, simplemente no toca
  // ninguna fila, y la pantalla decía "listo" sin que nada cambiara (igual que
  // en Productos, docs/21).
  async cambiarRol(id, rol) {
    const { data, error } = await supabase()
      .from('profiles')
      .update({ role: rol, max_discount_pct: await topeDescuentoDe(rol) })
      .eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('SIN_PERMISO');
  },

  async desactivar(id) {
    const { data, error } = await supabase().from('profiles').update({ is_active: false }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('SIN_PERMISO');
  },

  async reactivar(id) {
    const { data, error } = await supabase().from('profiles').update({ is_active: true }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('SIN_PERMISO');
  },
};

/** Las rutas del servidor responden { error: { code, message } }. */
async function llamar(url: string, cuerpo: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new Error('SIN_CONEXION');
  }
  if (!res.ok) {
    const r = await res.json().catch(() => ({}));
    const e = new Error(r?.error?.code ?? 'ERROR_INTERNO') as Error & { detalle?: string };
    e.detalle = r?.error?.message;
    throw e;
  }
}

export function repoUsuarios(): RepositorioUsuarios {
  return DEMO_ACTIVO ? repoLocal : repoSupabase;
}
