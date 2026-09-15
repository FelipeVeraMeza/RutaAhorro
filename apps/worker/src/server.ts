import { createServer } from 'node:http';
import cron from 'node-cron';
import { env } from './env.js';
import { log } from './logger.js';
import { recordJobRun } from './supabase.js';
import { JOBS, isJobName, type JobName } from './jobs/index.js';

/**
 * Worker de RutaAhorro (Railway).
 *
 * Dos responsabilidades:
 *  1. Ejecutar los trabajos programados (respaldo, resumen, alertas, integridad)
 *  2. Exponer endpoints internos para dispararlos a mano
 *
 * Ver docs/adr/ADR-003-vercel-railway.md: esto vive fuera de Vercel porque un
 * respaldo o un reporte grande no caben en una función serverless.
 */

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Comparación en tiempo constante: comparar secretos con === filtra información
 * por el tiempo de respuesta.
 */
function secretMatches(provided: string | undefined): boolean {
  if (!env.sharedSecret) return true; // sin secreto configurado (solo desarrollo)
  if (!provided || provided.length !== env.sharedSecret.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ env.sharedSecret.charCodeAt(i);
  }
  return diff === 0;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Healthcheck de Railway: sin autenticación a propósito.
  if (path === '/health' || path === '/') {
    return json(res, 200, {
      status: 'ok',
      service: 'rutaahorro-worker',
      timezone: env.timezone,
      cron: env.enableCron,
      jobs: Object.keys(JOBS),
      now: new Date().toISOString(),
    });
  }

  if (!secretMatches(req.headers['x-worker-secret'] as string | undefined)) {
    return json(res, 401, { error: { code: 'NO_AUTORIZADO', message: 'Falta o no coincide X-Worker-Secret' } });
  }

  if (path === '/jobs' && req.method === 'GET') {
    return json(res, 200, {
      jobs: Object.entries(JOBS).map(([name, j]) => ({
        name, schedule: j.schedule, description: j.description,
      })),
    });
  }

  const jobMatch = path.match(/^\/jobs\/([a-z-]+)$/);
  if (jobMatch && req.method === 'POST') {
    const name = jobMatch[1];
    if (!isJobName(name)) {
      return json(res, 404, { error: { code: 'NO_ENCONTRADO', message: `No existe el trabajo "${name}"` } });
    }
    log.info('Ejecución manual de trabajo', { job: name });
    const result = await recordJobRun(name, JOBS[name].run);
    return json(res, result.ok ? 200 : 500, result);
  }

  return json(res, 404, { error: { code: 'NO_ENCONTRADO', message: 'Ruta no encontrada' } });
});

server.listen(env.port, () => {
  log.info('Worker escuchando', { port: env.port, timezone: env.timezone, cron: env.enableCron });

  if (!env.enableCron) {
    log.warn('Cron DESACTIVADO. Dispara los trabajos con POST /jobs/<nombre> o `npm run job <nombre>`');
    return;
  }

  for (const [name, job] of Object.entries(JOBS)) {
    cron.schedule(
      job.schedule,
      async () => {
        log.info('Trabajo programado iniciado', { job: name });
        const result = await recordJobRun(name as JobName, job.run);
        if (!result.ok) log.error('Trabajo programado falló', { job: name, error: result.error });
        else log.info('Trabajo programado completado', { job: name });
      },
      { timezone: env.timezone },
    );
    log.info('Trabajo programado', { job: name, schedule: job.schedule });
  }
});

// Railway envía SIGTERM al redesplegar: terminar limpio evita dejar un trabajo
// a medias marcado como "running" para siempre.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log.info('Apagando worker', { signal });
    server.close(() => process.exit(0));
  });
}
