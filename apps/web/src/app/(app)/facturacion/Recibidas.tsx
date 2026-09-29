'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCLP, toUserMessage, validarMonto, isValidRut, formatRut, diaLocal } from '@rutaahorro/core';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { useFormatoFecha, diaCorto } from '@/lib/formatoFecha';
import { repoProveedores, type Proveedor } from '@/lib/datos/proveedores';
import { repoFacturacion, type FacturaRecibida, type TipoRecibida } from '@/lib/datos/facturacion';

const TIPOS: Array<[TipoRecibida, string]> = [
  [33, 'Factura'], [34, 'Factura exenta'], [61, 'Nota de crédito'], [56, 'Nota de débito'], [46, 'Factura de compra'],
];
const nombreTipo = (t: number) => TIPOS.find(([x]) => x === t)?.[1] ?? `Tipo ${t}`;
const soloRut = (r: string | null | undefined) => (r ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/**
 * Facturas de proveedores (libro de compras, 0026). El IVA de estas es el
 * crédito fiscal que se descuenta del IVA de las ventas en el F29. Un
 * proveedor nuevo se crea solo; uno que ya existe se autocompleta por RUT.
 */
export function Recibidas({ mes }: { mes: string }) {
  const [lista, setLista] = useState<FacturaRecibida[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [anulando, setAnulando] = useState<FacturaRecibida | null>(null);

  const cargar = useCallback(async () => {
    try { setLista(await repoFacturacion().recibidas(mes)); setError(null); }
    catch (e) { setError(toUserMessage(e)); }
  }, [mes]);
  useEffect(() => { setLista(null); void cargar(); }, [cargar]);

  const vigentes = (lista ?? []).filter((r) => r.estado === 'vigente');
  const signo = (r: FacturaRecibida) => (r.tipo === 61 ? -1 : 1);
  const ivaMes = vigentes.reduce((s, r) => s + signo(r) * r.iva, 0);
  const totalMes = vigentes.reduce((s, r) => s + signo(r) * r.total, 0);

  return (
    <>
      <button onClick={() => setRegistrando(true)}
              className="tap w-full mb-3 rounded-xl bg-marca-500 text-white font-semibold">
        + Registrar factura recibida
      </button>
      {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>}
      {!lista && !error && <p className="text-sm text-[var(--texto-suave)] py-8 text-center" aria-busy="true">Cargando…</p>}
      {lista && lista.length === 0 && (
        <p className="text-sm text-[var(--texto-suave)] py-8 text-center">No hay facturas de proveedores registradas en este mes.</p>
      )}
      {lista && lista.length > 0 && (
        <>
          <p className="text-xs text-[var(--texto-suave)] mb-2">
            Compras del mes: <strong className="num text-[var(--texto)]">{formatCLP(totalMes)}</strong> · IVA crédito{' '}
            <strong className="num text-[var(--texto)]">{formatCLP(ivaMes)}</strong>
          </p>
          <ul className="space-y-2">
            {lista.map((r) => (
              <li key={r.id} className={`tarjeta p-3 ${r.estado === 'anulada' ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{nombreTipo(r.tipo)} N° {r.folio}</p>
                    <p className="text-sm truncate">{r.razonSocial}</p>
                    <p className="text-xs text-[var(--texto-suave)]">RUT {r.rutEmisor} · {diaCorto(r.fechaEmision)}</p>
                  </div>
                  <p className="num font-semibold whitespace-nowrap">{r.tipo === 61 ? '−' : ''}{formatCLP(r.total)}</p>
                </div>
                <p className="text-xs text-[var(--texto-suave)] num mt-1">
                  Neto {formatCLP(r.neto)}{r.exento ? ` · exento ${formatCLP(r.exento)}` : ''} · IVA {formatCLP(r.iva)}
                  {r.otrosImpuestos ? ` · otros ${formatCLP(r.otrosImpuestos)}` : ''}
                </p>
                {r.estado === 'anulada'
                  ? <p className="text-xs mt-1">Anulada: {r.anuladaMotivo}</p>
                  : (
                    <button onClick={() => setAnulando(r)}
                            className="tap mt-2 px-3 rounded-lg border border-[var(--borde)] text-sm text-[var(--color-alerta)]">
                      Anular registro
                    </button>
                  )}
              </li>
            ))}
          </ul>
        </>
      )}
      {registrando && <RegistrarRecibida onCerrar={() => setRegistrando(false)} onHecho={() => { setRegistrando(false); void cargar(); }} />}
      {anulando && <AnularRecibida r={anulando} onCerrar={() => setAnulando(null)} onHecho={() => { setAnulando(null); void cargar(); }} />}
    </>
  );
}

function RegistrarRecibida({ onCerrar, onHecho }: { onCerrar: () => void; onHecho: () => void }) {
  const { zona } = useFormatoFecha();
  const hoy = diaLocal(new Date(), zona);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [rut, setRut] = useState('');
  const [razon, setRazon] = useState('');
  const [tipo, setTipo] = useState<TipoRecibida>(33);
  const [folio, setFolio] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [neto, setNeto] = useState('');
  const [exento, setExento] = useState('');
  const [iva, setIva] = useState('');
  const [ivaEditado, setIvaEditado] = useState(false);
  const [otros, setOtros] = useState('');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void repoProveedores().listar().then(setProveedores).catch(() => {}); }, []);

  const vNeto = validarMonto(neto, { etiqueta: 'neto', permiteVacio: true });
  const vExento = validarMonto(exento, { etiqueta: 'exento', permiteVacio: true });
  const vOtros = validarMonto(otros, { etiqueta: 'otros impuestos', permiteVacio: true });
  // El IVA se propone (19 % del neto) y se puede corregir: se copia del papel.
  const ivaPropuesto = tipo === 34 ? 0 : Math.round(vNeto.valor * 0.19);
  const vIva = validarMonto(ivaEditado ? iva : String(ivaPropuesto), { etiqueta: 'IVA', permiteVacio: true });
  const total = vNeto.valor + vExento.valor + vIva.valor + vOtros.valor;
  const vFolio = Number(folio.replace(/\D/g, ''));

  const sugerencias = useMemo(() => {
    const q = razon.trim().toLowerCase();
    if (supplierId || q.length < 2) return [];
    return proveedores.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 5);
  }, [razon, proveedores, supplierId]);

  function elegir(p: Proveedor) {
    setSupplierId(p.id);
    setRazon(p.nombre);
    if (p.rut) setRut(p.rut);
  }
  function alCambiarRut(t: string) {
    setRut(t);
    setSupplierId(null);
    if (!isValidRut(t)) return;
    const p = proveedores.find((x) => soloRut(x.rut) === soloRut(t));
    if (p) { setSupplierId(p.id); setRazon(p.nombre); }
  }

  async function guardar() {
    setError(null);
    if (!isValidRut(rut)) { setError('El RUT del proveedor no es válido'); return; }
    if (!razon.trim()) { setError('Falta la razón social'); return; }
    if (!(vFolio > 0)) { setError('Escribe el folio del documento'); return; }
    for (const v of [vNeto, vExento, vIva, vOtros]) if (!v.valido) { setError(v.error); return; }
    if (total <= 0) { setError('El documento no puede sumar $0'); return; }
    setGuardando(true);
    try {
      await repoFacturacion().registrarRecibida({
        supplierId, rutEmisor: formatRut(rut), razonSocial: razon.trim(), tipo, folio: vFolio, fechaEmision: fecha,
        neto: vNeto.valor, exento: vExento.valor, iva: vIva.valor, otrosImpuestos: vOtros.valor, notas: notas.trim() || null,
      });
      onHecho();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  const c = 'tap w-full px-3 rounded-xl border border-[var(--borde)] bg-white';
  return (
    <Modal titulo="Registrar factura recibida" encabezado="visible" onCerrar={onCerrar} bloqueado={guardando} ancho="md">
      <div className="p-4 space-y-3">
        <Campo etiqueta="RUT del proveedor" obligatorio ayuda={supplierId ? '✓ Proveedor guardado' : 'Si es nuevo, se agrega a Proveedores'}>
          {(p) => <input {...p} value={rut} onChange={(e) => alCambiarRut(e.target.value)}
                         onBlur={() => isValidRut(rut) && setRut(formatRut(rut))} className={c} />}
        </Campo>
        <Campo etiqueta="Razón social" obligatorio>
          {(p) => (
            <>
              <input {...p} value={razon} onChange={(e) => { setRazon(e.target.value); setSupplierId(null); }} className={c} />
              {sugerencias.length > 0 && (
                <ul className="tarjeta mt-1 divide-y divide-[var(--borde)]">
                  {sugerencias.map((s) => (
                    <li key={s.id}>
                      <button onClick={() => elegir(s)} className="tap w-full px-3 text-left text-sm">
                        {s.nombre}{s.rut ? ` · ${s.rut}` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Documento">
            {(p) => (
              <select {...p} value={tipo} onChange={(e) => setTipo(Number(e.target.value) as TipoRecibida)} className={c}>
                {TIPOS.map(([t, n]) => <option key={t} value={t}>{n}</option>)}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Folio" obligatorio>
            {(p) => <input {...p} inputMode="numeric" value={folio} onChange={(e) => setFolio(e.target.value)} className={`${c} num`} />}
          </Campo>
        </div>
        <Campo etiqueta="Fecha de emisión">
          {(p) => <input {...p} type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} className={c} />}
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Neto" error={vNeto.valido ? null : vNeto.error}>
            {(p) => <input {...p} inputMode="numeric" value={neto} onChange={(e) => setNeto(e.target.value)} className={`${c} num text-right`} />}
          </Campo>
          <Campo etiqueta="IVA" ayuda={ivaEditado ? undefined : '19 % del neto'} error={vIva.valido ? null : vIva.error}>
            {(p) => <input {...p} inputMode="numeric" value={ivaEditado ? iva : String(ivaPropuesto)}
                           onChange={(e) => { setIvaEditado(true); setIva(e.target.value); }} className={`${c} num text-right`} />}
          </Campo>
          <Campo etiqueta="Exento" error={vExento.valido ? null : vExento.error}>
            {(p) => <input {...p} inputMode="numeric" value={exento} onChange={(e) => setExento(e.target.value)} className={`${c} num text-right`} />}
          </Campo>
          <Campo etiqueta="Otros impuestos" error={vOtros.valido ? null : vOtros.error}>
            {(p) => <input {...p} inputMode="numeric" value={otros} onChange={(e) => setOtros(e.target.value)} className={`${c} num text-right`} />}
          </Campo>
        </div>
        <p className="text-sm flex justify-between"><span>Total del documento</span><strong className="num">{formatCLP(total)}</strong></p>
        <Campo etiqueta="Notas">
          {(p) => <input {...p} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} className={c} />}
        </Campo>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <button onClick={() => void guardar()} disabled={guardando}
                className="tap w-full rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Registrar'}
        </button>
      </div>
    </Modal>
  );
}

function AnularRecibida({ r, onCerrar, onHecho }: { r: FacturaRecibida; onCerrar: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function anular() {
    if (!motivo.trim()) { setError('Escribe por qué se anula el registro'); return; }
    setGuardando(true);
    try { await repoFacturacion().anularRecibida(r.id, motivo.trim()); onHecho(); }
    catch (e) { setError(toUserMessage(e)); }
    finally { setGuardando(false); }
  }
  return (
    <Modal titulo={`Anular el registro de ${nombreTipo(r.tipo)} N° ${r.folio}`} encabezado="visible" onCerrar={onCerrar} bloqueado={guardando}>
      <div className="p-4 space-y-3">
        <p className="text-sm">Anular el registro lo saca de las compras del mes. El documento del proveedor no cambia.</p>
        <Campo etiqueta="Motivo" obligatorio>
          {(p) => <input {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                         className="tap w-full px-3 rounded-xl border border-[var(--borde)]" />}
        </Campo>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void anular()} disabled={guardando}
                className="tap w-full rounded-xl bg-[var(--color-alerta)] text-white font-semibold disabled:opacity-50">
          {guardando ? 'Anulando…' : 'Anular registro'}
        </button>
      </div>
    </Modal>
  );
}
