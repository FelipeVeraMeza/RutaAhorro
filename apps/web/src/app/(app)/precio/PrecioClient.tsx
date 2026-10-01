'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatCLP, cantidadConUnidad, tramosVigentes, diaLocal, precioDelTramo, validarCantidadVenta, admiteDecimales,
} from '@rutaahorro/core';
import { useConfiguracion } from '@/lib/datos/configuracion';
import {
  findByBarcode, searchProducts, localProductCount, syncCatalog, EVENTO_CATALOGO,
} from '@/lib/offline/catalog';
import { DEMO_ACTIVO } from '@/lib/demo';
import { sembrarCatalogoDemo } from '@/lib/demo/seed';
import { db, type LocalProduct } from '@/lib/offline/db';
import { pedirAgregarAlPos } from '@/lib/offline/carro';
import { Campo } from '@/components/Campo';
import { Escaner } from '../pos/Escaner';
import { Encabezado } from '@/components/Encabezado';

/**
 * Consultador de precios (pedido del cliente, reunión 2026-09-19).
 *
 * Es la pregunta que más se hace en el mostrador —"¿cuánto vale esto?"— y
 * hasta hoy había que abrir Vender, agregarlo al carrito para verle el precio
 * y después vaciar el carrito. Eso es peligroso: el carrito abierto es de una
 * venta en curso, y consultar un precio no puede arriesgar una venta.
 *
 * Por eso esta pantalla no tiene carrito y no cobra nada. Lee el mismo
 * catálogo local que el POS, así que **funciona sin internet**, que es cuando
 * el cliente igual está esperando la respuesta.
 *
 * Si el cliente dice "me lo llevo", "Agregar a la venta" lo pasa al POS con la
 * cantidad (Felipe, 2026-09-28: «descontar directamente desde ahí»). El
 * consultador sigue sin tocar el carrito: deja el pedido y el POS lo agrega a
 * la venta en curso, que se conserva (sessionStorage).
 */
export function PrecioClient({ usuarioId = '', puedeVender = false, puedeCrearProductos = false }: {
  usuarioId?: string;
  /** Admin, supervisor y bodega: un código desconocido se crea desde acá (RF-M5-04). */
  puedeCrearProductos?: boolean;
  /** Admin, supervisor y vendedor. Bodega consulta, pero no vende. */
  puedeVender?: boolean;
}) {
  const router = useRouter();
  const [cantidad, setCantidad] = useState('1');
  const [errorCantidad, setErrorCantidad] = useState<string | null>(null);
  const [scannerOn, setScannerOn] = useState(false);
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<LocalProduct[]>([]);
  const [elegido, setElegido] = useState<LocalProduct | null>(null);
  const { zonaHoraria, ofertasActivas } = useConfiguracion();
  const [aviso, setAviso] = useState<string | null>(null);
  const [catalogoListo, setCatalogoListo] = useState<boolean | null>(null);
  const avisoTimer = useRef<number | null>(null);

  const notificar = useCallback((texto: string) => {
    setAviso(texto);
    if (avisoTimer.current) window.clearTimeout(avisoTimer.current);
    avisoTimer.current = window.setTimeout(() => setAviso(null), 3200);
  }, []);

  useEffect(() => {
    void (async () => {
      if (DEMO_ACTIVO) {
        if ((await localProductCount()) === 0) await sembrarCatalogoDemo();
        setCatalogoListo(true);
        return;
      }
      const n = await localProductCount();
      if (n === 0 && navigator.onLine) {
        try { await syncCatalog(true); } catch { /* se resuelve con el contador */ }
      } else if (navigator.onLine) {
        void syncCatalog().catch(() => {});
      }
      setCatalogoListo((await localProductCount()) > 0);
    })();
  }, []);

  const [versionCatalogo, setVersionCatalogo] = useState(0);
  // Lo que se está mostrando se vuelve a leer cuando el catálogo cambia: si
  // no, un producto elegido antes de que terminara de bajar el catálogo se
  // quedaba sin la oferta que llegó un segundo después.
  const elegidoRef = useRef(elegido);
  elegidoRef.current = elegido;
  useEffect(() => {
    const alCambiar = () => {
      setVersionCatalogo((v) => v + 1);
      const actual = elegidoRef.current;
      if (actual) void db().products.get(actual.id).then((p) => { if (p && elegidoRef.current?.id === p.id) setElegido(p); });
    };
    window.addEventListener(EVENTO_CATALOGO, alCambiar);
    return () => window.removeEventListener(EVENTO_CATALOGO, alCambiar);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResultados([]); return; }
    let vivo = true;
    void searchProducts(query).then((r) => { if (vivo) setResultados(r); });
    return () => { vivo = false; };
  }, [query, versionCatalogo]);

  const elegir = useCallback((p: LocalProduct) => {
    setElegido(p);
    setCantidad('1');
    setErrorCantidad(null);
  }, []);

  function agregarALaVenta() {
    if (!elegido) return;
    const v = validarCantidadVenta(cantidad, elegido.unit);
    if (!v.valido) { setErrorCantidad(v.error); return; }
    pedirAgregarAlPos(usuarioId, elegido.id, v.valor);
    router.push('/pos');
  }

  const onScan = useCallback(async (code: string) => {
    const p = await findByBarcode(code);
    if (p) {
      elegir(p);
      setQuery('');
      // La cámara se cierra al acertar: el precio ocupa la pantalla y nadie
      // quiere leerlo con la cámara encendida gastando batería.
      setScannerOn(false);
      return;
    }
    notificar(`El código ${code} no está en el catálogo`);
    setQuery(code);
  }, [notificar, elegir]);

  return (
    <div className="px-4 py-4">
      <Encabezado
        titulo="Consultar precio"
        icono="precio"
        descripcion="Escanea o busca el producto. Consultar no toca la venta en curso, y funciona sin internet."
      />

      {aviso && (
        <p role="status" className="text-sm bg-[var(--fondo)] px-3 py-2 rounded-lg mb-3">
          {aviso}
        </p>
      )}

      {catalogoListo === false && (
        <p role="alert" className="text-sm text-[var(--color-aviso)] bg-amber-50 px-3 py-2 rounded-lg mb-3">
          Todavía no hay catálogo en este dispositivo. Conéctate una vez para descargarlo.
        </p>
      )}

      <Escaner activo={scannerOn} onToggle={() => setScannerOn((v) => !v)} onScan={(c) => void onScan(c)} />

      <input
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setElegido(null); }}
        // Un lector físico escribe el código y presiona Enter (RQ-13).
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const texto = query.trim();
          if (/^\d{4,}$/.test(texto)) void onScan(texto);
          else if (resultados.length === 1) { elegir(resultados[0]); setQuery(''); }
        }}
        enterKeyHint="search"
        placeholder="Buscar por nombre o código…"
        aria-label="Buscar un producto para ver su precio"
        className="tap w-full px-4 py-3 rounded-xl border border-[var(--borde)] bg-white mt-3"
      />

      {/* -------------------------------------------------------- RESULTADO */}
      {elegido && (
        <div className="tarjeta p-5 mt-4 text-center">
          <p className="text-base font-semibold">{elegido.name}</p>
          {elegido.description && (
            <p className="text-xs text-[var(--texto-suave)] mt-0.5">{elegido.description}</p>
          )}
          <p className="num text-4xl font-bold text-marca-700 my-3">
            {formatCLP(elegido.salePrice)}
          </p>
          <p className="text-xs text-[var(--texto-suave)]">
            Precio por {elegido.unit} · IVA incluido
            {elegido.impuestoNombre && ` · incluye ${elegido.impuestoNombre}`}
          </p>
          {/* Ofertas vigentes (0018): lo segundo que pregunta el cliente es
              "¿y si llevo más?". */}
          {tramosVigentes(ofertasActivas ? elegido.tramos : [], diaLocal(new Date(), zonaHoraria))
            .map((t) => ({ ...t, precio: precioDelTramo(t, elegido.salePrice) }))
            .filter((t) => t.precio < elegido.salePrice)
            .map((t) => (
              <p key={`${t.desde}-${t.vigenteHasta ?? ''}`}
                 className="mt-2 inline-block mx-1 px-3 py-1 rounded-full bg-marca-100 text-marca-900 text-sm font-semibold num">
                🏷️ Desde {cantidadConUnidad(t.desde, elegido.unit)}: {formatCLP(t.precio)} {admiteDecimales(elegido.unit) ? `el ${elegido.unit}` : 'c/u'}
                {t.vigenteHasta && <span className="font-normal"> · hasta el {t.vigenteHasta.split('-').reverse().join('-')}</span>}
              </p>
            ))}
          {/* Cuánto hay, con texto y no solo con color (RNF-46). Sirve para
              responder la segunda pregunta del mostrador: "¿y queda?". */}
          <p className="text-xs num mt-2">
            {elegido.stock <= 0
              ? <span className="text-[var(--color-alerta)]">🔴 Sin stock</span>
              : <>🟢 Quedan {cantidadConUnidad(elegido.stock, elegido.unit)}</>}
          </p>
          {elegido.venceProximo && elegido.venceProximo < diaLocal(new Date(), zonaHoraria) && (
            <p role="alert" className="text-xs mt-2 text-[var(--color-alerta)]">
              ⚠ Hay un lote vencido el {elegido.venceProximo.split('-').reverse().join('-')}: revisa la fecha antes de venderlo.
            </p>
          )}
          {puedeVender && (
            <div className="mt-4 pt-4 border-t border-[var(--borde)] text-left">
              <div className="flex items-end gap-2">
                <div className="shrink-0">
                  {/* El error va debajo de la fila, a todo el ancho: en la
                      columna del campo no cabe. Se anuncia con role=alert. */}
                  <Campo etiqueta={admiteDecimales(elegido.unit) ? `Cantidad (${elegido.unit})` : 'Cantidad'}>
                    {(p) => (
                      <input
                        {...p}
                        type="text"
                        inputMode={admiteDecimales(elegido.unit) ? 'decimal' : 'numeric'}
                        value={cantidad}
                        onChange={(e) => { setCantidad(e.target.value); setErrorCantidad(null); }}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarALaVenta(); } }}
                        aria-invalid={errorCantidad ? true : undefined}
                        className="tap w-20 px-2 rounded-xl border border-[var(--borde)] text-center num font-semibold"
                      />
                    )}
                  </Campo>
                </div>
                <button
                  onClick={agregarALaVenta}
                  className="tap flex-1 px-3 rounded-xl bg-marca-500 text-white font-semibold whitespace-nowrap active:bg-marca-600"
                >
                  🛒 Agregar a la venta
                </button>
              </div>
              {errorCantidad && (
                <p role="alert" className="text-xs text-[var(--color-alerta)] mt-1.5">{errorCantidad}</p>
              )}
            </div>
          )}
        </div>
      )}

      {!elegido && resultados.length > 0 && (
        <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden mt-3">
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => { elegir(p); setQuery(''); }}
                className="tap w-full text-left px-4 py-3 flex items-center justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm truncate">{p.name}</span>
                  <span className="block text-xs text-[var(--texto-suave)] num">
                    {p.stock <= 0 ? 'Sin stock' : `Quedan ${cantidadConUnidad(p.stock, p.unit)}`}
                  </span>
                </span>
                <span className="num font-semibold shrink-0">{formatCLP(p.salePrice)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!elegido && query.trim().length >= 2 && resultados.length === 0 && (
        /\d{4,}/.test(query.trim()) && /^[0-9A-Za-z-]{4,40}$/.test(query.trim()) ? (
          <div className="tarjeta p-4 text-sm text-center mt-2">
            <p className="font-medium">El código <span className="num">{query.trim()}</span> no está en el catálogo.</p>
            {puedeCrearProductos && (
              <Link href={`/productos?nuevo=${encodeURIComponent(query.trim())}`} prefetch={false} className="btn btn-secundario w-full mt-3">
                Crear el producto con este código
              </Link>
            )}
          </div>
        ) : (
          <p className="text-center text-sm text-[var(--texto-suave)] py-8">
            No hay ningún producto que se llame así.
          </p>
        )
      )}
    </div>
  );
}
