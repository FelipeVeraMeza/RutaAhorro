import { runBackup, cleanupOldBackups } from './backup.js';
import { runDailySummary } from './daily-summary.js';
import { runLowStockCheck, runExpiryCheck, runOpenCashCheck, runIntegrityCheck } from './checks.js';

/**
 * Catálogo de trabajos programados.
 * Los horarios están en `America/Santiago` (ver env.timezone).
 * Documentado en docs/08-api-contratos.md §5.
 */
export const JOBS = {
  'backup-daily': {
    schedule: '0 3 * * *',
    description: 'Respaldo completo de la base de datos',
    run: runBackup,
  },
  'cleanup-old-backups': {
    schedule: '30 4 * * *',
    description: 'Elimina respaldos fuera del período de retención',
    run: cleanupOldBackups,
  },
  'low-stock-check': {
    schedule: '0 8 * * *',
    description: 'Alertas de productos bajo stock mínimo',
    run: runLowStockCheck,
  },
  'expiry-check': {
    schedule: '15 8 * * *',
    description: 'Alertas de lotes vencidos y por vencer',
    run: runExpiryCheck,
  },
  'daily-summary': {
    schedule: '0 22 * * *',
    description: 'Correo de resumen del día al administrador',
    run: runDailySummary,
  },
  'open-cash-check': {
    schedule: '30 23 * * *',
    description: 'Avisa cajas que quedaron sin cerrar',
    run: runOpenCashCheck,
  },
  'integrity-check': {
    schedule: '0 4 * * 0',
    description: 'Reconstruye el stock desde el kardex y verifica lotes',
    run: runIntegrityCheck,
  },
} as const;

export type JobName = keyof typeof JOBS;

export function isJobName(name: string): name is JobName {
  return name in JOBS;
}
