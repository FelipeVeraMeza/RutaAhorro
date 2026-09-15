/**
 * Ejecuta un trabajo a mano, sin levantar el servidor:
 *   npm run job -w @rutaahorro/worker backup-daily
 */
import { recordJobRun } from './supabase.js';
import { JOBS, isJobName } from './jobs/index.js';
import { log } from './logger.js';

const name = process.argv[2];

if (!name || !isJobName(name)) {
  console.log('Trabajos disponibles:\n');
  for (const [job, def] of Object.entries(JOBS)) {
    console.log(`  ${job.padEnd(22)} ${def.schedule.padEnd(12)} ${def.description}`);
  }
  process.exit(name ? 1 : 0);
}

const result = await recordJobRun(name, JOBS[name].run);
log.info('Trabajo finalizado', { job: name, ...result });
process.exit(result.ok ? 0 : 1);
