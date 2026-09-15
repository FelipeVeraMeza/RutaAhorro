'use client';

import { useEffect } from 'react';
import { useScanner } from '@/lib/scanner/useScanner';

/**
 * Vista de la cámara para escanear.
 * El botón de activar/desactivar es grande y está siempre visible: si la cámara
 * falla, el cajero debe poder apagarla y seguir vendiendo con la búsqueda.
 */
export function Escaner({
  activo, onToggle, onScan,
}: {
  activo: boolean;
  onToggle: () => void;
  onScan: (code: string) => void;
}) {
  const { videoRef, state, error, engine, start, stop } = useScanner({ onScan, enabled: activo });

  useEffect(() => {
    if (activo) void start();
    else stop();
  }, [activo, start, stop]);

  return (
    <div>
      <div className={`relative overflow-hidden rounded-xl bg-black ${activo ? 'aspect-[4/3]' : 'h-0'}`}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
        />

        {activo && state === 'escaneando' && (
          <>
            {/* Guía de encuadre */}
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="w-4/5 h-24 border-2 border-white/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-white/80">
              Apunta al código · {engine === 'nativo' ? 'lector rápido' : 'lector compatible'}
            </p>
          </>
        )}

        {activo && state === 'iniciando' && (
          <p className="absolute inset-0 grid place-items-center text-white text-sm">
            Abriendo cámara…
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-[var(--color-alerta)] bg-red-50 px-3 py-2 rounded-lg mt-2">
          {error}
        </p>
      )}

      <button
        onClick={onToggle}
        className={`tap w-full mt-2 py-3.5 rounded-xl font-semibold text-base ${
          activo
            ? 'border border-[var(--borde)] bg-white'
            : 'bg-marca-500 text-white active:bg-marca-600'
        }`}
      >
        {activo ? 'Cerrar cámara' : '📷  Escanear producto'}
      </button>
    </div>
  );
}
