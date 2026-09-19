'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCLP, cantidadConUnidad } from '@rutaahorro/core';
import {
  findByBarcode, searchProducts, localProductCount, syncCatalog, EVENTO_CATALOGO,
} from '@/lib/offline/catalog';
import { DEMO_ACTIVO } from '@/lib/demo';
import { sembrarCatalogoDemo } from '@/lib/demo/seed';
import type { LocalProduct } from '@/lib/offline/db';
import { Escaner } from '../pos/Escaner';

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
 */
export function PrecioClient() {
  const [scannerOn, setScannerOn] = useState(false);
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<LocalProduct[]>([]);
  const [elegido, setElegido] = useState<LocalProduct | null>(null);
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
  useEffect(() => {
    const alCambiar = () => setVersionCatalogo((v) => v + 1);
    window.addEventListener(EVENTO_CATALOGO, alCambiar);
    return () => window.removeEventListener(EVENTO_CATALOGO, alCambiar);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResultados([]); return; }
    let vivo = true;
    void searchProducts(query).then((r) => { if (vivo) setResultados(r); });
    return () => { vivo = false; };
  }, [query, versionCatalogo]);

  const onScan = useCallback(async (code: string) => {
    const p = await findByBarcode(code);
    if (p) {
      setElegido(p);
      setQuery('');
      // La cámara se cierra al acertar: el precio ocupa la pantalla y nadie
      // quiere leerlo con la cámara encendida gastando batería.
      setScannerOn(false);
      return;
    }
    notificar(`El código ${code} no está en el catálogo`);
    setQuery(code);
  }, [notificar]);

  return (
    <div className="px-4 py-4">
      <h1 className="text-lg font-semibold mb-1">Consultar precio</h1>
      <p className="text-xs text-[var(--texto-suave)] mb-4">
        Escanea o busca el producto. No se cobra nada ni se toca la venta en curso.
      </p>

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
          </p>
          {/* Cuánto hay, con texto y no solo con color (RNF-46). Sirve para
              responder la segunda pregunta del mostrador: "¿y queda?". */}
          <p className="text-xs num mt-2">
            {elegido.stock <= 0
              ? <span className="text-[var(--color-alerta)]">🔴 Sin stock</span>
              : <>🟢 Quedan {cantidadConUnidad(elegido.stock, elegido.unit)}</>}
            {typeof elegido.stockSala === 'number' &&
              ` · en sala ${elegido.stockSala}`}
          </p>
        </div>
      )}

      {!elegido && resultados.length > 0 && (
        <ul className="tarjeta divide-y divide-[var(--borde)] overflow-hidden mt-3">
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => { setElegido(p); setQuery(''); }}
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
        <p className="text-center text-sm text-[var(--texto-suave)] py-8">
          No hay ningún producto que se llame así.
        </p>
      )}
    </div>
  );
}
