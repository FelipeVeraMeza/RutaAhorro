'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCLP, isValidRut, formatRut, toUserMessage } from '@rutaahorro/core';
import { repoProveedores, type Proveedor, type Recepcion } from '@/lib/datos/proveedores';

const TIPO_DOC: Record<string, string> = {
  guia: 'Guía', factura: 'Factura', boleta: 'Boleta', sin_documento: 'Sin documento',
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', timeZone: 'America/Santiago' });

export function ProveedoresClient({ puedeAnular }: { puedeAnular: boolean }) {
  const [pestana, setPestana] = useState<'proveedores' | 'recepciones'>('proveedores');
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [recepciones, setRecepciones] = useState<Recepcion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [creando, setCreando] = useState(false);
  const [anulando, setAnulando] = useState<Recepcion | null>(null);
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const repo = repoProveedores();
      const [ps, rs] = await Promise.all([repo.listar(), repo.recepciones()]);
      setProveedores(ps);
      setRecepciones(rs);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function anular() {
    if (!anulando || motivo.trim() === '') return;
    try {
      await repoProveedores().anularRecepcion(anulando.id, motivo.trim());
      setAnulando(null); setMotivo('');
      await cargar();
    } catch (e) {
      setError(toUserMessage(e));
      setAnulando(null);
    }
  }

  return (
    <div className="px-4 py-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold">Compras</h1>
        <Link
          href="/proveedores/recepcion"
          className="tap px-4 py-2.5 rounded-xl bg-marca-500 text-white text-sm font-semibold shrink-0"
        >
          + Recepción
        </Link>
      </div>

      {/* Pestañas */}
      <div className="flex gap-2 mb-4" role="tablist">
        {([
          ['proveedores', `Proveedores (${proveedores.length})`],
          ['recepciones', `Recepciones (${recepciones.length})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={pestana === id}
            onClick={() => setPestana(id)}
            className={`tap px-4 py-2 rounded-lg text-sm border ${
              pestana === id
                ? 'border-marca-500 bg-marca-50 text-marca-900 font-medium'
                : 'border-[var(--borde)] bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">
          {error}
        </p>
      )}

      {cargando && <p className="text-sm text-[var(--texto-suave)] py-6 text-center">Cargando…</p>}

      {/* Proveedores */}
      {!cargando && pestana === 'proveedores' && (
        <>
          <button
            onClick={() => setCreando(true)}
            className="tap w-full mb-3 py-3 rounded-xl border border-dashed border-[var(--borde)] text-sm font-medium"
          >
            + Agregar proveedor
          </button>

          {proveedores.length === 0 ? (
            <p className="text-center text-sm text-[var(--texto-suave)] py-8">
              Aún no hay proveedores registrados
            </p>
          ) : (
            <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
              {proveedores.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.nombre}</p>
                      <p className="text-xs text-[var(--texto-suave)]">
                        {p.rut ?? 'sin RUT'}
                        {p.contacto && ` · ${p.contacto}`}
                      </p>
                      {(p.telefono || p.email) && (
                        <p className="text-xs text-[var(--texto-suave)] truncate">
                          {p.telefono}{p.telefono && p.email && ' · '}{p.email}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setEditando(p)}
                      className="tap px-3 py-1.5 text-xs rounded-lg border border-[var(--borde)] shrink-0"
                    >
                      Editar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Recepciones */}
      {!cargando && pestana === 'recepciones' && (
        recepciones.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-4xl mb-3" aria-hidden>🚚</p>
            <p className="text-sm text-[var(--texto-suave)] mb-4">
              Aún no has registrado recepciones de mercadería
            </p>
            <Link href="/proveedores/recepcion" className="tap inline-flex px-5 py-3 rounded-xl bg-marca-500 text-white font-semibold text-sm">
              Registrar la primera
            </Link>
          </div>
        ) : (
          <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden">
            {recepciones.map((r) => (
              <li key={r.id} className={`px-4 py-3 ${r.estado === 'anulada' ? 'opacity-55' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {r.proveedorNombre ?? 'Sin proveedor'}
                      {r.estado === 'anulada' && (
                        <span className="text-[var(--color-alerta)] font-normal"> · anulada</span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--texto-suave)]">
                      {TIPO_DOC[r.tipoDocumento] ?? r.tipoDocumento}
                      {r.documento && ` ${r.documento}`}
                      {' · '}{fecha(r.fecha)}
                      {' · '}{r.lineas} {r.lineas === 1 ? 'producto' : 'productos'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="num font-semibold">{formatCLP(r.total)}</p>
                    {puedeAnular && r.estado === 'confirmada' && (
                      <button
                        onClick={() => setAnulando(r)}
                        className="tap mt-1 px-3 py-1 text-xs rounded-lg border border-[var(--borde)] text-[var(--color-alerta)]"
                      >
                        Anular
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {(creando || editando) && (
        <FormProveedor
          proveedor={editando}
          onGuardado={() => { setCreando(false); setEditando(null); void cargar(); }}
          onCancelar={() => { setCreando(false); setEditando(null); }}
        />
      )}

      {anulando && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
          <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
               style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
            <h2 className="font-semibold">Anular recepción</h2>
            <p className="text-sm text-[var(--texto-suave)]">
              Se devolverá el stock al valor anterior. La recepción no se borra: queda
              registrada como anulada junto con el motivo.
            </p>
            <textarea
              value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
              placeholder="Motivo (obligatorio)"
              className="w-full px-3 py-2 rounded-xl border border-[var(--borde)]"
            />
            <div className="flex gap-2">
              <button onClick={() => { setAnulando(null); setMotivo(''); }}
                      className="tap px-4 py-3 rounded-xl border border-[var(--borde)]">
                Cancelar
              </button>
              <button
                onClick={() => void anular()}
                disabled={motivo.trim() === ''}
                className="tap flex-1 py-3 rounded-xl bg-[var(--color-alerta)] text-white font-semibold disabled:opacity-40"
              >
                Anular recepción
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormProveedor({
  proveedor, onGuardado, onCancelar,
}: {
  proveedor: Proveedor | null;
  onGuardado: () => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '');
  const [rut, setRut] = useState(proveedor?.rut ?? '');
  const [contacto, setContacto] = useState(proveedor?.contacto ?? '');
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '');
  const [email, setEmail] = useState(proveedor?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const rutValido = rut.trim() === '' || isValidRut(rut);

  async function guardar() {
    setError(null);
    if (nombre.trim() === '') { setError('El nombre es obligatorio'); return; }
    if (!rutValido) { setError('El RUT no es válido'); return; }

    setGuardando(true);
    try {
      const datos = {
        nombre: nombre.trim(),
        rut: rut.trim() ? formatRut(rut) : null,
        contacto: contacto.trim() || null,
        telefono: telefono.trim() || null,
        email: email.trim() || null,
      };
      if (proveedor) await repoProveedores().actualizar(proveedor.id, datos);
      else await repoProveedores().crear(datos);
      onGuardado();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center overflow-y-auto" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
           style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{proveedor ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
          <button onClick={onCancelar} className="tap px-3 text-sm text-[var(--texto-suave)]">Cancelar</button>
        </div>

        <input value={nombre} onChange={(e) => setNombre(e.target.value)}
               placeholder="Nombre o razón social *" autoFocus
               className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />

        <div>
          <input value={rut} onChange={(e) => setRut(e.target.value)}
                 placeholder="RUT (opcional)"
                 className={`tap w-full px-3 py-2.5 rounded-xl border ${
                   rutValido ? 'border-[var(--borde)]' : 'border-[var(--color-alerta)]'
                 }`} />
          {!rutValido && (
            <p className="text-xs text-[var(--color-alerta)] mt-1">
              El dígito verificador no cuadra
            </p>
          )}
        </div>

        <input value={contacto} onChange={(e) => setContacto(e.target.value)}
               placeholder="Persona de contacto"
               className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />
        <input value={telefono} onChange={(e) => setTelefono(e.target.value)}
               inputMode="tel" placeholder="Teléfono"
               className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />
        <input value={email} onChange={(e) => setEmail(e.target.value)}
               inputMode="email" autoCapitalize="none" placeholder="Correo"
               className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]" />

        {error && (
          <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button onClick={() => void guardar()} disabled={guardando}
                className="tap w-full py-3.5 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : proveedor ? 'Guardar cambios' : 'Crear proveedor'}
        </button>
      </div>
    </div>
  );
}
