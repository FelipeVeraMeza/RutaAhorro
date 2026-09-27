'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatCLP, formatRut, isValidRut, toUserMessage, validarCantidad, validarMonto,
  describirCliente, precioParaCliente,
} from '@rutaahorro/core';
import { repoClientes, type Cliente, type DatosCliente } from '@/lib/datos/clientes';
import { repoProductos, type Producto } from '@/lib/productos';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';

/**
 * Clientes y precio por cliente (0022, RQ-07, RQ-20, RQ-21).
 *
 * Cada cliente puede tener un % de rebaja general (el mayorista) y precios
 * especiales en productos puntuales. En el POS se cobra el más barato entre
 * la oferta del producto, el % y el precio especial: no se suman. Los que
 * reciben factura quedan acá solos, con los datos del receptor.
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
    return clientes.filter((c) => !q || c.nombre.toLowerCase().includes(q)
      || (soloRut.length >= 3 && (c.rut ?? '').toLowerCase().replace(/[^0-9k]/g, '').includes(soloRut)));
  }, [clientes, busqueda]);

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-4" aria-busy={cargando}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Clientes</h1>
          <p className="text-sm text-[var(--texto-suave)]">
            Precio mayorista o especial, y los datos para la factura.
          </p>
        </div>
        <button onClick={() => setEditando('nuevo')}
                className="tap shrink-0 px-4 rounded-xl bg-marca-500 text-white text-sm font-semibold">
          + Cliente
        </button>
      </header>

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
                {c.rut ?? 'Sin RUT'} · {describirCliente(c)}{!c.activo && ' · desactivado'}
              </span>
            </button>
          </li>
        ))}
        {!cargando && visibles.length === 0 && (
          <li className="tarjeta p-4 text-sm text-[var(--texto-suave)]">
            {clientes.length === 0
              ? 'Todavía no hay clientes. Agrega a los mayoristas, o se crean solos al hacer una factura.'
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
  const [pct, setPct] = useState(cliente?.descuentoPct ? String(cliente.descuentoPct).replace('.', ',') : '');
  // Precios especiales, como texto mientras se escriben.
  const [precios, setPrecios] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(cliente?.precios ?? {}).map(([k, v]) => [k, v.toLocaleString('es-CL')])));
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscarProd, setBuscarProd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void repoProductos().listar({ soloActivos: true, limite: 5000 }, false).then(setProductos).catch(() => {});
  }, []);
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const candidatos = useMemo(() => {
    const q = buscarProd.trim().toLowerCase();
    if (q.length < 2) return [];
    return productos.filter((p) => !(p.id in precios) && p.nombre.toLowerCase().includes(q)).slice(0, 8);
  }, [productos, buscarProd, precios]);

  const vPct = validarCantidad(pct, { permiteVacio: true, maximo: 99.99 });
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
    if (!vPct.valido) { setError(`% de rebaja: ${vPct.error}`); return; }
    const numeros: Record<string, number> = {};
    for (const [id, v] of Object.entries(precios)) {
      const m = validarMonto(v, { etiqueta: 'precio especial', permiteCero: false, maximo: 50_000_000 });
      if (!m.valido) { setError(`${porId.get(id)?.nombre ?? 'Producto'}: ${m.error}`); return; }
      numeros[id] = m.valor;
    }
    setGuardando(true);
    try {
      const limpio = (s: string | null) => (s ?? '').trim() || null;
      const datos: DatosCliente = {
        ...d, rut: d.rut && isValidRut(d.rut) ? formatRut(d.rut) : null, nombre: d.nombre.trim(),
        giro: limpio(d.giro), direccion: limpio(d.direccion), comuna: limpio(d.comuna),
        telefono: limpio(d.telefono), email: limpio(d.email), notas: limpio(d.notas),
        descuentoPct: pct.trim() ? vPct.valor : 0,
      };
      const repo = repoClientes();
      const id = await repo.guardar(cliente?.id ?? null, datos);
      const antes = cliente?.precios ?? {};
      const cambiaron = Object.keys(numeros).length !== Object.keys(antes).length
        || Object.entries(numeros).some(([k, v]) => antes[k] !== v);
      if (cambiaron) await repo.guardarPrecios(id, numeros);
      onGuardado(`${datos.nombre} guardado`);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  const clienteVista = { id: cliente?.id ?? '', nombre: d.nombre, descuentoPct: vPct.valido ? vPct.valor : 0, precios: {} };

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

        <section className="rounded-xl border border-[var(--borde)] p-3 space-y-3" aria-labelledby="t-precio-cliente">
          <h3 id="t-precio-cliente" className="font-semibold text-sm">Precio para este cliente</h3>
          <Campo etiqueta="% de rebaja en todo" error={pct !== '' && !vPct.valido ? vPct.error : null}
                 ayuda="Ej.: 8 para un mayorista. Vacío = precio normal. No se suma a las ofertas: se cobra el más barato.">
            {(p) => <input {...p} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)}
                           className="tap w-28 px-3 rounded-lg border border-[var(--borde)] num text-right" />}
          </Campo>

          <div>
            <p className="text-sm font-medium">Precios especiales</p>
            <p className="text-xs text-[var(--texto-suave)] mb-2">
              Para productos puntuales. Si el % sale más barato, se cobra el %.
            </p>
            <ul className="space-y-2">
              {Object.keys(precios).map((id) => {
                const p = porId.get(id);
                const m = validarMonto(precios[id], { permiteCero: false });
                return (
                  <li key={id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate">{p?.nombre ?? 'Producto'}</span>
                      {p && <span className="block text-xs text-[var(--texto-suave)] num">normal {formatCLP(p.precioVenta)}
                        {m.valido && m.valor >= p.precioVenta && ' · no es más barato'}</span>}
                    </span>
                    <input inputMode="numeric" value={precios[id]} aria-label={`Precio especial de ${p?.nombre ?? 'producto'}`}
                           onChange={(e) => setPrecios((x) => ({ ...x, [id]: e.target.value }))}
                           className="tap w-24 px-2 rounded-lg border border-[var(--borde)] num text-right" />
                    <button type="button" aria-label={`Quitar precio especial de ${p?.nombre ?? 'producto'}`}
                            onClick={() => setPrecios((x) => { const n = { ...x }; delete n[id]; return n; })}
                            className="tap px-2 text-sm text-[var(--color-alerta)]">Quitar</button>
                  </li>
                );
              })}
            </ul>
            <input type="search" value={buscarProd} onChange={(e) => setBuscarProd(e.target.value)}
                   placeholder="Agregar producto…" aria-label="Buscar producto para precio especial"
                   className="tap w-full mt-2 px-3 rounded-lg border border-[var(--borde)]" />
            {candidatos.length > 0 && (
              <ul className="tarjeta mt-1 divide-y divide-[var(--borde)]">
                {candidatos.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="tap w-full px-3 text-left text-sm flex justify-between gap-2"
                            onClick={() => { setPrecios((x) => ({ ...x, [p.id]: '' })); setBuscarProd(''); }}>
                      <span className="truncate">{p.nombre}</span>
                      <span className="num text-[var(--texto-suave)]">
                        {formatCLP(p.precioVenta)}
                        {precioParaCliente(p.id, p.precioVenta, clienteVista) != null
                          && ` → ${formatCLP(precioParaCliente(p.id, p.precioVenta, clienteVista)!)} con el %`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

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
