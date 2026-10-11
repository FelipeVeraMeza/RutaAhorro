'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NOMBRE_ESTADO_PEDIDO, TRANSICIONES_PEDIDO, accionPrincipal, enlaceWhatsApp, formatCLP, formatoCelular, haceCuanto,
  mensajeEstadoCliente, toUserMessage, type EstadoPedidoWeb,
} from '@rutaahorro/core';
import { cambiarEstadoPedidoWeb, listarPedidosWeb, type PedidoWeb } from '@/lib/datos/pedidosWeb';
import { Encabezado } from '@/components/Encabezado';
import { Modal } from '@/components/Modal';
import { Icono } from '@/components/Icono';

type Vista = 'nuevos' | 'preparando' | 'listos' | 'cerrados';
const VISTAS: Array<{ id: Vista; titulo: string; estados: EstadoPedidoWeb[] }> = [
  { id: 'nuevos', titulo: 'Nuevos', estados: ['recibido'] },
  { id: 'preparando', titulo: 'En preparación', estados: ['preparando'] },
  { id: 'listos', titulo: 'Listos', estados: ['listo'] },
  { id: 'cerrados', titulo: 'Entregados y cancelados', estados: ['entregado', 'cancelado'] },
];
const CADA_S = 30;

/**
 * RF-T49 y RF-T50 · Los pedidos de la tienda (docs/33): se ponen al día solos
 * cada 30 segundos, avisan con un sonido cuando llega uno nuevo, y cada uno se
 * avanza con un botón. Al dejarlo listo se le avisa al cliente por WhatsApp.
 */
export function PedidosWebClient({ local, direccion }: { local: string; direccion: string | null }) {
  const [pedidos, setPedidos] = useState<PedidoWeb[] | null>(null);
  const [vista, setVista] = useState<Vista>('nuevos');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<PedidoWeb | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const conocidos = useRef<Set<string> | null>(null);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(async () => {
    try {
      const lista = await listarPedidosWeb();
      // Un pedido que no estaba en la lectura anterior: avisar.
      const nuevos = lista.filter((p) => p.estado === 'recibido' && conocidos.current && !conocidos.current.has(p.id));
      if (nuevos.length) {
        setAviso(nuevos.length === 1 ? `Llegó el pedido N° ${nuevos[0].numero}` : `Llegaron ${nuevos.length} pedidos nuevos`);
        try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(() => {}); } catch { /* sin sonido */ }
      }
      conocidos.current = new Set(lista.map((p) => p.id));
      setPedidos(lista);
      setError(null);
      setActualizado(new Date());
    } catch (e) {
      const m = toUserMessage(e);
      setError(/pedidos_web|does not exist|relation/i.test(String((e as { message?: string })?.message))
        ? 'Los pedidos web todavía no están activos en la base (falta aplicar la migración 0040).'
        : m);
      setPedidos((x) => x ?? []);
    }
  }, []);

  useEffect(() => {
    void cargar();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void cargar(); }, CADA_S * 1000);
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [cargar]);

  const porVista = useMemo(() => {
    const m = new Map<Vista, PedidoWeb[]>();
    for (const v of VISTAS) m.set(v.id, (pedidos ?? []).filter((p) => v.estados.includes(p.estado)));
    // Los abiertos, el más antiguo primero: se atiende por orden de llegada.
    for (const v of ['nuevos', 'preparando', 'listos'] as Vista[]) m.get(v)!.sort((a, b) => a.creado.localeCompare(b.creado));
    return m;
  }, [pedidos]);

  async function cambiar(p: PedidoWeb, estado: EstadoPedidoWeb, motivo?: string) {
    if (ocupado) return;
    setOcupado(p.id);
    setError(null);
    try {
      await cambiarEstadoPedidoWeb(p.id, estado, motivo);
      setAviso(`Pedido N° ${p.numero}: ${NOMBRE_ESTADO_PEDIDO[estado].toLowerCase()}`);
      await cargar();
    } catch (e) {
      setError(toUserMessage(e));
      await cargar();
    } finally {
      setOcupado(null);
    }
  }

  // Buscar por número, nombre o celular (el cliente llega y dice "soy Ana").
  const q = busqueda.trim().toLowerCase();
  const lista = (porVista.get(vista) ?? []).filter((p) => !q
    || String(p.numero) === q.replace(/^n°?\s*/, '')
    || p.nombre.toLowerCase().includes(q)
    || p.celular.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§'));
  // Lo entregado hoy, para saber cuánto vendió la tienda.
  const hoy = new Date().toDateString();
  const entregadosHoy = (pedidos ?? []).filter((p) => p.estado === 'entregado' && new Date(p.actualizado).toDateString() === hoy);
  const enlaceSeguimiento = (p: PedidoWeb) => (typeof window === 'undefined' ? null : `${window.location.origin}/tienda/pedido/${p.codigo}`);

  return (
    <div className="px-4 py-5 max-w-4xl mx-auto space-y-4" aria-busy={pedidos == null}>
      <Encabezado titulo="Pedidos web" icono="compra"
        descripcion="Los pedidos de la tienda online: prepáralos, avísale al cliente y entrégalos al retirar." />

      <nav aria-label="Estados de los pedidos">
        <ul className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          {VISTAS.map((v) => {
            const n = porVista.get(v.id)?.length ?? 0;
            return (
              <li key={v.id}>
                <button type="button" onClick={() => setVista(v.id)} aria-current={vista === v.id ? 'page' : undefined}
                  className={`tap w-full inline-flex items-center justify-center gap-2 px-3 rounded-xl border text-sm font-medium ${
                    vista === v.id ? 'bg-marca-500 border-marca-500 text-white' : 'bg-white border-[var(--borde)]'}`}>
                  {v.titulo}
                  {v.id !== 'cerrados' && <span className={`insignia num ${n && v.id === 'nuevos' ? 'bg-acento-500 text-marca-900' : ''}`}>{n}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex items-center justify-between gap-2 text-sm text-[var(--texto-suave)]">
        <span aria-live="polite">{actualizado ? `Al día a las ${actualizado.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} · se pone al día solo` : 'Cargando…'}</span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-fantasma btn-chico" onClick={() => void cargar()}>Actualizar</button>
          {lista.length > 0 && vista !== 'cerrados' && <button type="button" className="btn btn-fantasma btn-chico" onClick={() => window.print()}>Imprimir</button>}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} maxLength={40}
          placeholder="Buscar por N°, nombre o celular" aria-label="Buscar un pedido"
          className="tap flex-1 px-3 rounded-xl border border-[var(--borde)]" />
        {entregadosHoy.length > 0 && (
          <p className="text-sm text-[var(--texto-suave)] num">Hoy: {entregadosHoy.length} entregados · {formatCLP(entregadosHoy.reduce((s, p) => s + p.total, 0))}</p>
        )}
      </div>

      {aviso && <p role="status" className="text-sm px-3 py-2 rounded-lg bg-marca-100 text-marca-900">{aviso}</p>}
      {error && <p role="alert" className="text-sm px-3 py-2 rounded-lg bg-red-50 text-red-900">{error}</p>}

      {pedidos != null && lista.length === 0 && (
        <div className="tarjeta p-5 text-center text-[var(--texto-suave)]">
          {vista === 'nuevos' ? 'No hay pedidos nuevos. Llegan solos a esta pantalla.' : 'No hay pedidos acá.'}
          {vista === 'nuevos' && <p className="mt-2 text-sm">¿No llegan? Revisa que esté encendido en <Link href="/configuracion#tienda" className="underline">Configuración → Tienda online</Link>.</p>}
        </div>
      )}

      <ul id="hoja-pedidos" className="space-y-3">
        {lista.map((p) => {
          const accion = accionPrincipal(p.estado);
          const aviso = enlaceWhatsApp(p.celular, mensajeEstadoCliente({
            numero: p.numero, estado: p.estado, nombreCliente: p.nombre, local, direccion, total: p.total, motivo: p.motivo,
            enlace: enlaceSeguimiento(p),
          }));
          const puedeCancelar = TRANSICIONES_PEDIDO[p.estado].includes('cancelado');
          return (
            <li key={p.id} className="tarjeta p-4 space-y-3 break-inside-avoid">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-lg font-extrabold">N° {p.numero} · {p.nombre}</p>
                  <p className="text-sm text-[var(--texto-suave)]">
                    {haceCuanto(p.creado)} · {new Date(p.creado).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}<span className="num">{NOMBRE_ESTADO_PEDIDO[p.estado]}</span>
                  </p>
                </div>
                <p className="text-2xl font-extrabold num">{formatCLP(p.total)}</p>
              </div>

              <ul className="text-sm divide-y divide-[var(--borde)] border-y border-[var(--borde)]">
                {p.items.map((i) => (
                  <li key={`${i.productId}-${i.nombre}`} className="py-1.5 flex justify-between gap-3">
                    <span><strong className="num">{i.cantidad} ×</strong> {i.nombre}</span>
                    <span className="num">{formatCLP(i.subtotal)}</span>
                  </li>
                ))}
              </ul>
              {p.nota && <p className="text-sm rounded-lg bg-acento-50 px-3 py-2"><strong>Nota:</strong> {p.nota}</p>}
              {p.estado === 'cancelado' && p.motivo && <p className="text-sm text-[var(--texto-suave)]">Cancelado: {p.motivo}</p>}

              <div className="flex flex-wrap items-center gap-2 text-sm">
                {p.celular !== 'anonimizado' && (
                  <a href={`tel:${p.celular}`} className="inline-flex items-center gap-1.5 min-h-11 font-semibold text-marca-700">
                    <Icono nombre="telefono" tamano={16} /> {formatoCelular(p.celular)}
                  </a>
                )}
                {p.correo && <a href={`mailto:${p.correo}`} className="min-h-11 inline-flex items-center underline">{p.correo}</a>}
              </div>

              <div className="flex flex-wrap gap-2 print:hidden">
                {accion && (
                  <button type="button" className="btn btn-primario" disabled={ocupado === p.id} onClick={() => void cambiar(p, accion.a)}>
                    {ocupado === p.id ? 'Guardando…' : accion.texto}
                  </button>
                )}
                {p.estado === 'recibido' && (
                  <button type="button" className="btn btn-secundario" disabled={ocupado === p.id} onClick={() => void cambiar(p, 'listo')}>Ya está listo</button>
                )}
                {aviso && p.estado !== 'entregado' && (
                  <a href={aviso} target="_blank" rel="noopener noreferrer" className="btn btn-secundario">
                    {p.estado === 'listo' ? 'Avisar que está listo' : p.estado === 'cancelado' ? 'Avisar la cancelación' : 'Escribir al cliente'}
                  </a>
                )}
                {puedeCancelar && (
                  <button type="button" className="btn btn-fantasma" disabled={ocupado === p.id} onClick={() => setCancelando(p)}>Cancelar pedido</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {cancelando && (
        <CancelarPedido pedido={cancelando} onCerrar={() => setCancelando(null)}
          onConfirmar={async (motivo) => { const p = cancelando; setCancelando(null); await cambiar(p, 'cancelado', motivo); }} />
      )}
    </div>
  );
}

function CancelarPedido({ pedido, onCerrar, onConfirmar }: { pedido: PedidoWeb; onCerrar: () => void; onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const RAPIDOS = ['Sin stock', 'El cliente lo pidió', 'No vino a retirar', 'Pedido duplicado'];
  return (
    <Modal titulo={`Cancelar el pedido N° ${pedido.numero}`} encabezado="visible" onCerrar={onCerrar}>
      <div className="p-4 space-y-3">
        <p className="text-sm">Queda cancelado con el motivo, y después puedes avisarle al cliente por WhatsApp.</p>
        <div className="flex flex-wrap gap-2">
          {RAPIDOS.map((m) => (
            <button key={m} type="button" onClick={() => setMotivo(m)} aria-pressed={motivo === m}
              className={`btn btn-chico ${motivo === m ? 'btn-primario' : 'btn-secundario'}`}>{m}</button>
          ))}
        </div>
        <label className="block">
          <span className="block text-sm font-medium mb-1">Motivo</span>
          <input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} autoFocus
            className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />
        </label>
        <button type="button" className="btn btn-peligro w-full" disabled={!motivo.trim()} onClick={() => onConfirmar(motivo.trim())}>
          Cancelar el pedido
        </button>
      </div>
    </Modal>
  );
}
