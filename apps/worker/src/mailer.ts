import { formatCLP } from '@rutaahorro/core';
import { env } from './env.js';
import { log } from './logger.js';

/**
 * Envío de correo vía Resend.
 *
 * Si no hay API key configurada, registra el correo en el log en vez de fallar.
 * Un resumen diario que no se puede enviar no debe tumbar el worker ni impedir
 * que el respaldo de esa misma noche se ejecute.
 */
export async function sendEmail(subject: string, html: string, to = env.alertsEmailTo) {
  if (!env.resendApiKey || !to) {
    log.warn('Correo no enviado: falta RESEND_API_KEY o destinatario', { subject });
    return { sent: false, reason: 'sin_configurar' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.alertsEmailFrom, to: [to], subject, html }),
  });

  if (!res.ok) {
    throw new Error(`Resend respondió ${res.status}: ${await res.text()}`);
  }
  log.info('Correo enviado', { subject, to });
  return { sent: true };
}

/** Formato de moneda: se reutiliza el de @rutaahorro/core para que el correo
 *  y la pantalla muestren exactamente el mismo número. */
const money = formatCLP;

/** Plantilla del correo. Inline CSS: los clientes de correo ignoran <style>. */
export function renderEmail(title: string, sections: Array<{ heading: string; rows: string[][] }>) {
  const table = (rows: string[][]) =>
    rows.length === 0
      ? '<p style="margin:4px 0;color:#6b7280">Sin novedades.</p>'
      : `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows
          .map(
            (r) =>
              `<tr>${r
                .map(
                  (c, i) =>
                    `<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;${
                      i === r.length - 1 ? 'text-align:right;font-variant-numeric:tabular-nums' : ''
                    }">${c}</td>`,
                )
                .join('')}</tr>`,
          )
          .join('')}</table>`;

  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
    <h1 style="margin:0 0 4px;font-size:18px">${title}</h1>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px">RutaAhorro · ${new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full' })}</p>
    ${sections
      .map(
        (s) =>
          `<h2 style="margin:20px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#475569">${s.heading}</h2>${table(s.rows)}`,
      )
      .join('')}
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Correo automático del sistema. No respondas a esta dirección.</p>
  </div></body></html>`;
}

export { money };
