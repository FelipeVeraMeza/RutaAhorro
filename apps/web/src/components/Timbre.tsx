'use client';

import { useEffect, useState } from 'react';
import { construirTed, desdeRegistro, type RegistroDte } from '@rutaahorro/core';

/**
 * El timbre electrónico impreso: el TED codificado en PDF417 (docs/18 §2).
 *
 * La representación impresa de una boleta o factura electrónica lleva este
 * código obligatoriamente; no es un QR. El PDF417 va con nivel de corrección
 * de errores 5, y el TED en ISO-8859-1: un carácter fuera de ese juego (un
 * emoji en el nombre de un producto) se reemplaza, porque el lector del SII
 * no lo puede leer.
 *
 * En simulación el TED no está firmado: el código es real y se puede leer,
 * pero dice SIMULADO donde iría la firma, y el papel lo advierte arriba.
 */
export function Timbre({ dte }: { dte: RegistroDte }) {
  // bwip-js pesa ~200 kB y solo hace falta al mostrar un documento: se carga
  // en ese momento y no con la pantalla de Vender (RNF-06, RNF-01).
  const [svg, setSvg] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    void import('bwip-js/browser').then(({ toSVG }) => {
      try {
        const ted = construirTed(desdeRegistro(dte)).replace(/[^\u0000-ÿ]/g, '?');
        // `eclevel` y `columns` son opciones del PDF417 en el motor (BWIPP);
        // los tipos de bwip-js no las declaran.
        const opciones: Parameters<typeof toSVG>[0] & { eclevel: number; columns: number } = {
          bcid: 'pdf417', text: ted, eclevel: 5, columns: 10, scaleX: 1, scaleY: 1, padding: 0,
        };
        if (vivo) setSvg(toSVG(opciones));
      } catch {
        if (vivo) setSvg(null);
      }
    }, () => { if (vivo) setSvg(null); });
    return () => { vivo = false; };
  }, [dte]);

  const simulado = dte.ambiente === 'simulacion';
  return (
    <figure className="mt-3 text-center" aria-label="Timbre electrónico">
      {svg === undefined
        ? <div className="mx-auto w-full max-w-[260px] h-16 bg-[var(--fondo)] animate-pulse" aria-label="Dibujando el timbre" />
        : svg
        ? <div className="mx-auto w-full max-w-[260px] [&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
        : <p className="text-[10px]">(no se pudo dibujar el timbre)</p>}
      <figcaption className="text-[10px] leading-4 mt-1">
        Timbre Electrónico SII
        {simulado
          ? <><br />DOCUMENTO SIMULADO · NO FIRMADO<br />SIN VALIDEZ TRIBUTARIA</>
          : <><br />Verifique documento: www.sii.cl</>}
      </figcaption>
    </figure>
  );
}
