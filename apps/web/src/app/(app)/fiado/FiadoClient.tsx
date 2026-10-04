'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCLP, toUserMessage, validarMonto, coincide } from '@rutaahorro/core';
import {
  cuentasClientes, movimientosCuenta, abonarCuenta, fijarTopeCredito,
  NOMBRE_MOVIMIENTO, signoMovimiento,
  type CuentaCliente, type MovimientoCuenta, type MetodoAbono,
} from '@/lib/datos/fiado';
import Link from 'next/link';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { Encabezado } from '@/components/Encabezado';
import { useFormatoFecha } from '@/lib/formatoFecha';

/**
 * Fiado: cuenta corriente de los clientes (RF-M5-30, 0029).
 *
 * Reemplaza el cuaderno del mostrador. Cada cliente con crédito tiene un tope
 * (lo pone el dueño o el supervisor) y un saldo que suben las compras fiadas y
 * bajan los abonos. Lo fiado no entra al efectivo de la caja; un abono en
 * efectivo sí, en la caja de quien lo recibe.
 */
const METODOS: Array<{ id: MetodoAbono; label: string }> = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'debito', label: 'Débito' },
  { id: 'credito', label: 'Crédito' },
];

export function FiadoClient({ puedeDarCredito }: { puedeDarCredito: boolean }) {
  const [cuentas, setCuentas] = useState<CuentaCliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [abonando, setAbonando] = useState<CuentaCliente | null>(null);
  const [viendo, setViendo] = useState<CuentaCliente | null>(null);
  const [topeDe, setTopeDe] = useState<CuentaCliente | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  // Con cientos de clientes, la lista de "Dar crédito" no se podía recorrer.
  const [buscaCliente, setBuscaCliente] = useState('');

  const cargar = useCallback(async () => {
    try {
      setCuentas(await cuentasClientes());
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  // Los que tienen crédito o deben algo; los demás solo para "Dar crédito".
  const conCuenta = useMemo(() => cuentas.filter((c) => c.tope > 0 || c.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, 'es')), [cuentas]);
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return conCuenta.filter((c) => !q || coincide(c.nombre, q));
  }, [conCuenta, busqueda]);
  const totalAdeudado = conCuenta.reduce((s, c) => s + c.saldo, 0);
  // Solo clientes activos: uno desactivado no se puede elegir en Vender.
  const sinCredito = cuentas.filter((c) => c.activo && c.tope === 0 && c.saldo === 0);

  async function listo(texto: string) {
    setAbonando(null); setTopeDe(null); setEligiendo(false);
    setAviso({ tipo: 'ok', texto });
    await cargar();
  }

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-4" aria-busy={cargando}>
      <Encabezado
        titulo="Fiado"
        icono="fiado"
        descripcion="Lo que deben los clientes con crédito. Se fía desde Vender eligiendo al cliente; acá se registran los abonos."
        acciones={puedeDarCredito && (
          <button onClick={() => setEligiendo(true)} className="btn btn-primario btn-chico">
            Dar crédito a un cliente
          </button>
        )}
      />

      {aviso && (
        <p role={aviso.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm px-3 py-2 rounded-lg ${aviso.tipo === 'error' ? 'bg-red-50 text-red-900' : 'bg-marca-100 text-marca-900'}`}>
          {aviso.texto}
        </p>
      )}

      <div className="tarjeta p-4 flex items-center justify-between" data-total-fiado>
        <span className="text-sm">Total que deben</span>
        <span className="num text-xl font-bold">{formatCLP(totalAdeudado)}</span>
      </div>

      {conCuenta.length > 5 && (
        <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
               placeholder="Buscar cliente…" aria-label="Buscar cliente con fiado"
               className="tap w-full px-3 rounded-lg border border-[var(--borde)] bg-white" />
      )}

      <ul className="space-y-2" aria-label="Clientes con fiado">
        {visibles.map((c) => {
          const lleno = c.tope > 0 && c.saldo >= c.tope;
          return (
            <li key={c.clienteId} className="tarjeta p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.nombre}</p>
                  <p className="text-xs text-[var(--texto-suave)]">
                    Tope {formatCLP(c.tope)} · le quedan {formatCLP(c.disponible)}
                    {lleno && <strong className="text-[var(--color-aviso)]"> · sin crédito disponible</strong>}
                  </p>
                </div>
                <p className="text-right shrink-0">
                  <span className="block num font-bold">{formatCLP(c.saldo)}</span>
                  <span className="block text-[11px] text-[var(--texto-suave)]">{c.saldo > 0 ? 'debe' : 'al día'}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <button onClick={() => setAbonando(c)} disabled={c.saldo <= 0}
                        className="btn btn-primario btn-chico" aria-label={`Abonar a la cuenta de ${c.nombre}`}>
                  Abonar
                </button>
                <button onClick={() => setViendo(c)} className="btn btn-secundario btn-chico"
                        aria-label={`Ver movimientos de ${c.nombre}`}>
                  Movimientos
                </button>
                {puedeDarCredito && (
                  <button onClick={() => setTopeDe(c)} className="btn btn-fantasma btn-chico"
                          aria-label={`Cambiar tope de ${c.nombre}`}>
                    Cambiar tope
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {!cargando && visibles.length === 0 && (
          <li className="tarjeta p-4 text-sm text-[var(--texto-suave)]">
            {conCuenta.length === 0
              ? puedeDarCredito
                ? 'Ningún cliente tiene crédito todavía. Usa "Dar crédito a un cliente" (el cliente tiene que estar en Clientes).'
                : 'Ningún cliente tiene crédito todavía. El administrador lo habilita.'
              : 'Ningún cliente coincide.'}
          </li>
        )}
      </ul>

      {abonando && <Abonar cuenta={abonando} onCerrar={() => setAbonando(null)} onListo={listo} />}
      {viendo && <Movimientos cuenta={viendo} onCerrar={() => setViendo(null)} />}
      {topeDe && <Tope cuenta={topeDe} onCerrar={() => setTopeDe(null)} onListo={listo} />}
      {eligiendo && (
        <Modal titulo="Dar crédito a un cliente" encabezado="visible" onCerrar={() => setEligiendo(false)}>
          {/* Antes el botón quedaba desactivado sin decir por qué, y el
              mensaje de la lista vacía mandaba justo a ese botón. */}
          {sinCredito.length === 0 && (
            <p className="p-4 text-sm">
              No hay clientes sin crédito para elegir. Primero agrégalo en{' '}
              <Link href="/clientes" prefetch={false} className="underline inline-flex items-center min-h-[44px]">Clientes</Link>.
            </p>
          )}
          {sinCredito.length > 8 && (
            <div className="px-4 pt-4">
              <input type="search" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} autoFocus
                     placeholder="Buscar cliente…" aria-label="Buscar cliente para darle crédito"
                     className="tap w-full px-3 rounded-lg border border-[var(--borde)] bg-white" />
            </div>
          )}
          <ul className="p-4 space-y-2">
            {sinCredito.filter((c) => !buscaCliente.trim() || coincide(c.nombre, buscaCliente.trim().toLowerCase())).slice(0, 50).map((c) => (
              <li key={c.clienteId}>
                <button onClick={() => { setEligiendo(false); setTopeDe(c); }} className="tap w-full tarjeta px-3 text-left">
                  {c.nombre}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function Abonar({ cuenta, onCerrar, onListo }: {
  cuenta: CuentaCliente; onCerrar: () => void; onListo: (texto: string) => void;
}) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoAbono>('efectivo');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = validarMonto(monto, { etiqueta: 'abono', maximo: cuenta.saldo });

  async function guardar() {
    if (!v.valido || v.valor <= 0 || enviando) return;
    setEnviando(true); setError(null);
    try {
      const saldo = await abonarCuenta(cuenta.clienteId, v.valor, metodo, nota.trim() || null);
      onListo(`Abono de ${formatCLP(v.valor)} registrado. ${cuenta.nombre} queda debiendo ${formatCLP(saldo)}.`);
    } catch (e) {
      setError(toUserMessage(e));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={`Abono de ${cuenta.nombre}`} encabezado="visible" onCerrar={onCerrar} bloqueado={enviando}>
      <div className="p-4 space-y-3">
        <p className="text-sm">Debe <strong className="num">{formatCLP(cuenta.saldo)}</strong>.</p>
        <Campo etiqueta="Monto que paga" obligatorio error={monto !== '' ? v.error : null}>
          {(p) => <input {...p} inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)] num text-right text-lg" />}
        </Campo>
        <button type="button" onClick={() => setMonto(String(cuenta.saldo))} className="btn btn-secundario btn-chico">
          Paga todo ({formatCLP(cuenta.saldo)})
        </button>
        <fieldset>
          <legend className="text-sm font-medium mb-1.5">Cómo paga</legend>
          <div className="grid grid-cols-2 gap-2">
            {METODOS.map((m) => (
              <button key={m.id} type="button" onClick={() => setMetodo(m.id)} aria-pressed={metodo === m.id}
                      className={`tap rounded-xl border-2 text-sm font-medium ${metodo === m.id ? 'border-marca-500 bg-marca-50 text-marca-900' : 'border-[var(--borde)] bg-white'}`}>
                {m.label}{metodo === m.id && <span aria-hidden> ✓</span>}
              </button>
            ))}
          </div>
          {metodo === 'efectivo' && (
            <p className="text-xs text-[var(--texto-suave)] mt-1.5">Entra a tu caja: suma a lo que debería haber al cerrar.</p>
          )}
        </fieldset>
        <Campo etiqueta="Nota (opcional)">
          {(p) => <input {...p} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={120}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />}
        </Campo>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void guardar()} disabled={!v.valido || v.valor <= 0 || enviando} className="btn btn-primario w-full">
          {enviando ? 'Registrando…' : 'Registrar abono'}
        </button>
      </div>
    </Modal>
  );
}

function Tope({ cuenta, onCerrar, onListo }: {
  cuenta: CuentaCliente; onCerrar: () => void; onListo: (texto: string) => void;
}) {
  const [tope, setTope] = useState(cuenta.tope ? cuenta.tope.toLocaleString('es-CL') : '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = validarMonto(tope, { etiqueta: 'tope', permiteVacio: true, maximo: 5_000_000 });

  async function guardar() {
    if (!v.valido || enviando) return;
    setEnviando(true); setError(null);
    try {
      await fijarTopeCredito(cuenta.clienteId, v.valor);
      onListo(v.valor > 0
        ? `${cuenta.nombre} puede comprar fiado hasta ${formatCLP(v.valor)}.`
        : `A ${cuenta.nombre} ya no se le fía.`);
    } catch (e) {
      setError(toUserMessage(e));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={`Crédito de ${cuenta.nombre}`} encabezado="visible" onCerrar={onCerrar} bloqueado={enviando}>
      <div className="p-4 space-y-3">
        <Campo etiqueta="Hasta cuánto se le fía" error={tope !== '' ? v.error : null}
               ayuda="0 o vacío: no se le fía. Lo que ya debe no cambia.">
          {(p) => <input {...p} inputMode="numeric" value={tope} onChange={(e) => setTope(e.target.value)}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)] num text-right text-lg" />}
        </Campo>
        {cuenta.saldo > 0 && <p className="text-sm">Hoy debe <strong className="num">{formatCLP(cuenta.saldo)}</strong>.</p>}
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void guardar()} disabled={!v.valido || enviando} className="btn btn-primario w-full">
          {enviando ? 'Guardando…' : 'Guardar tope'}
        </button>
      </div>
    </Modal>
  );
}

function Movimientos({ cuenta, onCerrar }: { cuenta: CuentaCliente; onCerrar: () => void }) {
  const { fecha, hora } = useFormatoFecha();
  const [movs, setMovs] = useState<MovimientoCuenta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void movimientosCuenta(cuenta.clienteId).then(setMovs).catch((e) => setError(toUserMessage(e)));
  }, [cuenta.clienteId]);

  return (
    <Modal titulo={`Cuenta de ${cuenta.nombre}`} encabezado="visible" onCerrar={onCerrar}>
      <div className="p-4">
        <p className="text-sm mb-3">Debe <strong className="num">{formatCLP(cuenta.saldo)}</strong> · tope {formatCLP(cuenta.tope)}</p>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        {movs && movs.length === 0 && <p className="text-sm text-[var(--texto-suave)]">Sin movimientos.</p>}
        <ul className="divide-y divide-[var(--borde)] text-sm">
          {(movs ?? []).map((m) => (
            <li key={m.id} className="py-2 flex justify-between gap-2">
              <span className="min-w-0">
                <span className="block">
                  {NOMBRE_MOVIMIENTO[m.tipo]}{m.folio != null && ` · venta N° ${m.folio}`}
                  {m.metodo && ` · ${METODOS.find((x) => x.id === m.metodo)?.label ?? m.metodo}`}
                </span>
                <span className="block text-xs text-[var(--texto-suave)]">
                  {fecha(m.fecha)} {hora(m.fecha)}{m.nota && ` · ${m.nota}`}
                </span>
              </span>
              <span className={`num whitespace-nowrap font-medium ${signoMovimiento(m.tipo) > 0 ? '' : 'text-marca-700'}`}>
                {signoMovimiento(m.tipo) > 0 ? '+' : '−'}{formatCLP(m.monto)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
