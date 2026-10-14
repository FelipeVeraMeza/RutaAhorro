'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

/**
 * Sacar una foto en el momento, dentro de la app (Felipe, 2026-10-13: "que
 * se me abra la cámara"). El <input type="file"> abría el explorador de
 * archivos en el computador y, en el celular, preguntaba primero.
 *
 * Usa la webcam en el computador y la cámara trasera en el celular. Si el
 * navegador no da la cámara (sin permiso, sin cámara, página sin https), se
 * dice por qué y se ofrece elegir un archivo, que en el celular abre la cámara
 * igual gracias a `capture`.
 */
export function CamaraFoto({ onFoto, onCerrar }: { onFoto: (archivo: File) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState(false);

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let vivo = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no deja usar la cámara acá. Elige un archivo.');
        return;
      }
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (!vivo) { flujo.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) {
          video.current.srcObject = flujo;
          await video.current.play().catch(() => {});
          setLista(true);
        }
      } catch (e) {
        const nombre = (e as DOMException)?.name;
        setError(nombre === 'NotAllowedError'
          ? 'No diste permiso para usar la cámara. Actívalo en el candado de la barra de direcciones, o elige un archivo.'
          : nombre === 'NotFoundError'
            ? 'No se encontró una cámara en este equipo. Elige un archivo.'
            : 'No se pudo abrir la cámara. Elige un archivo.');
      }
    })();
    // Al cerrar se apaga la cámara: si no, la luz queda encendida.
    return () => { vivo = false; flujo?.getTracks().forEach((t) => t.stop()); };
  }, []);

  function sacar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const lienzo = document.createElement('canvas');
    lienzo.width = v.videoWidth;
    lienzo.height = v.videoHeight;
    lienzo.getContext('2d')?.drawImage(v, 0, 0);
    lienzo.toBlob((blob) => {
      if (blob) onFoto(new File([blob], 'foto.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  return (
    <Modal titulo="Sacar foto" encabezado="visible" onCerrar={onCerrar} ancho="md">
      <div className="p-4 space-y-3">
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-alerta)]">{error}</p>
        ) : (
          <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3] grid place-items-center">
            <video ref={video} playsInline muted className="w-full h-full object-contain" />
            {!lista && <span className="absolute text-sm text-white/80">Abriendo la cámara…</span>}
          </div>
        )}
        <div className="flex gap-2">
          {!error && (
            <button type="button" onClick={sacar} disabled={!lista}
              className="tap flex-1 py-3 rounded-xl bg-marca-500 text-white font-semibold disabled:opacity-40">
              Sacar foto
            </button>
          )}
          <label className="tap flex-1 inline-flex items-center justify-center px-3 rounded-xl border border-[var(--borde)] text-sm font-medium cursor-pointer">
            Elegir archivo
            <input type="file" accept="image/*" capture="environment" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFoto(f); e.target.value = ''; }} />
          </label>
        </div>
      </div>
    </Modal>
  );
}
