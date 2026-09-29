'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCLP, formatCantidad, toUserMessage, validarCantidad, diaLocal } from '@rutaahorro/core';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { useFormatoFecha, diaCorto } from '@/lib/formatoFecha';
import { repoFacturacion, type Factura } from '@/lib/datos/facturacion';
import dynamic from 'next/dynamic';
// El visor trae el generador del timbre PDF417 (~250 kB): se baja recién al
// tocar "Ver factura", no al abrir Facturación.
const DocumentoTributario = dynamic(() => import('../ventas/DocumentoYDevolucion').then((m) => m.DocumentoTributario));
import { NuevaFactura, type BaseFactura } from './NuevaFactura';
import { Recibidas } from './Recibidas';
import { Resumen } from './Resumen';
import { EmisorSii } from './EmisorSii';

type Pestana = 'emitidas' | 'nueva' | 'recibidas' | 'resumen' | 'sii';

/**
 * Facturación (0026), para admin y supervisor.
 *
 * La boleta sigue saliendo del POS; acá se hace la factura "de oficina": a
 * una empresa, con productos del catálogo (descuentan stock) y líneas libres
 * (flete, servicio), editable hasta que se emite. Después no se edita: se
 * corrige con nota de crédito, como exige el SII.
 */
export function FacturacionClient({ esAdmin, usuarioId }: { esAdmin: boolean; usuarioId: string }) {
  const { zona } = useFormatoFecha();
  const [pestana, setPestana] = useState<Pestana>('emitidas');
  const [mes, setMes] = useState(() => diaLocal(new Date(), zona).slice(0, 7));
  const [base, setBase] = useState<BaseFactura | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const meses = useMemo(() => {
    const hoy = diaLocal(new Date(), zona);
    let [a, m] = hoy.split('-').map(Number);
    const lista: Array<{ valor: string; texto: string }> = [];
    for (let i = 0; i < 18; i++) {
      const valor = `${a}-${String(m).padStart(2, '0')}`;
      const texto = new Date(a, m - 1, 15).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
      lista.push({ valor, texto });
      m -= 1;
      if (m === 0) { m = 12; a -= 1; }
    }
    return lista;
  }, [zona]);

  const pestanas: Array<[Pestana, string]> = [
    ['emitidas', 'Emitidas'], ['nueva', '+ Nueva'], ['recibidas', 'Recibidas'], ['resumen', 'Resumen'],
    ...(esAdmin ? [['sii', 'Emisor SII'] as [Pestana, string]] : []),
  ];

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-lg font-semibold">Facturación</h1>
          <p className="text-xs text-[var(--texto-suave)]">Facturas a empresas, compras y el resumen del mes</p>
        </div>
      </div>

      <div role="tablist" aria-label="Secciones de facturación" className="flex gap-2 overflow-x-auto sin-scrollbar pb-1 mb-3">
        {pestanas.map(([id, texto]) => (
          <button key={id} role="tab" aria-selected={pestana === id} onClick={() => setPestana(id)}
                  className={`tap px-3 rounded-lg text-sm shrink-0 border ${pestana === id
                    ? 'border-marca-500 bg-marca-50 text-marca-900 font-semibold' : 'border-[var(--borde)] bg-white'}`}>
            {texto}
          </button>
        ))}
      </div>

      {(pestana === 'emitidas' || pestana === 'recibidas') && (
        <label className="flex items-center gap-2 mb-3 text-sm">
          <span className="text-[var(--texto-suave)]">Mes</span>
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes"
                  className="tap flex-1 px-3 rounded-lg border border-[var(--borde)] bg-white">
            {meses.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
          </select>
        </label>
      )}

      {aviso && (
        <p role="status" className="mb-3 text-sm px-3 py-2 rounded-lg bg-marca-100 text-marca-900 flex items-center justify-between gap-2">
          <span>✓ {aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="tap -my-2 -mr-2 font-bold">×</button>
        </p>
      )}

      {pestana === 'emitidas' && (
        <Emitidas mes={mes} onUsarComoBase={(b) => { setBase(b); setPestana('nueva'); }} />
      )}
      {pestana === 'nueva' && (
        <NuevaFactura
          usuarioId={usuarioId}
          base={base}
          onEmitida={(f) => {
            setBase(null);
            setAviso(f.estado === 'emitida'
              ? `Factura N° ${f.folio} emitida a ${f.receptor.razon_social} por ${formatCLP(f.total)}`
              : `Factura interna N° ${f.numero} en cola para el SII`);
            setMes(f.fechaEmision.slice(0, 7));
            setPestana('emitidas');
          }}
        />
      )}
      {pestana === 'recibidas' && <Recibidas mes={mes} />}
      {pestana === 'resumen' && <Resumen />}
      {pestana === 'sii' && esAdmin && <EmisorSii />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function estadoDe(f: Factura): { texto: string; clase: string } {
  const anulada = f.lineas.every((l) => l.devuelto >= l.cantidad);
  if (f.estado === 'emitida' && anulada) return { texto: 'Anulada con nota de crédito', clase: 'bg-gray-100 text-gray-700' };
  switch (f.estado) {
    case 'emitida':
      return f.modo === 'simulacion'
        ? { texto: 'Emitida · simulada', clase: 'bg-amber-50 text-amber-900' }
        : { texto: 'Emitida en el SII', clase: 'bg-marca-100 text-marca-900' };
    case 'por_emitir': return { texto: 'En cola para el SII', clase: 'bg-blue-50 text-blue-900' };
    case 'emitiendo': return { texto: 'Emitiéndose en el SII…', clase: 'bg-blue-50 text-blue-900' };
    case 'error': return { texto: 'No se emitió', clase: 'bg-red-50 text-red-900' };
    default: return { texto: 'Descartada', clase: 'bg-gray-100 text-gray-700' };
  }
}

function Emitidas({ mes, onUsarComoBase }: { mes: string; onUsarComoBase: (b: BaseFactura) => void }) {
  const [facturas, setFacturas] = useState<Factura[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viendo, setViendo] = useState<{ f: Factura; dte: NonNullable<Factura['dte']> } | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<Factura | null>(null);
  const [descartando, setDescartando] = useState<Factura | null>(null);

  const cargar = useCallback(async () => {
    try {
      setFacturas(await repoFacturacion().emitidas(mes));
      setError(null);
    } catch (e) {
      setError(toUserMessage(e));
    }
  }, [mes]);
  useEffect(() => { setFacturas(null); void cargar(); }, [cargar]);

  // Mientras hay algo en la cola del SII, se mira cada 15 s cómo va.
  const enCola = (facturas ?? []).some((f) => f.estado === 'por_emitir' || f.estado === 'emitiendo');
  useEffect(() => {
    if (!enCola) return;
    const t = window.setInterval(() => void cargar(), 15_000);
    return () => window.clearInterval(t);
  }, [enCola, cargar]);

  async function reintentar(f: Factura) {
    try { await repoFacturacion().reintentar(f.id); await cargar(); } catch (e) { setError(toUserMessage(e)); }
  }

  if (error) return <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>;
  if (!facturas) return <p className="text-sm text-[var(--texto-suave)] py-8 text-center" aria-busy="true">Cargando…</p>;
  if (facturas.length === 0) {
    return <p className="text-sm text-[var(--texto-suave)] py-10 text-center">No hay facturas emitidas en este mes.</p>;
  }

  const totalMes = facturas.filter((f) => f.estado === 'emitida')
    .reduce((s, f) => s + f.total - f.notasCredito.reduce((a, n) => a + n.monto, 0), 0);

  return (
    <>
      <p className="text-xs text-[var(--texto-suave)] mb-2">
        {facturas.length} {facturas.length === 1 ? 'factura' : 'facturas'} · facturado neto de notas de crédito:{' '}
        <strong className="num text-[var(--texto)]">{formatCLP(totalMes)}</strong>
      </p>
      <ul className="space-y-2">
        {facturas.map((f) => {
          const est = estadoDe(f);
          const quedan = f.lineas.some((l) => l.devuelto < l.cantidad);
          return (
            <li key={f.id} className="tarjeta p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {f.folio ? `Factura N° ${f.folio}` : `Factura interna N° ${f.numero}`}
                  </p>
                  <p className="text-sm truncate">{f.receptor.razon_social}</p>
                  <p className="text-xs text-[var(--texto-suave)]">
                    RUT {f.receptor.rut} · {diaCorto(f.fechaEmision)} · {f.formaPago === 'credito' ? 'crédito' : 'contado'}
                  </p>
                </div>
                <p className="num font-semibold whitespace-nowrap">{formatCLP(f.total)}</p>
              </div>
              <p className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${est.clase}`}>{est.texto}</p>
              {f.estado === 'error' && f.ultimoError && (
                <p className="text-xs text-[var(--color-alerta)] mt-1">{f.ultimoError}</p>
              )}
              {f.notasCredito.map((n) => (
                <p key={n.id} className="text-xs text-[var(--texto-suave)] mt-1">
                  Nota de crédito N° {n.dte?.folio ?? n.numero} por {formatCLP(n.monto)} · {n.motivo}
                </p>
              ))}
              <div className="flex flex-wrap gap-2 mt-2">
                {f.dte && (
                  <button onClick={() => setViendo({ f, dte: f.dte! })}
                          className="tap px-3 rounded-lg border border-[var(--borde)] text-sm">Ver factura</button>
                )}
                {f.notasCredito.filter((n) => n.dte).map((n) => (
                  <button key={n.id} onClick={() => setViendo({ f, dte: n.dte! })}
                          className="tap px-3 rounded-lg border border-[var(--borde)] text-sm">Ver nota N° {n.dte!.folio}</button>
                ))}
                {f.estado === 'emitida' && f.modo === 'simulacion' && quedan && (
                  <button onClick={() => setCorrigiendo(f)}
                          className="tap px-3 rounded-lg border border-[var(--borde)] text-sm">Nota de crédito</button>
                )}
                {f.estado === 'error' && (
                  <button onClick={() => void reintentar(f)}
                          className="tap px-3 rounded-lg border border-[var(--borde)] text-sm">Reintentar</button>
                )}
                {(f.estado === 'error' || f.estado === 'por_emitir') && (
                  <button onClick={() => setDescartando(f)}
                          className="tap px-3 rounded-lg border border-[var(--borde)] text-sm text-[var(--color-alerta)]">Descartar</button>
                )}
                <button
                  onClick={() => onUsarComoBase({
                    clienteId: null, receptor: f.receptor, formaPago: f.formaPago, observaciones: f.observaciones,
                    lineas: f.lineas.map((l) => ({ productId: l.productId, nombre: l.nombre, descripcion: l.descripcion,
                      unidad: l.unidad, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento, tasa: l.tasa })),
                  })}
                  className="tap px-3 rounded-lg border border-[var(--borde)] text-sm">
                  Usar como base
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {viendo && (
        <DocumentoTributario doc={viendo.dte} onCerrar={() => setViendo(null)}
                             pdfUrl={viendo.f.tienePdf ? `/api/facturacion/pdf?id=${viendo.f.id}` : null} />
      )}
      {corrigiendo && (
        <NotaCreditoFactura factura={corrigiendo} onCerrar={() => setCorrigiendo(null)}
                            onHecho={() => { setCorrigiendo(null); void cargar(); }} />
      )}
      {descartando && (
        <DescartarFactura factura={descartando} onCerrar={() => setDescartando(null)}
                          onHecho={() => { setDescartando(null); void cargar(); }} />
      )}
    </>
  );
}

const MOTIVOS_NC = ['Devolución de mercadería', 'Error en el precio', 'Error en la cantidad', 'Anula la factura: error en el receptor'];

/** Nota de crédito total o parcial de una factura manual (0026). */
function NotaCreditoFactura({ factura, onCerrar, onHecho }: { factura: Factura; onCerrar: () => void; onHecho: () => void }) {
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendientes = factura.lineas.filter((l) => l.devuelto < l.cantidad);

  const pedido = pendientes.map((l) => {
    const v = validarCantidad(cantidades[l.id] ?? '', { permiteVacio: true, maximo: l.cantidad - l.devuelto });
    return { l, v };
  });
  const invalida = pedido.find((p) => !p.v.valido);
  const items = pedido.filter((p) => p.v.valido && p.v.valor > 0).map((p) => ({ lineaId: p.l.id, cantidad: p.v.valor }));
  // Proporcional a lo cobrado, como la base (la base manda si difiere en un peso).
  const suma = factura.lineas.reduce((s, l) => s + l.monto, 0);
  const estimado = items.reduce((s, i) => {
    const l = factura.lineas.find((x) => x.id === i.lineaId)!;
    return s + Math.round((i.cantidad * l.monto * factura.total) / (l.cantidad * suma));
  }, 0);

  async function emitir(todo: boolean) {
    setError(null);
    if (!motivo.trim()) { setError('Escribe el motivo: va impreso en la nota de crédito'); return; }
    if (!todo && items.length === 0) { setError('Indica cuánto se devuelve de al menos una línea'); return; }
    setGuardando(true);
    try {
      await repoFacturacion().notaCredito(factura.id, todo ? null : items, motivo.trim());
      onHecho();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Nota de crédito · Factura N° ${factura.folio}`} encabezado="visible" onCerrar={onCerrar} bloqueado={guardando} ancho="md">
      <div className="p-4 space-y-3">
        <p className="text-sm text-[var(--texto-suave)]">
          Lo que es del catálogo vuelve al stock (a la sala, y a los lotes de donde salió). La factura no se edita: la nota
          de crédito la corrige.
        </p>
        <ul className="divide-y divide-[var(--borde)] tarjeta">
          {pendientes.map((l) => (
            <li key={l.id} className="p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{l.nombre}</p>
                <p className="text-xs text-[var(--texto-suave)] num">
                  Facturado {formatCantidad(l.cantidad)}{l.devuelto > 0 ? ` · ya devuelto ${formatCantidad(l.devuelto)}` : ''}
                  {!l.productId && ' · línea libre'}
                </p>
              </div>
              <input
                inputMode="decimal" value={cantidades[l.id] ?? ''} placeholder="0"
                onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: e.target.value }))}
                aria-label={`Cantidad a devolver de ${l.nombre}`}
                className="tap w-20 px-2 rounded-lg border border-[var(--borde)] text-center num" />
            </li>
          ))}
        </ul>
        {invalida && <p role="alert" className="text-xs text-[var(--color-alerta)]">{invalida.l.nombre}: {invalida.v.error}</p>}
        <Campo etiqueta="Motivo" obligatorio ayuda="Va impreso en la nota de crédito.">
          {(p) => (
            <>
              <input {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} list="motivos-nc" maxLength={90}
                     className="tap w-full px-3 rounded-xl border border-[var(--borde)]" />
              <datalist id="motivos-nc">{MOTIVOS_NC.map((m) => <option key={m} value={m} />)}</datalist>
            </>
          )}
        </Campo>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <button onClick={() => void emitir(false)} disabled={guardando || items.length === 0}
                className="tap w-full rounded-xl bg-marca-500 text-white font-semibold disabled:opacity-50">
          {guardando ? 'Emitiendo…' : `Emitir nota por lo marcado${estimado ? ` (${formatCLP(estimado)})` : ''}`}
        </button>
        <button onClick={() => void emitir(true)} disabled={guardando}
                className="tap w-full rounded-xl border border-[var(--color-alerta)] text-[var(--color-alerta)] font-semibold disabled:opacity-50">
          Anular todo lo que queda de la factura
        </button>
      </div>
    </Modal>
  );
}

/** Una factura que nunca llegó al SII se descarta: el stock vuelve y no queda documento. */
function DescartarFactura({ factura, onCerrar, onHecho }: { factura: Factura; onCerrar: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function descartar() {
    if (!motivo.trim()) { setError('Escribe por qué se descarta'); return; }
    setGuardando(true);
    try { await repoFacturacion().descartar(factura.id, motivo.trim()); onHecho(); }
    catch (e) { setError(toUserMessage(e)); }
    finally { setGuardando(false); }
  }
  return (
    <Modal titulo={`Descartar la factura interna N° ${factura.numero}`} encabezado="visible" onCerrar={onCerrar} bloqueado={guardando}>
      <div className="p-4 space-y-3">
        <p className="text-sm">
          No llegó al SII, así que no hay documento que anular: se descarta y lo del catálogo vuelve al stock.
        </p>
        {factura.estado === 'error' && (
          <p className="text-sm bg-amber-50 text-amber-900 px-3 py-2 rounded-lg">
            Si el error dice que se apretó “Firmar”, revisa primero en el portal del SII si la factura se emitió.
          </p>
        )}
        <Campo etiqueta="Motivo" obligatorio>
          {(p) => <input {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                         className="tap w-full px-3 rounded-xl border border-[var(--borde)]" />}
        </Campo>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void descartar()} disabled={guardando}
                className="tap w-full rounded-xl bg-[var(--color-alerta)] text-white font-semibold disabled:opacity-50">
          {guardando ? 'Descartando…' : 'Descartar y devolver el stock'}
        </button>
      </div>
    </Modal>
  );
}
