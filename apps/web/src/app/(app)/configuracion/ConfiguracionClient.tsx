'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCLP, toUserMessage, validarMonto, validarCantidad, etiquetaAdicional,
  IMPUESTOS_ADICIONALES_CHILE, coincide, diaLocal
} from '@rutaahorro/core';
import { repoPrecios, type ImpuestoAdicional } from '@/lib/datos/precios';
import {
  configuracionLocal, guardarConfiguracion, useConfiguracion, type ConfiguracionLocal,
} from '@/lib/datos/configuracion';
import { repoProductos, type Categoria, type Producto } from '@/lib/productos';
import { Modal } from '@/components/Modal';
import { Campo } from '@/components/Campo';
import { leerEmisor, guardarEmisor, type Emisor } from '@/lib/datos/emisor';
import { Encabezado } from '@/components/Encabezado';
import { Icono, type NombreIcono } from '@/components/Icono';
import { armarRespaldo, descargarJson } from '@/lib/datos/respaldo';

/**
 * Configuración del local (T-18) e impuestos adicionales (0018).
 *
 * Lo que pidió el cliente el 2026-09-26: «poder modificar el impuesto
 * adicional y las tasas por producto o productos en general». Por eso la
 * tasa se cambia en un solo lugar y vale para todos los productos que tienen
 * ese impuesto, y se asigna de a muchos productos a la vez.
 */
type IdPestana = 'caja' | 'impuestos' | 'documentos' | 'respaldo';
const PESTANAS: Array<{ id: IdPestana; titulo: string; icono: NombreIcono; ayuda: string }> = [
  { id: 'caja', titulo: 'Caja y ventas', icono: 'caja', ayuda: 'Efectivo inicial, avisos, ofertas y el texto del comprobante.' },
  { id: 'impuestos', titulo: 'Impuestos', icono: 'productos', ayuda: 'Impuestos de bebidas y alcoholes (IABA, ILA), además del IVA.' },
  { id: 'documentos', titulo: 'Boletas y facturas', icono: 'facturacion', ayuda: 'Los datos del local que salen en cada documento.' },
  { id: 'respaldo', titulo: 'Respaldo', icono: 'configuracion', ayuda: 'Descarga una copia de todo lo del local.' },
];

export function ConfiguracionClient() {
  const [impuestos, setImpuestos] = useState<ImpuestoAdicional[]>([]);
  const [config, setConfig] = useState<ConfiguracionLocal | null>(null);
  const [editando, setEditando] = useState<Partial<ImpuestoAdicional> | null>(null);
  const [asignando, setAsignando] = useState<ImpuestoAdicional | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const [imps, cfg] = await Promise.all([repoPrecios().impuestos(), configuracionLocal()]);
      setImpuestos(imps);
      setConfig(cfg);
    } catch (e) {
      setAviso({ tipo: 'error', texto: toUserMessage(e) });
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const [pestana, setPestana] = useState<IdPestana>('caja');
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (PESTANAS.some((t) => t.id === h)) setPestana(h as IdPestana);
  }, []);
  function elegir(id: IdPestana) {
    setPestana(id);
    setAviso(null);
    history.replaceState(null, '', `#${{id}}`.replace('{{id}}', id));
  }

  const faltantes = IMPUESTOS_ADICIONALES_CHILE.filter(
    (p) => !impuestos.some((i) => i.nombre.toLowerCase() === p.nombre.toLowerCase()));

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-6" aria-busy={cargando}>
      <Encabezado
        titulo="Configuración"
        icono="configuracion"
        descripcion="Cómo funciona el local. Lo que guardes rige para todos de inmediato."
      />

      {aviso && (
        <p role={aviso.tipo === 'error' ? 'alert' : 'status'}
           className={`text-sm px-3 py-2 rounded-lg ${aviso.tipo === 'error' ? 'bg-red-50 text-red-900' : 'bg-marca-100 text-marca-900'}`}>
          {aviso.texto}
        </p>
      )}

      {/* 2026-10-07 · Pestañas: en el celular la página era una sola columna
          larguísima y no se sabía dónde estaba cada cosa (Felipe). Ahora se ve
          una sección a la vez, con lo más usado primero. La pestaña va en la
          dirección (#impuestos) para que un enlace lleve directo. */}
      {/* En el celular, 2×2: en una fila con desplazamiento no se notaba que había más. */}
      <nav aria-label="Secciones de configuración">
        <ul className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          {PESTANAS.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => elegir(t.id)} aria-current={pestana === t.id ? 'page' : undefined}
                      className={`tap w-full inline-flex items-center justify-center gap-2 px-3 rounded-xl border text-sm font-medium ${
                        pestana === t.id ? 'bg-marca-500 border-marca-500 text-white' : 'bg-white border-[var(--borde)]'
                      }`}>
                <Icono nombre={t.icono} tamano={17} className="hidden sm:block" /> {t.titulo}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <p className="-mt-3 text-sm text-[var(--texto-suave)]">{PESTANAS.find((t) => t.id === pestana)?.ayuda}</p>

      {pestana === 'caja' && config && (
        <OperacionDelLocal
          config={config}
          onGuardado={(c, texto) => { setConfig(c); setAviso({ tipo: 'ok', texto }); }}
          onError={(texto) => setAviso({ tipo: 'error', texto })}
        />
      )}

      {pestana === 'impuestos' && (
        <section aria-labelledby="t-impuestos" className="space-y-3">
          <div>
            <h2 id="t-impuestos" className="sr-only">Impuestos adicionales</h2>
            <p className="text-sm text-[var(--texto-suave)]">
              IABA de las bebidas e ILA de vinos, cervezas y licores. El precio de venta ya los
              incluye; el sistema los separa en la boleta. Cambiar una tasa vale para las ventas
              de ahora en adelante, nunca para las ya hechas.
            </p>
          </div>

          {impuestos.length === 0 && !cargando && (
            <p className="text-sm tarjeta p-4">Todavía no hay impuestos. Agrega los que usa el local.</p>
          )}

          <ul className="space-y-2">
            {impuestos.map((i) => (
              <li key={i.id} className={`tarjeta p-3 ${i.activo ? '' : 'opacity-70'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{etiquetaAdicional(i)}</p>
                    <p className="text-xs text-[var(--texto-suave)]">
                      {i.productos} {i.productos === 1 ? 'producto' : 'productos'}
                      {i.codigoSii != null && ` · código SII ${i.codigoSii}`}
                      {!i.activo && ' · desactivado (no se cobra)'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setEditando(i)}
                          className="tap flex-1 rounded-lg border border-[var(--borde)] text-sm font-medium">
                    Cambiar tasa
                  </button>
                  <button onClick={() => setAsignando(i)}
                          className="tap flex-1 rounded-lg border border-[var(--borde)] text-sm font-medium">
                    Elegir productos
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {faltantes.length > 0 && (
            <div className="tarjeta p-3">
              <p className="text-sm font-medium mb-2">Agregar los de Chile, con su tasa vigente</p>
              <div className="flex flex-wrap gap-2">
                {faltantes.map((p) => (
                  <button key={p.nombre}
                          onClick={() => setEditando({ nombre: p.nombre, codigoSii: p.codigoSii, tasa: p.tasa, activo: true })}
                          className="tap px-3 rounded-full border border-[var(--borde)] text-sm">
                    + {p.nombre} {String(p.tasa).replace('.', ',')}%
                  </button>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => setEditando({ nombre: '', codigoSii: null, tasa: 0, activo: true })}
                  className="tap w-full rounded-xl border border-dashed border-[var(--borde)] text-sm font-medium">
            + Otro impuesto
          </button>
        </section>
      )}

      {pestana === 'documentos' && (
        <DatosEmisor
          onGuardado={(texto) => setAviso({ tipo: 'ok', texto })}
          onError={(texto) => setAviso({ tipo: 'error', texto })}
        />
      )}

      {pestana === 'respaldo' && <MisDatos />}

      {editando && (
        <EditarImpuesto
          inicial={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={async (texto) => { setEditando(null); setAviso({ tipo: 'ok', texto }); await cargar(); }}
        />
      )}
      {asignando && (
        <AsignarProductos
          impuesto={asignando}
          onCerrar={() => setAsignando(null)}
          onGuardado={async (texto) => { setAsignando(null); setAviso({ tipo: 'ok', texto }); await cargar(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function EditarImpuesto({ inicial, onCerrar, onGuardado }: {
  inicial: Partial<ImpuestoAdicional>;
  onCerrar: () => void;
  onGuardado: (texto: string) => void;
}) {
  const [nombre, setNombre] = useState(inicial.nombre ?? '');
  const [tasa, setTasa] = useState(inicial.tasa ? String(inicial.tasa).replace('.', ',') : '');
  const [codigo, setCodigo] = useState(inicial.codigoSii != null ? String(inicial.codigoSii) : '');
  const [activo, setActivo] = useState(inicial.activo ?? true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const vTasa = validarCantidad(tasa, { maximo: 99.99 });
  const vCodigo = validarCantidad(codigo, { permiteVacio: true, maximo: 9999 });

  async function guardar() {
    setError(null);
    if (!nombre.trim()) { setError('El impuesto necesita un nombre'); return; }
    if (!vTasa.valido || vTasa.valor <= 0) { setError('La tasa tiene que ser un porcentaje mayor que 0'); return; }
    if (!vCodigo.valido) { setError(vCodigo.error); return; }
    setGuardando(true);
    try {
      await repoPrecios().guardarImpuesto({
        id: inicial.id ?? null, nombre: nombre.trim(), tasa: vTasa.valor,
        codigoSii: codigo.trim() ? Math.round(vCodigo.valor) : null, activo,
      });
      onGuardado(inicial.id
        ? `${nombre.trim()} quedó en ${String(vTasa.valor).replace('.', ',')}% para las ventas desde ahora`
        : `${nombre.trim()} agregado. Ahora elige a qué productos se aplica`);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={inicial.id ? `Cambiar ${inicial.nombre}` : 'Nuevo impuesto adicional'}
           encabezado="visible" onCerrar={onCerrar} bloqueado={guardando}>
      <div className="p-5 space-y-4">
        <Campo etiqueta="Nombre" obligatorio>
          {(p) => <input {...p} value={nombre} onChange={(e) => setNombre(e.target.value)}
                         className="tap w-full px-3 py-2 rounded-lg border border-[var(--borde)]" />}
        </Campo>
        <Campo etiqueta="Tasa (%)" obligatorio error={tasa !== '' && !vTasa.valido ? vTasa.error : null}
               ayuda="Ej.: 18 para bebidas con alto azúcar, 20,5 para vinos y cervezas.">
          {(p) => <input {...p} inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)}
                         className="tap w-32 px-3 py-2 rounded-lg border border-[var(--borde)] num text-right" />}
        </Campo>
        <Campo etiqueta="Código SII" ayuda="Va en la boleta y la factura. 27 y 271 bebidas, 24 licores, 25 vinos, 26 cervezas.">
          {(p) => <input {...p} inputMode="numeric" value={codigo} onChange={(e) => setCodigo(e.target.value)}
                         className="tap w-32 px-3 py-2 rounded-lg border border-[var(--borde)] num text-right" />}
        </Campo>
        {inicial.id && (
          <label className="flex items-center gap-3 text-sm min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)}
                   className="w-5 h-5 accent-[var(--color-marca-500)]" />
            Se cobra (desmarcar para dejar de cobrarlo sin quitarlo de los productos)
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

// ---------------------------------------------------------------------------
function AsignarProductos({ impuesto, onCerrar, onGuardado }: {
  impuesto: ImpuestoAdicional;
  onCerrar: () => void;
  onGuardado: (texto: string) => void;
}) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [actual, setActual] = useState<Map<string, string | null>>(new Map());
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [categoriaId, setCategoriaId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [ps, cs, mapa] = await Promise.all([
          repoProductos().listar({ soloActivos: true, limite: 5000 }, false),
          repoProductos().categorias(),
          repoPrecios().impuestoPorProducto(),
        ]);
        setProductos(ps);
        setCategorias(cs);
        setActual(mapa);
        setMarcados(new Set(ps.filter((p) => mapa.get(p.id) === impuesto.id).map((p) => p.id)));
      } catch (e) {
        setError(toUserMessage(e));
      }
    })();
  }, [impuesto.id]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) =>
      (!categoriaId || p.categoriaId === categoriaId) && (!q || coincide(p.nombre, q)));
  }, [productos, categoriaId, busqueda]);

  const alternar = (id: string) => setMarcados((m) => {
    const n = new Set(m);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const todosVisibles = visibles.length > 0 && visibles.every((p) => marcados.has(p.id));

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const poner = [...marcados].filter((id) => actual.get(id) !== impuesto.id);
      const quitar = productos.filter((p) => actual.get(p.id) === impuesto.id && !marcados.has(p.id)).map((p) => p.id);
      const repo = repoPrecios();
      const n1 = poner.length ? await repo.asignarImpuesto(poner, impuesto.id) : 0;
      const n2 = quitar.length ? await repo.asignarImpuesto(quitar, null) : 0;
      onGuardado(`${etiquetaAdicional(impuesto)}: ${n1} ${n1 === 1 ? 'producto agregado' : 'productos agregados'}` +
                 (n2 ? `, ${n2} ${n2 === 1 ? 'quitado' : 'quitados'}` : ''));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Productos con ${etiquetaAdicional(impuesto)}`} encabezado="visible"
           onCerrar={onCerrar} bloqueado={guardando}>
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}
                  aria-label="Filtrar por categoría"
                  className="tap flex-1 min-w-0 px-3 rounded-lg border border-[var(--borde)] bg-white">
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
               placeholder="Buscar producto…" aria-label="Buscar producto"
               className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />
        <label className="flex items-center gap-3 text-sm font-medium min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={todosVisibles}
                 onChange={() => setMarcados((m) => {
                   const n = new Set(m);
                   for (const p of visibles) { if (todosVisibles) n.delete(p.id); else n.add(p.id); }
                   return n;
                 })}
                 className="w-5 h-5 accent-[var(--color-marca-500)]" />
          {todosVisibles ? 'Desmarcar' : 'Marcar'} los {visibles.length} de la lista
        </label>
        <ul className="divide-y divide-[var(--borde)] max-h-[45vh] overflow-y-auto tarjeta">
          {visibles.map((p) => {
            const otro = actual.get(p.id) && actual.get(p.id) !== impuesto.id;
            return (
              <li key={p.id}>
                <label className="flex items-center gap-3 px-3 min-h-[48px] cursor-pointer">
                  <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)}
                         className="w-5 h-5 accent-[var(--color-marca-500)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{p.nombre}</span>
                    <span className="block text-xs text-[var(--texto-suave)] num">
                      {formatCLP(p.precioVenta)}{otro && ' · tiene otro impuesto: se reemplaza'}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
          {visibles.length === 0 && <li className="p-4 text-sm text-[var(--texto-suave)]">No hay productos con ese filtro.</li>}
        </ul>
        {error && <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>}
        <button onClick={() => void guardar()} disabled={guardando}
                className="tap w-full py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : `Guardar (${marcados.size} ${marcados.size === 1 ? 'producto' : 'productos'})`}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function OperacionDelLocal({ config, onGuardado, onError }: {
  config: ConfiguracionLocal;
  onGuardado: (c: ConfiguracionLocal, texto: string) => void;
  onError: (texto: string) => void;
}) {
  const [efectivo, setEfectivo] = useState(config.efectivoInicialSugerido ? config.efectivoInicialSugerido.toLocaleString('es-CL') : '');
  const [horas, setHoras] = useState(String(config.horasAvisoCaja));
  const [variacion, setVariacion] = useState(String(config.variacionCostoPct));
  const [pie, setPie] = useState(config.comprobantePie);
  const [guardando, setGuardando] = useState(false);

  async function guardar(cambios: Parameters<typeof guardarConfiguracion>[0], texto: string) {
    setGuardando(true);
    try {
      onGuardado(await guardarConfiguracion(cambios), texto);
    } catch (e) {
      onError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  const vEf = validarMonto(efectivo, { etiqueta: 'efectivo inicial', permiteVacio: true, maximo: 5_000_000 });
  const vHoras = validarCantidad(horas, { maximo: 72 });
  const vVar = validarCantidad(variacion, { maximo: 100 });


  return (
    <section aria-labelledby="t-local" className="space-y-3">
      <h2 id="t-local" className="font-semibold">Cómo opera el local</h2>
      <Interruptor guardando={guardando} guardar={guardar} valor={config.venderSinStock} clave="vender_sin_stock"
                   titulo="Cualquier cajero vende aunque el sistema diga que no hay stock"
                   detalle="Se vende lo que está en la repisa y al administrador le llega la alerta de stock negativo." />
      <Interruptor guardando={guardando} guardar={guardar} valor={config.tarjetaEmiteDocumento} clave="tarjeta_emite_documento"
                   titulo="La máquina de tarjetas emite el documento"
                   detalle="Con tarjeta se entrega el voucher de la máquina y no se emite boleta. Desmarcar si la máquina no está integrada." />
      <Interruptor guardando={guardando} guardar={guardar} valor={config.ofertasActivas} clave="ofertas_activas"
                   titulo="Rigen las ofertas y promociones"
                   detalle="Desmarcar para cobrar el precio normal en todo el local sin borrar ninguna oferta. Los celulares se enteran al entrar a vender o en 10 minutos." />
      <Link href="/productos/ofertas" className="tap flex items-center justify-between tarjeta px-3 text-sm font-medium">
        Ofertas de varios productos a la vez <span aria-hidden>›</span>
      </Link>

      <div className="tarjeta p-3 space-y-3">
        <Campo etiqueta="Efectivo con que parte la caja" error={efectivo !== '' ? vEf.error : null}
               ayuda="Se ofrece al abrir caja. El cajero igual tiene que contar.">
          {(p) => <input {...p} inputMode="numeric" value={efectivo} onChange={(e) => setEfectivo(e.target.value)}
                         className="tap w-40 px-3 py-2 rounded-lg border border-[var(--borde)] num text-right" />}
        </Campo>
        <Campo etiqueta="Avisar una caja abierta después de (horas)" error={!vHoras.valido ? vHoras.error : vHoras.valor < 1 ? 'Tiene que ser al menos 1 hora' : null}>
          {(p) => <input {...p} inputMode="numeric" value={horas} onChange={(e) => setHoras(e.target.value)}
                         className="tap w-24 px-3 py-2 rounded-lg border border-[var(--borde)] num text-right" />}
        </Campo>
        <Campo etiqueta="Avisar si el costo de compra cambia más de (%)" error={!vVar.valido ? vVar.error : vVar.valor < 1 ? 'Tiene que ser al menos 1 %' : null}>
          {(p) => <input {...p} inputMode="numeric" value={variacion} onChange={(e) => setVariacion(e.target.value)}
                         className="tap w-24 px-3 py-2 rounded-lg border border-[var(--borde)] num text-right" />}
        </Campo>
        <button
          disabled={guardando || !vEf.valido || !vHoras.valido || !vVar.valido || vHoras.valor < 1 || vVar.valor < 1}
          onClick={() => void guardar({
            efectivo_inicial_sugerido: vEf.valor,
            cash_alert_hours: Math.round(vHoras.valor),
            cost_variation_alert_pct: Math.round(vVar.valor),
          }, 'Configuración guardada')}
          className="tap w-full py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <p className="text-xs text-[var(--texto-suave)]">
          El IVA ({config.ivaPct}%) y la zona horaria no se cambian desde acá.
        </p>
      </div>

      {/* RF-M9-13 · El pie del comprobante. */}
      <div className="tarjeta p-3 space-y-2">
        <Campo etiqueta="Texto al pie del comprobante"
               ayuda={`Política de cambios, redes o una despedida. Sale en cada comprobante y en las copias. ${pie.length}/160`}>
          {(p) => <textarea {...p} value={pie} maxLength={160} rows={2}
                            onChange={(e) => setPie(e.target.value)}
                            placeholder="Cambios dentro de 7 días con el comprobante. ¡Gracias por su compra!"
                            className="w-full px-3 py-2 rounded-lg border border-[var(--borde)]" />}
        </Campo>
        <button
          disabled={guardando || pie.trim() === config.comprobantePie}
          onClick={() => void guardar({ comprobante_pie: pie.trim() }, pie.trim() ? 'Pie del comprobante guardado' : 'Pie del comprobante quitado')}
          className="btn btn-secundario w-full">
          Guardar pie del comprobante
        </button>
      </div>
    </section>
  );
}

/**
 * Fuera del componente que lo usa: definido adentro, cada render era un
 * componente nuevo, la casilla se volvía a montar al guardar y quien usa
 * teclado o lector de pantalla perdía el foco (quedaba al inicio de la página).
 */
function Interruptor({ valor, clave, titulo, detalle, guardando, guardar }: {
  valor: boolean; clave: 'vender_sin_stock' | 'tarjeta_emite_documento' | 'ofertas_activas'; titulo: string; detalle: string;
  guardando: boolean;
  guardar: (cambios: Parameters<typeof guardarConfiguracion>[0], texto: string) => Promise<void>;
}) {
  return (
    <label className="tarjeta p-3 flex items-start gap-3 cursor-pointer">
      {/* aria-disabled y no disabled: desactivarla mientras guarda también
          le quitaba el foco. */}
      <input type="checkbox" checked={valor} aria-disabled={guardando || undefined}
             onChange={(e) => { if (!guardando) void guardar({ [clave]: e.target.checked }, `${titulo}: ${e.target.checked ? 'sí' : 'no'}`); }}
             className="mt-0.5 w-5 h-5 accent-[var(--color-marca-500)]" />
      <span className="text-sm">
        <strong className="block">{titulo}</strong>
        <span className="text-[var(--texto-suave)]">{detalle}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
const VACIO: Emisor = { rut: '', razonSocial: '', giro: '', acteco: '', direccion: '', comuna: '', ciudad: '', ambiente: 'simulacion' };

function DatosEmisor({ onGuardado, onError }: {
  onGuardado: (texto: string) => void;
  onError: (texto: string) => void;
}) {
  const [e, setE] = useState<Emisor>(VACIO);
  const [guardando, setGuardando] = useState(false);
  // Se lee una vez al entrar. `onError` cambia en cada render del padre: si
  // estuviera en las dependencias, el efecto se repetiría sin parar.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    void leerEmisor().then((x) => { if (x) setE(x); }).catch((err) => onErrorRef.current(toUserMessage(err)));
  }, []);
  const campo = (clave: keyof Emisor, etiqueta: string, ayuda?: string, modo?: 'numeric') => (
    <Campo etiqueta={etiqueta} ayuda={ayuda}>
      {(p) => <input {...p} value={e[clave]} inputMode={modo}
                     onChange={(ev) => setE((x) => ({ ...x, [clave]: ev.target.value }))}
                     className="tap w-full px-3 rounded-lg border border-[var(--borde)]" />}
    </Campo>
  );

  async function guardar() {
    setGuardando(true);
    try {
      await guardarEmisor(e);
      onGuardado('Datos del emisor guardados: van en las boletas y facturas desde ahora');
    } catch (err) {
      onError(toUserMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section aria-labelledby="t-emisor" className="space-y-3">
      <div>
        <h2 id="t-emisor" className="font-semibold">Boletas y facturas</h2>
        <p className="text-sm text-[var(--texto-suave)]">
          Los datos del contribuyente que van en cada documento.
        </p>
      </div>
      <div className="tarjeta p-3 text-sm bg-amber-50 border-amber-200">
        <strong>Modo simulación.</strong> Las boletas, facturas y notas de crédito se numeran y se
        imprimen con su timbre, pero dicen <em>sin validez tributaria</em>. Para emitir ante el SII
        faltan tres trámites del local: el <strong>certificado digital</strong>, la{' '}
        <strong>inscripción como emisor electrónico</strong> y los <strong>folios (CAF)</strong>.
      </div>
      <div className="tarjeta p-3 space-y-3">
        {campo('rut', 'RUT del emisor', 'Ej.: 76.086.428-5')}
        {campo('razonSocial', 'Razón social')}
        {campo('giro', 'Giro')}
        {campo('acteco', 'Código de actividad económica (SII)', 'Ej.: 471100 · opcional para boleta', 'numeric')}
        {campo('direccion', 'Dirección')}
        <div className="grid grid-cols-2 gap-2">
          {campo('comuna', 'Comuna')}
          {campo('ciudad', 'Ciudad')}
        </div>
        <button onClick={() => void guardar()} disabled={guardando}
                className="tap w-full py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Guardar datos del emisor'}
        </button>
      </div>
    </section>
  );
}

/**
 * Descargar todos los datos del local (RF-M9-03, RNF-48): la copia del dueño,
 * en un formato que se abre sin este sistema.
 */
function MisDatos() {
  const { zonaHoraria } = useConfiguracion();
  const [progreso, setProgreso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  async function descargar() {
    setResultado(null);
    setProgreso('Preparando…');
    try {
      const r = await armarRespaldo((h, t) => setProgreso(`Leyendo ${h} de ${t} tablas…`));
      const filas = Object.values(r.tablas).reduce((s, t) => s + t.length, 0);
      // El día del local (regla 17): con el de UTC, de noche el archivo decía mañana.
      descargarJson(`rutaahorro-datos-${diaLocal(new Date(r.exportado_en), zonaHoraria)}.json`, r);
      const omitidas = Object.keys(r.omitidas).length;
      setResultado(`Listo: ${filas.toLocaleString('es-CL')} registros de ${Object.keys(r.tablas).length} tablas.` +
        (omitidas ? ` ${omitidas} no se pudieron leer (van anotadas en el archivo).` : ''));
    } catch (e) {
      setResultado(`No se pudo armar el archivo: ${toUserMessage(e)}`);
    } finally {
      setProgreso(null);
    }
  }
  return (
    <section className="tarjeta p-4 space-y-2" aria-labelledby="t-mis-datos">
      <h2 id="t-mis-datos" className="font-semibold">Mis datos</h2>
      <p className="text-sm text-[var(--texto-suave)]">
        Descarga todo lo del local (productos, ventas, caja, inventario, clientes y proveedores) en un
        archivo JSON. Guárdalo como respaldo propio: se abre sin este sistema. Los respaldos diarios
        de la base siguen corriendo aparte.
      </p>
      <button onClick={() => void descargar()} disabled={progreso !== null} className="btn btn-secundario w-full sm:w-auto">
        <Icono nombre="descargar" tamano={18} /> {progreso ?? 'Descargar mis datos'}
      </button>
      {resultado && <p role="status" className="text-sm">{resultado}</p>}
    </section>
  );
}
