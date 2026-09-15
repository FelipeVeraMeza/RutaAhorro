'use client';

import { useCallback, useEffect, useState } from 'react';
import { toUserMessage } from '@rutaahorro/core';
import { repoUsuarios, type Usuario } from '@/lib/datos/usuarios';
import { NOMBRE_ROL, LEMA_ROL, type Rol } from '@/lib/navegacion';

const ROLES: Rol[] = ['admin', 'supervisor', 'vendedor', 'bodega'];

function haceCuanto(iso: string | null): string {
  if (!iso) return 'Nunca ha entrado';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return 'Ahora';
  if (min < 60) return `Hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.floor(h / 24)} d`;
}

/** Conectado = actividad en los últimos 5 minutos (RF-M1-14). */
function estaConectado(iso: string | null): boolean {
  return iso !== null && Date.now() - new Date(iso).getTime() < 5 * 60000;
}

export function UsuariosClient({ miId }: { miId: string }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [invitando, setInvitando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<Rol>('vendedor');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setUsuarios(await repoUsuarios().listar());
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function invitar() {
    setError(null);
    if (nombre.trim() === '') { setError('El nombre es obligatorio'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('El correo no es válido'); return; }

    setEnviando(true);
    try {
      await repoUsuarios().invitar({ nombre: nombre.trim(), email: email.trim(), rol });
      setExito(`Invitación enviada a ${email.trim()}`);
      setInvitando(false);
      setNombre(''); setEmail(''); setRol('vendedor');
      await cargar();
      setTimeout(() => setExito(null), 5000);
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'CORREO_YA_REGISTRADO'
          ? 'Ese correo ya tiene un usuario en el local'
          : toUserMessage(e),
      );
    } finally {
      setEnviando(false);
    }
  }

  async function accion(fn: () => Promise<void>) {
    setError(null);
    try { await fn(); await cargar(); }
    catch (e) { setError(toUserMessage(e)); }
  }

  const conectados = usuarios.filter((u) => u.activo && estaConectado(u.ultimaActividad)).length;

  return (
    <div className="px-4 py-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold">Usuarios</h1>
          <p className="text-sm text-[var(--texto-suave)]">
            {cargando ? 'Cargando…' : `${usuarios.filter((u) => u.activo).length} activos · ${conectados} conectados ahora`}
          </p>
        </div>
        <button
          onClick={() => setInvitando(true)}
          className="tap px-4 py-2.5 rounded-xl bg-marca-500 text-white text-sm font-semibold shrink-0"
        >
          + Invitar
        </button>
      </div>

      {exito && (
        <p role="status" className="text-sm bg-marca-50 text-marca-900 px-3 py-2 rounded-lg mb-3">
          ✅ {exito}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">
          {error}
        </p>
      )}

      <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
        {usuarios.map((u) => {
          const online = u.activo && estaConectado(u.ultimaActividad);
          const soyYo = u.id === miId;
          return (
            <li key={u.id} className={`px-4 py-3 ${!u.activo ? 'opacity-55' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {u.nombre}
                    {soyYo && <span className="text-[var(--texto-suave)] font-normal"> · tú</span>}
                  </p>
                  <p className="text-xs text-[var(--texto-suave)] truncate">{u.email ?? 'sin correo'}</p>
                  <p className="text-xs mt-0.5">
                    {/* Estado con icono + texto, nunca solo color (RNF-46) */}
                    <span className={online ? 'text-marca-700' : 'text-[var(--texto-suave)]'}>
                      {online ? '🟢 Conectado' : '⚪ Desconectado'}
                    </span>
                    <span className="text-[var(--texto-suave)]"> · {haceCuanto(u.ultimaActividad)}</span>
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <span className="inline-block px-2.5 py-1 rounded-full bg-[var(--fondo)] text-xs font-medium">
                    {NOMBRE_ROL[u.rol]}
                  </span>
                  {!u.activo && (
                    <span className="block text-[11px] text-[var(--color-alerta)] mt-1">desactivado</span>
                  )}
                </div>
              </div>

              {/* Nadie puede cambiarse el rol ni desactivarse a sí mismo: un
                  admin que se quita el rol deja el local sin administrador. */}
              {!soyYo && (
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  <select
                    value={u.rol}
                    onChange={(e) => void accion(() => repoUsuarios().cambiarRol(u.id, e.target.value as Rol))}
                    className="tap px-2.5 py-1.5 rounded-lg border border-[var(--borde)] bg-white text-xs"
                    aria-label={`Rol de ${u.nombre}`}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{NOMBRE_ROL[r]} · {LEMA_ROL[r]}</option>
                    ))}
                  </select>

                  <button
                    onClick={() => void accion(() =>
                      u.activo ? repoUsuarios().desactivar(u.id) : repoUsuarios().reactivar(u.id),
                    )}
                    className={`tap px-3 py-1.5 text-xs rounded-lg border ${
                      u.activo
                        ? 'border-[var(--borde)] text-[var(--color-alerta)]'
                        : 'border-marca-500 text-marca-700'
                    }`}
                  >
                    {u.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-[var(--texto-suave)] mt-4 leading-relaxed">
        Desactivar no borra: las ventas del trabajador siguen visibles y atribuidas a
        su nombre. Eso es lo que permite investigar una diferencia meses después.
      </p>

      {/* Invitación */}
      {invitando && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
          <div
            className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Invitar empleado</h2>
              <button onClick={() => setInvitando(false)} className="tap px-3 text-sm text-[var(--texto-suave)]">
                Cancelar
              </button>
            </div>

            <p className="text-sm text-[var(--texto-suave)]">
              Le llegará un correo para que cree su propia contraseña.
              Tú nunca la conocerás.
            </p>

            <div>
              <label htmlFor="nom" className="block text-sm font-medium mb-1.5">Nombre</label>
              <input
                id="nom" value={nombre} onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Jorge Peña"
                className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
              />
            </div>

            <div>
              <label htmlFor="mail" className="block text-sm font-medium mb-1.5">Correo</label>
              <input
                id="mail" type="email" inputMode="email" autoCapitalize="none"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="jorge@correo.cl"
                className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
              />
            </div>

            <div>
              <span className="block text-sm font-medium mb-1.5">Rol</span>
              <div className="space-y-2">
                {ROLES.map((r) => (
                  <label
                    key={r}
                    className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer ${
                      rol === r ? 'border-marca-500 bg-marca-50' : 'border-[var(--borde)]'
                    }`}
                  >
                    <input
                      type="radio" name="rol" value={r} checked={rol === r}
                      onChange={() => setRol(r)}
                      className="mt-0.5 w-4 h-4 accent-[var(--color-marca-500)]"
                    />
                    <span className="text-sm">
                      <strong className="block">{NOMBRE_ROL[r]}</strong>
                      <span className="text-[var(--texto-suave)]">{LEMA_ROL[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <button
              onClick={() => void invitar()}
              disabled={enviando}
              className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50"
            >
              {enviando ? 'Enviando…' : 'Enviar invitación'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
