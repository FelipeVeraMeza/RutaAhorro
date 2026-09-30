'use client';

/**
 * Manda un error del navegador al servidor (RNF-40), que lo escribe en su
 * registro: en Railway queda en los logs del servicio web, con la pantalla,
 * el mensaje y la traza. Antes un error en el celular del cajero se perdía y
 * solo se sabía si alguien llamaba.
 *
 * No tiene que romper nada: sin red o con el servidor caído, no pasa nada.
 * Se limita a 5 reportes por minuto para no inundar el registro con el mismo
 * error repetido en un bucle.
 */
const enviados: number[] = [];

export function reportarError(error: unknown, contexto: Record<string, unknown> = {}) {
  try {
    const ahora = Date.now();
    while (enviados.length && ahora - enviados[0] > 60_000) enviados.shift();
    if (enviados.length >= 5) return;
    enviados.push(ahora);
    const e = error instanceof Error ? error : new Error(String(error));
    const cuerpo = JSON.stringify({
      mensaje: e.message.slice(0, 500),
      pila: (e.stack ?? '').slice(0, 2000),
      digest: (e as { digest?: string }).digest,
      ruta: window.location.pathname,
      navegador: navigator.userAgent.slice(0, 200),
      enLinea: navigator.onLine,
      ...contexto,
    });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/errores', new Blob([cuerpo], { type: 'application/json' }));
    else void fetch('/api/errores', { method: 'POST', body: cuerpo, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch { /* reportar nunca puede ser otro error */ }
}
