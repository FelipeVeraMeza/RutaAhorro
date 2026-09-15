'use client';

import { useEffect, useState } from 'react';
import { formatCLP, parseCLP, marginPct, isValidEan, normalizeBarcode, toUserMessage } from '@rutaahorro/core';
import { repoProductos, type Categoria, type Producto } from '@/lib/productos';
import { useScanner } from '@/lib/scanner/useScanner';

const UNIDADES = ['unidad', 'kg', 'gramo', 'litro', 'ml', 'paquete', 'caja'];

interface Props {
  producto: Producto | null;   // null = alta
  categorias: Categoria[];
  puedeVerCostos: boolean;
  onGuardado: () => void;
  onCancelar: () => void;
}

export function FormularioProducto({
  producto, categorias, puedeVerCostos, onGuardado, onCancelar,
}: Props) {
  const esEdicion = producto !== null;

  const [nombre, setNombre] = useState(producto?.nombre ?? '');
  const [sku, setSku] = useState(producto?.sku ?? '');
  const [categoriaId, setCategoriaId] = useState(producto?.categoriaId ?? '');
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [unidad, setUnidad] = useState(producto?.unidad ?? 'unidad');
  const [precio, setPrecio] = useState(producto ? String(producto.precioVenta) : '');
  const [costo, setCosto] = useState(producto?.costoPromedio ? String(producto.costoPromedio) : '');
  const [stockMinimo, setStockMinimo] = useState(String(producto?.stockMinimo ?? 0));
  const [stockInicial, setStockInicial] = useState('0');
  const [perecible, setPerecible] = useState(producto?.perecible ?? false);
  const [diasAlerta, setDiasAlerta] = useState(String(producto?.diasAlerta ?? 30));
  const [codigos, setCodigos] = useState<string[]>(producto?.codigos ?? []);
  const [codigoNuevo, setCodigoNuevo] = useState('');

  const [escaneando, setEscaneando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoCodigo, setAvisoCodigo] = useState<string | null>(null);

  const { videoRef, start, stop, error: errorCamara } = useScanner({
    enabled: escaneando,
    onScan: (code) => { void agregarCodigo(code); setEscaneando(false); },
  });

  useEffect(() => {
    if (escaneando) void start();
    else stop();
  }, [escaneando, start, stop]);

  const precioNum = parseCLP(precio) ?? 0;
  const costoNum = parseCLP(costo) ?? 0;
  const margen = precioNum > 0 && costoNum > 0 ? marginPct(precioNum, costoNum) : null;

  async function agregarCodigo(bruto: string) {
    const code = normalizeBarcode(bruto.trim());
    if (!code) return;
    setAvisoCodigo(null);

    if (codigos.includes(code)) {
      setAvisoCodigo('Ese código ya está en la lista');
      return;
    }
    // Verificación contra el catálogo: RF-M2-03
    const dueño = await repoProductos().codigoEnUso(code, producto?.id);
    if (dueño) {
      setAvisoCodigo(`Ese código ya pertenece a "${dueño}"`);
      return;
    }
    if (/^\d+$/.test(code) && [8, 12, 13].includes(code.length) && !isValidEan(code)) {
      setAvisoCodigo('Aviso: el dígito de control no cuadra. Verifica que esté bien copiado');
    }
    setCodigos((prev) => [...prev, code]);
    setCodigoNuevo('');
  }

  async function guardar() {
    setError(null);

    if (nombre.trim() === '') { setError('El nombre es obligatorio'); return; }
    if (precioNum <= 0) { setError('El precio de venta debe ser mayor que cero'); return; }

    setGuardando(true);
    try {
      const repo = repoProductos();

      let catId: string | null = categoriaId || null;
      if (nuevaCategoria.trim()) {
        catId = (await repo.crearCategoria(nuevaCategoria.trim())).id;
      }

      const base = {
        nombre: nombre.trim(),
        sku: sku.trim() || null,
        categoriaId: catId,
        unidad,
        precioVenta: precioNum,
        stockMinimo: parseCLP(stockMinimo) ?? 0,
        perecible,
        diasAlerta: parseCLP(diasAlerta) ?? 30,
        codigos,
      };

      if (esEdicion) {
        await repo.actualizar(producto.id, {
          ...base,
          ...(puedeVerCostos ? { costo: costoNum } : {}),
        });
      } else {
        await repo.crear({
          ...base,
          costo: costoNum,
          stockInicial: parseCLP(stockInicial) ?? 0,
        });
      }
      onGuardado();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-full flex items-end sm:items-center justify-center sm:p-4">
        <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl">
          <header className="sticky top-0 bg-white border-b border-[var(--borde)] px-4 py-3 flex items-center justify-between rounded-t-2xl">
            <h2 className="font-semibold">{esEdicion ? 'Editar producto' : 'Nuevo producto'}</h2>
            <button onClick={onCancelar} className="tap px-3 text-sm text-[var(--texto-suave)]">
              Cancelar
            </button>
          </header>

          <div className="p-4 space-y-4">
            <Campo etiqueta="Nombre" obligatorio>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Arroz grado 1 · 1 kg"
                className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
                autoFocus
              />
            </Campo>

            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Precio de venta" obligatorio>
                <input
                  inputMode="numeric" value={precio}
                  onChange={(e) => setPrecio(e.target.value)}
                  placeholder="0"
                  className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right"
                />
              </Campo>

              {puedeVerCostos && (
                <Campo etiqueta="Costo">
                  <input
                    inputMode="numeric" value={costo}
                    onChange={(e) => setCosto(e.target.value)}
                    placeholder="0"
                    className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right"
                  />
                </Campo>
              )}
            </div>

            {margen !== null && (
              <p className={`text-sm px-3 py-2 rounded-lg ${
                margen < 0 ? 'bg-red-50 text-red-900' : 'bg-marca-50 text-marca-900'
              }`}>
                Margen: <strong className="num">{formatCLP(precioNum - costoNum)}</strong>
                {' '}({margen}%)
                {margen < 0 && ' · estás vendiendo bajo el costo'}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="SKU / código interno">
                <input
                  value={sku} onChange={(e) => setSku(e.target.value)}
                  placeholder="Opcional"
                  className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)]"
                />
              </Campo>
              <Campo etiqueta="Unidad">
                <select
                  value={unidad} onChange={(e) => setUnidad(e.target.value)}
                  className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white"
                >
                  {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Campo>
            </div>

            <Campo etiqueta="Categoría">
              <select
                value={categoriaId}
                onChange={(e) => { setCategoriaId(e.target.value); setNuevaCategoria(''); }}
                className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] bg-white"
              >
                <option value="">Sin categoría</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <input
                value={nuevaCategoria}
                onChange={(e) => { setNuevaCategoria(e.target.value); setCategoriaId(''); }}
                placeholder="…o escribe una categoría nueva"
                className="tap w-full mt-2 px-3 py-2.5 rounded-xl border border-dashed border-[var(--borde)] text-sm"
              />
            </Campo>

            {/* Códigos de barras: RF-M2-02 permite varios por producto */}
            <Campo etiqueta="Códigos de barras">
              {codigos.length > 0 && (
                <ul className="flex flex-wrap gap-2 mb-2">
                  {codigos.map((c) => (
                    <li key={c} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--fondo)] text-sm num">
                      {c}
                      <button
                        onClick={() => setCodigos((p) => p.filter((x) => x !== c))}
                        aria-label={`Quitar código ${c}`}
                        className="text-[var(--color-alerta)] font-bold px-1"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <input
                  inputMode="numeric" value={codigoNuevo}
                  onChange={(e) => setCodigoNuevo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregarCodigo(codigoNuevo); } }}
                  placeholder="Escribe o escanea"
                  className="tap flex-1 px-3 py-2.5 rounded-xl border border-[var(--borde)] num"
                />
                <button
                  onClick={() => void agregarCodigo(codigoNuevo)}
                  className="tap px-4 rounded-xl border border-[var(--borde)] text-sm font-medium"
                >
                  Agregar
                </button>
                <button
                  onClick={() => setEscaneando((v) => !v)}
                  aria-label="Escanear código con la cámara"
                  className="tap px-4 rounded-xl bg-marca-500 text-white"
                >
                  📷
                </button>
              </div>

              {escaneando && (
                <div className="relative mt-2 h-40 rounded-xl overflow-hidden bg-black">
                  <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover" />
                  <div className="absolute inset-0 grid place-items-center pointer-events-none">
                    <div className="w-4/5 h-16 border-2 border-white/80 rounded-lg" />
                  </div>
                </div>
              )}
              {errorCamara && <p className="text-xs text-[var(--color-alerta)] mt-1">{errorCamara}</p>}
              {avisoCodigo && (
                <p className={`text-xs mt-1.5 ${
                  avisoCodigo.startsWith('Aviso') ? 'text-[var(--color-aviso)]' : 'text-[var(--color-alerta)]'
                }`}>
                  {avisoCodigo}
                </p>
              )}
            </Campo>

            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Stock mínimo">
                <input
                  inputMode="numeric" value={stockMinimo}
                  onChange={(e) => setStockMinimo(e.target.value)}
                  className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right"
                />
              </Campo>
              {!esEdicion && (
                <Campo etiqueta="Stock inicial">
                  <input
                    inputMode="numeric" value={stockInicial}
                    onChange={(e) => setStockInicial(e.target.value)}
                    className="tap w-full px-3 py-2.5 rounded-xl border border-[var(--borde)] num text-right"
                  />
                </Campo>
              )}
            </div>

            {/* Perecible: activa el control por lote y FEFO (ADR-007) */}
            <div className="rounded-xl border border-[var(--borde)] p-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox" checked={perecible}
                  onChange={(e) => setPerecible(e.target.checked)}
                  className="mt-0.5 w-5 h-5 accent-[var(--color-marca-500)]"
                />
                <span className="text-sm">
                  <strong className="block">Producto perecible</strong>
                  <span className="text-[var(--texto-suave)]">
                    Se controlará por lote con fecha de vencimiento. Al vender saldrá
                    primero el lote que vence antes.
                  </span>
                </span>
              </label>

              {perecible && (
                <div className="mt-3 pl-8">
                  <label className="block text-xs font-medium mb-1">
                    Avisar cuántos días antes de vencer
                  </label>
                  <input
                    inputMode="numeric" value={diasAlerta}
                    onChange={(e) => setDiasAlerta(e.target.value)}
                    className="tap w-24 px-3 py-2 rounded-lg border border-[var(--borde)] num text-right"
                  />
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="text-sm text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}
          </div>

          <footer
            className="sticky bottom-0 bg-white border-t border-[var(--borde)] p-4 flex gap-2"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            <button
              onClick={onCancelar}
              className="tap px-4 py-3 rounded-xl border border-[var(--borde)] font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={() => void guardar()}
              disabled={guardando}
              className="tap flex-1 py-3 rounded-xl bg-marca-500 text-white font-bold disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

function Campo({
  etiqueta, obligatorio, children,
}: {
  etiqueta: string;
  obligatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">
        {etiqueta}
        {obligatorio && <span className="text-[var(--color-alerta)]"> *</span>}
      </label>
      {children}
    </div>
  );
}
