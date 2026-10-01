'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatRut, isValidRut, toUserMessage, coincide } from '@rutaahorro/core';
import { repoClientes, type Cliente, type DatosCliente } from '@/lib/datos/clientes';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { Encabezado } from '@/components/Encabezado';
import { Icono } from '@/components/Icono';

/**
 * Clientes (0022, RQ-20, RQ-21): los datos para la factura y el fiado.
 *
 * Hasta 0032 un cliente podía tener un % de rebaja y precios especiales. Felipe
 * lo sacó el 2026-10-01: el precio por mayor es del producto («desde 3»), no
 * de quién compra. Lo que un cliente tenía guardado queda sin efecto, y al
 * guardarlo de nuevo se limpia.
 */
export function ClientesClient() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<Cliente | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      setClientes(await repoClientes().listar());
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const soloRut = q.replace(/[^0-9k]/g, '');
    return clientes.filter((c) => !q || coincide(c.nombre, q)
      || (soloRut.length >= 3 && (c.rut ?? '').toLowerCase().replace(/[^0-9k]/g, '').includes(soloRut)));
  }, [clientes, busqueda]);

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-4" aria-busy={cargando}>
      <Encabezado
        titulo="Clientes"
        icono="clientes"
        descripcion="Los datos para la factura y el fiado. El cajero los elige en Vender. El precio por mayor se pone en cada producto."
        acciones={
          <button onClick={() => setEditando('nuevo')} className="btn btn-primario btn-chico">
            <Icono nombre="agregar" tamano={16} /> Nuevo cliente
          </button>
        }
      />

      {aviso && (
        <p role={aviso.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm px-3 py-2 rounded-lg ${aviso.tipo === 'error' ? 'bg-red-50 text-red-900' : 'bg-marca-100 text-marca-900'}`}>
          {aviso.texto}
        </p>
      )}

      <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
             placeholder="Buscar por nombre o RUT…" aria-label="Buscar cliente"
             className="tap w-full px-3 rounded-lg border border-[var(--borde)] bg-white" />

      <ul className="space-y-2" aria-label="Clientes">
        {visibles.map((c) => (
          <li key={c.id}>
            <button onClick={() => setEditando(c)}
                    className={`tap w-full tarjeta px-3 py-2.5 text-left ${c.activo ? '' : 'opacity-60'}`}>
              <span className="block font-medium">{c.nombre}</span>
              <span className="block text-xs text-[var(--texto-suave)]">
                {c.rut ?? 'Sin RUT'}{c.giro ? ` · ${c.giro}` : ''}{!c.activo && ' · desactivado'}
              </span>
            </button>
          </li>
        ))}
        {!cargando && visibles.length === 0 && (
          <li className="tarjeta p-4 text-sm text-[var(--texto-suave)]">
            {clientes.length === 0
              ? 'Todavía no hay clientes. Agrégalos acá, o se crean solos al hacer una factura.'
              : 'Ningún cliente coincide.'}
          </li>
        )}
      </ul>

      {editando && (
        <FichaCliente
          cliente={editando === 'nuevo' ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={async (texto) => { setEditando(null); setAviso({ tipo: 'ok', texto }); await cargar(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function FichaCliente({ cliente, onCerrar, onGuardado }: {
  cliente: Cliente | null;
  onCerrar: () => void;
  onGuardado: (texto: string) => void;
}) {
  const [d, setD] = useState<DatosCliente>({
    rut: cliente?.rut ?? '', nombre: cliente?.nombre ?? '', giro: cliente?.giro ?? '',
    direccion: cliente?.direccion ?? '', comuna: cliente?.comuna ?? '', telefono: cliente?.telefono ?? '',
    email: cliente?.email ?? '', descuentoPct: cliente?.descuentoPct ?? 0, notas: cliente?.notas ?? '',
    activo: cliente?.activo ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const errorRut = d.rut && d.rut.trim() !== '' && !isValidRut(d.rut) ? 'Revisa el RUT' : null;
  const cambiar = (clave: keyof DatosCliente) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD((x) => ({ ...x, [clave]: e.target.value }));
  const texto = (clave: keyof DatosCliente, etiqueta: string, extra: Record<string, unknown> = {}) => (
    <Campo etiqueta={etiqueta}>
      {(p) => <input {...p} {...extra} value={(d[clave] as string) ?? ''} onChange={cambiar(clave)}
                     className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />}
    </Campo>
  );

  async function guardar() {
    setError(null);
    if (!d.nombre.trim()) { setError('El cliente necesita un nombre o razón social'); return; }
    if (errorRut) { setError(errorRut); return; }
    if (d.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
      setError('Revisa el correo: le falta la @ o el dominio (ej.: ventas@empresa.cl)'); return;
    }
    setGuardando(true);
    try {
      const limpio = (s: string | null) => (s ?? '').trim() || null;
      const datos: DatosCliente = {
        ...d, rut: d.rut && isValidRut(d.rut) ? formatRut(d.rut) : null, nombre: d.nombre.trim(),
        giro: limpio(d.giro), direccion: limpio(d.direccion), comuna: limpio(d.comuna),
        telefono: limpio(d.telefono), email: limpio(d.email), notas: limpio(d.notas),
        // 0032 · Sin precio por cliente: lo que tuviera guardado se limpia.
        descuentoPct: 0,
      };
      await repoClientes().guardar(cliente?.id ?? null, datos);
      onGuardado(`${datos.nombre} guardado`);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={cliente ? cliente.nombre : 'Nuevo cliente'} encabezado="visible" onCerrar={onCerrar} bloqueado={guardando}>
      <div className="p-4 space-y-3">
        {texto('nombre', 'Nombre o razón social')}
        <Campo etiqueta="RUT" error={errorRut} ayuda="Obligatorio para facturarle.">
          {(p) => <input {...p} value={d.rut ?? ''} onChange={cambiar('rut')} placeholder="76.086.428-5"
                         onBlur={() => { if (d.rut && isValidRut(d.rut)) setD((x) => ({ ...x, rut: formatRut(x.rut!) })); }}
                         className="tap w-full px-3 rounded-lg border border-[var(--borde)] num" />}
        </Campo>
        {texto('giro', 'Giro')}
        {texto('direccion', 'Dirección')}
        <div className="grid grid-cols-2 gap-2">
          {texto('comuna', 'Comuna')}
          {texto('telefono', 'Teléfono', { inputMode: 'tel' })}
        </div>
        {texto('email', 'Correo', { inputMode: 'email' })}

        <Campo etiqueta="Notas">
          {(p) => <textarea {...p} value={d.notas ?? ''} onChange={cambiar('notas')} rows={2}
                            className="w-full px-3 py-2 rounded-lg border border-[var(--borde)]" />}
        </Campo>
        {cliente && (
          <label className="flex items-center gap-3 text-sm min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={d.activo} onChange={(e) => setD((x) => ({ ...x, activo: e.target.checked }))}
                   className="w-5 h-5 accent-[var(--color-marca-500)]" />
            Activo (desmarcar para que no aparezca en el POS)
          </label>
        )}
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void guardar()} disabled={guardando}
                className="tap w-full py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}
