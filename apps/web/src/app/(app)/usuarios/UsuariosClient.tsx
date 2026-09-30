'use client';

import { useCallback, useEffect, useState } from 'react';
import { toUserMessage } from '@rutaahorro/core';
import { DEMO_ACTIVO } from '@/lib/demo';
import { repoUsuarios, type Usuario } from '@/lib/datos/usuarios';
import { NOMBRE_ROL, LEMA_ROL, type Rol } from '@/lib/navegacion';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';

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

/**
 * Una contraseña temporal fácil de dictar en el mostrador: sin letras que se
 * confunden (l/1, O/0) y con números. La persona la cambia al entrar.
 */
function claveTemporal(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const r = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return Array.from({ length: 5 }, () => r(letras)).join('') + Array.from({ length: 4 }, () => r(numeros)).join('');
}

/** Lo que el administrador tiene que decirle a la persona para que entre. */
interface Credenciales { nombre: string; email: string; clave: string; nueva: boolean }

export function UsuariosClient({ miId }: { miId: string }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [invitando, setInvitando] = useState(false);
  // Crear con contraseña temporal (lo normal) o invitar por correo.
  const [modo, setModo] = useState<'clave' | 'correo'>('clave');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<Rol>('vendedor');
  const [clave, setClave] = useState(claveTemporal);
  const [enviando, setEnviando] = useState(false);
  const [credenciales, setCredenciales] = useState<Credenciales | null>(null);
  const [restableciendo, setRestableciendo] = useState<Usuario | null>(null);
  const [claveNueva, setClaveNueva] = useState('');

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

  function mensajeDe(e: unknown): string {
    if (e instanceof Error && e.message === 'CORREO_YA_REGISTRADO') return 'Ese correo ya tiene un usuario';
    const detalle = (e as { detalle?: string })?.detalle;
    const msg = toUserMessage(e);
    // Un error del servidor que no tiene traducción trae su propio texto.
    return msg.startsWith('Ocurrió un problema') && detalle ? detalle : msg;
  }

  async function invitar() {
    setError(null);
    if (nombre.trim() === '') { setError('El nombre es obligatorio'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('El correo no es válido'); return; }
    if (modo === 'clave' && clave.trim().length < 8) { setError('La contraseña temporal necesita al menos 8 caracteres'); return; }

    setEnviando(true);
    try {
      const datos = { nombre: nombre.trim(), email: email.trim().toLowerCase(), rol };
      if (modo === 'clave') {
        await repoUsuarios().crearConClave({ ...datos, clave: clave.trim() });
        setCredenciales({ nombre: datos.nombre, email: datos.email, clave: clave.trim(), nueva: true });
      } else {
        await repoUsuarios().invitar(datos);
        setExito(`Invitación enviada a ${datos.email}`);
        setTimeout(() => setExito(null), 5000);
      }
      setInvitando(false);
      setNombre(''); setEmail(''); setRol('vendedor'); setClave(claveTemporal());
      await cargar();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  async function restablecer() {
    if (!restableciendo) return;
    setError(null);
    if (claveNueva.trim().length < 8) { setError('La contraseña temporal necesita al menos 8 caracteres'); return; }
    setEnviando(true);
    try {
      await repoUsuarios().restablecerClave(restableciendo.id, claveNueva.trim());
      setCredenciales({
        nombre: restableciendo.nombre, email: restableciendo.email ?? '', clave: claveNueva.trim(), nueva: false,
      });
      setRestableciendo(null);
    } catch (e) {
      setError(mensajeDe(e));
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
          onClick={() => { setError(null); setModo('clave'); setClave(claveTemporal()); setInvitando(true); }}
          className="tap px-4 py-2.5 rounded-xl bg-marca-500 text-white text-sm font-semibold shrink-0"
        >
          + Crear cuenta
        </button>
      </div>

      {credenciales && (
        <div role="status" className="tarjeta p-4 mb-3 border-marca-500 bg-marca-50">
          <p className="text-sm font-semibold mb-1">
            ✅ {credenciales.nueva ? `Cuenta de ${credenciales.nombre} creada` : `Contraseña temporal de ${credenciales.nombre}`}
          </p>
          <p className="text-xs text-[var(--texto-suave)] mb-2">
            Dile estos datos. Al entrar el sistema le pedirá que elija una contraseña suya.
            Esta no se vuelve a mostrar.
          </p>
          <dl className="text-sm grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <dt className="text-[var(--texto-suave)]">Correo</dt><dd className="num break-all">{credenciales.email}</dd>
            <dt className="text-[var(--texto-suave)]">Contraseña</dt><dd className="num font-bold tracking-wide">{credenciales.clave}</dd>
          </dl>
          <button onClick={() => setCredenciales(null)} className="tap mt-2 px-3 rounded-lg border border-[var(--borde)] bg-white text-sm">
            Listo, ya se la di
          </button>
        </div>
      )}

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

                  {u.activo && (
                    <button
                      onClick={() => { setError(null); setClaveNueva(claveTemporal()); setRestableciendo(u); }}
                      className="tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)]"
                    >
                      Nueva contraseña
                    </button>
                  )}

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
        <Modal
          titulo="Nueva cuenta"
          ancho="md"
          encabezado="visible"
          onCerrar={() => setInvitando(false)}
          bloqueado={enviando}
        >
          <div className="p-5 space-y-4">
            <div className="flex gap-2" role="radiogroup" aria-label="Cómo entra la persona">
              {([['clave', 'Con contraseña temporal'], ['correo', 'Invitar por correo']] as const).map(([m, t]) => (
                <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => setModo(m)}
                  className={`tap flex-1 px-2 rounded-xl text-sm border-2 ${modo === m ? 'border-marca-500 bg-marca-50 font-medium' : 'border-[var(--borde)]'}`}>
                  {t}
                </button>
              ))}
            </div>
            <p className="text-sm text-[var(--texto-suave)]">
              {modo === 'clave'
                ? 'Entra altiro con la contraseña de abajo, y al primer ingreso elige una suya. No necesita revisar el correo.'
                : 'Le llegará un correo para que cree su propia contraseña. Si el correo no llega o el enlace no abre, usa la contraseña temporal.'}
            </p>

            <Campo etiqueta="Nombre" obligatorio>
              {(p) => (
                <input
                  {...p} value={nombre} onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: Jorge Peña" autoFocus
                  className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
                />
              )}
            </Campo>

            <Campo etiqueta="Correo" obligatorio>
              {(p) => (
                <input
                  {...p} type="email" inputMode="email" autoCapitalize="none"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="jorge@correo.cl"
                  className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
                />
              )}
            </Campo>

            {/* Un grupo de radios necesita fieldset/legend: sin eso el lector de
                pantalla lee las cuatro opciones sueltas, sin decir de qué son. */}
            <fieldset>
              <legend className="block text-sm font-medium mb-1.5">Rol</legend>
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
            </fieldset>

            {modo === 'clave' && (
              <Campo etiqueta="Contraseña temporal" obligatorio ayuda="Al menos 8 caracteres. Puedes dejar la sugerida.">
                {(p) => (
                  <div className="flex gap-2">
                    <input
                      {...p} value={clave} onChange={(e) => setClave(e.target.value)}
                      autoComplete="off" autoCapitalize="none"
                      className="tap flex-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] num"
                    />
                    <button type="button" onClick={() => setClave(claveTemporal())}
                      className="tap px-3 rounded-xl border border-[var(--borde)] text-sm">Otra</button>
                  </div>
                )}
              </Campo>
            )}

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
              {enviando ? 'Guardando…' : modo === 'clave' ? 'Crear cuenta' : 'Enviar invitación'}
            </button>
            {DEMO_ACTIVO && modo === 'correo' && (
              <p className="text-xs text-[var(--texto-suave)]">En el modo demo no se envían correos: la cuenta queda con la contraseña de ejemplo.</p>
            )}
          </div>
        </Modal>
      )}

      {restableciendo && (
        <Modal
          titulo={`Nueva contraseña para ${restableciendo.nombre}`}
          encabezado="visible"
          onCerrar={() => setRestableciendo(null)}
          bloqueado={enviando}
        >
          <div className="p-5 space-y-4">
            <p className="text-sm text-[var(--texto-suave)]">
              Para quien olvidó su contraseña. La que pongas acá es temporal: al entrar, el
              sistema le pide que elija una suya.
            </p>
            <Campo etiqueta="Contraseña temporal" obligatorio>
              {(p) => (
                <div className="flex gap-2">
                  <input {...p} value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)}
                    autoComplete="off" autoCapitalize="none"
                    className="tap flex-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] num" />
                  <button type="button" onClick={() => setClaveNueva(claveTemporal())}
                    className="tap px-3 rounded-xl border border-[var(--borde)] text-sm">Otra</button>
                </div>
              )}
            </Campo>
            {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <button onClick={() => void restablecer()} disabled={enviando}
              className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
              {enviando ? 'Guardando…' : 'Poner contraseña temporal'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
