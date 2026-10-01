'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCLP, toUserMessage } from '@rutaahorro/core';
import { repoProveedores, type Proveedor, type Recepcion } from '@/lib/datos/proveedores';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { useFormatoFecha } from '@/lib/formatoFecha';
import { Encabezado } from '@/components/Encabezado';
import { Icono } from '@/components/Icono';
import { QueComprar } from './QueComprar';
import { PorPagar } from './PorPagar';
import { FormProveedor } from './FormProveedor';

const TIPO_DOC: Record<string, string> = {
  guia: 'Guía', factura: 'Factura', boleta: 'Boleta', sin_documento: 'Sin documento',
};


type Pestana = 'proveedores' | 'recepciones' | 'comprar' | 'pagar';

export function ProveedoresClient({ puedeAnular, local = '', verCostos = false, vistaInicial = 'proveedores', verPorPagar = false, avisoInicial = null }: {
  avisoInicial?: { tipo: 'ok' | 'error'; texto: string } | null;
  puedeAnular: boolean;
  /** RF-M3-13 · admin y supervisor (la tabla solo la leen ellos). */
  verPorPagar?: boolean;
  local?: string;
  verCostos?: boolean;
  vistaInicial?: Pestana;
}) {
  const { fecha } = useFormatoFecha();
  const [pestana, setPestana] = useState<Pestana>(vistaInicial);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [recepciones, setRecepciones] = useState<Recepcion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pendientesPago, setPendientesPago] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [creando, setCreando] = useState(false);
  const [anulando, setAnulando] = useState<Recepcion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [anulacionEnCurso, setAnulacionEnCurso] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

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
    if (!anulando || motivo.trim() === '' || anulacionEnCurso) return;
    // Anular devuelve stock. Sin este candado, dos toques seguidos en un
    // celular lento mandan dos anulaciones de la misma recepción.
    setAnulacionEnCurso(true);
    try {
      const { facturaYaPagada } = await repoProveedores().anularRecepcion(anulando.id, motivo.trim());
      setAviso(facturaYaPagada
        ? 'Recepción anulada. Su factura ya estaba pagada: queda como pagada; pide la nota de crédito al proveedor.'
        : 'Recepción anulada: se sacó el stock, el costo volvió al de antes y su factura por pagar (si tenía) quedó anulada.');
      setAnulando(null); setMotivo('');
      await cargar();
    } catch (e) {
      setError(toUserMessage(e));
      setAnulando(null);
    } finally {
      setAnulacionEnCurso(false);
    }
  }

  return (
    <div className="px-4 py-5">
      <Encabezado
        titulo="Compras"
        icono="proveedores"
        descripcion="Tus proveedores y lo que llega de ellos. Lo recibido entra a la bodega y actualiza el costo."
        acciones={
          <Link href="/proveedores/recepcion" prefetch={false} className="btn btn-primario btn-chico">
            <Icono nombre="agregar" tamano={16} /> Recibir mercadería
          </Link>
        }
      />

      {/* Pestañas */}
      <div className="flex gap-2 mb-4 overflow-x-auto sin-scrollbar" role="tablist">
        {([
          ['comprar', 'Qué comprar'],
          ['proveedores', `Proveedores (${proveedores.length})`],
          ['recepciones', `Recepciones (${recepciones.length})`],
          ...(verPorPagar ? [['pagar', pendientesPago == null ? 'Por pagar' : `Por pagar (${pendientesPago})`] as const] : []),
        ] as const).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={pestana === id}
            onClick={() => setPestana(id)}
            className={`tap px-4 py-2 rounded-lg text-sm border shrink-0 ${
              pestana === id
                ? 'border-marca-500 bg-marca-50 text-marca-900 font-medium'
                : 'border-[var(--borde)] bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {avisoInicial && (
        <p role={avisoInicial.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm px-3 py-2 rounded-lg mb-3 ${avisoInicial.tipo === 'error' ? 'bg-red-50 text-red-900' : 'bg-marca-100 text-marca-900'}`}>
          {avisoInicial.texto}
        </p>
      )}

      {aviso && (
        <p role="status" className="text-sm px-3 py-2 rounded-lg mb-3 bg-marca-100 text-marca-900">{aviso}</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">
          {error}
        </p>
      )}

      {pestana === 'comprar' && <QueComprar local={local} verCostos={verCostos} />}
      {verPorPagar && pestana === 'pagar' && !cargando && (
        <PorPagar proveedores={proveedores} puedeAnular={puedeAnular} onCambio={setPendientesPago} />
      )}

      {cargando && pestana !== 'comprar' && <p className="text-sm text-[var(--texto-suave)] py-6 text-center">Cargando…</p>}

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
        <Modal
          titulo="Anular recepción"
          onCerrar={() => { setAnulando(null); setMotivo(''); }}
          bloqueado={anulacionEnCurso}
        >
          <div className="p-5 space-y-3">
            <h2 className="font-semibold">Anular recepción</h2>
            <p className="text-sm text-[var(--texto-suave)]">
              Se saca del stock lo que entró, el costo promedio vuelve al de antes y,
              si tiene una factura por pagar sin pagar, se anula con ella. La recepción
              no se borra: queda registrada como anulada junto con el motivo.
            </p>
            <Campo etiqueta="Motivo" obligatorio>
              {(p) => (
                <textarea
                  {...p}
                  value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
                  placeholder="Ej: llegó menos mercadería de la facturada"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--borde)]"
                />
              )}
            </Campo>
            <div className="flex gap-2">
              <button onClick={() => { setAnulando(null); setMotivo(''); }}
                      disabled={anulacionEnCurso}
                      className="tap px-4 py-3 rounded-xl border border-[var(--borde)] disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={() => void anular()}
                disabled={motivo.trim() === '' || anulacionEnCurso}
                className="tap flex-1 py-3 rounded-xl bg-[var(--color-alerta)] text-white font-semibold disabled:opacity-40"
              >
                {anulacionEnCurso ? 'Anulando…' : 'Anular recepción'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
