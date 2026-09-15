'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Lector de códigos de barras con la cámara (RF-M5-01 a RF-M5-03).
 *
 * Usa la API nativa `BarcodeDetector` cuando existe (Chrome Android, Edge) y
 * cae a ZXing en el resto (Safari iOS, Firefox). La carga de ZXing es diferida:
 * en los dispositivos donde no hace falta, no se descarga (RNF-06).
 *
 * Requiere HTTPS. En `localhost` funciona igual; desde la IP de la red local,
 * no (ver docs/09-despliegue.md §2.4).
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

/** Un código en cuadro se lee ~15 veces por segundo; sin esto el carrito explota. */
const DEBOUNCE_MS = 1200;

export type ScannerState = 'inactivo' | 'iniciando' | 'escaneando' | 'error';

interface UseScannerOptions {
  onScan: (code: string) => void;
  enabled?: boolean;
}

export function useScanner({ onScan, enabled = true }: UseScannerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [state, setState] = useState<ScannerState>('inactivo');
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<'nativo' | 'zxing' | null>(null);

  /** Retroalimentación inmediata: el cajero no debe mirar la pantalla. */
  const feedback = useCallback(() => {
    try {
      navigator.vibrate?.(60);
    } catch { /* el dispositivo puede no soportar vibración */ }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 1180;
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.11);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.11);
      osc.onended = () => void ctx.close();
    } catch { /* audio bloqueado hasta la primera interacción del usuario */ }
  }, []);

  const emit = useCallback((code: string) => {
    const now = Date.now();
    const last = lastScanRef.current;
    if (code === last.code && now - last.at < DEBOUNCE_MS) return;
    lastScanRef.current = { code, at: now };
    feedback();
    onScanRef.current(code);
  }, [feedback]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState('inactivo');
  }, []);

  const start = useCallback(async () => {
    if (!videoRef.current) return;
    setState('iniciando');
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },   // cámara trasera
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(s: CanvasImageSource): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;

      if (Detector) {
        setEngine('nativo');
        const detector = new Detector({ formats: FORMATS });
        const tick = async () => {
          if (!videoRef.current || !streamRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (found.length > 0 && found[0].rawValue) emit(found[0].rawValue);
          } catch { /* un frame ilegible no es un error del sistema */ }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        void tick();
      } else {
        // Safari iOS y Firefox: respaldo con ZXing, cargado solo aquí.
        setEngine('zxing');
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) emit(result.getText());
        });
      }

      setState('escaneando');
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'No diste permiso para usar la cámara. Búscalo en los ajustes del navegador.'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No encontramos una cámara en este dispositivo.'
            : !window.isSecureContext
              ? 'La cámara necesita una conexión segura (https).'
              : 'No pudimos abrir la cámara. Usa la búsqueda por nombre.';
      setError(message);
      setState('error');
    }
  }, [emit]);

  useEffect(() => {
    if (!enabled) stop();
    return () => stop();
  }, [enabled, stop]);

  return { videoRef, state, error, engine, start, stop };
}
