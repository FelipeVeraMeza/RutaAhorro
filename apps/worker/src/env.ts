/**
 * Configuración del worker.
 *
 * Falla al arrancar si falta algo esencial. Un worker que arranca a medias y
 * falla recién a las 03:00 al intentar respaldar es peor que uno que no arranca:
 * el segundo se nota de inmediato.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. ` +
        `Configúrala en Railway (producción) o en .env.local (desarrollo).`,
    );
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const env = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL'),

  /**
   * service_role: OMITE RLS por completo.
   * Solo existe aquí, nunca en Vercel ni en el navegador (RNF-25).
   * Acepta el formato nuevo (sb_secret_) o el JWT legado.
   */
  serviceRoleKey: process.env.SUPABASE_SECRET_KEY ?? required('SUPABASE_SERVICE_ROLE_KEY'),

  /**
   * Railway inyecta PORT y enruta el dominio público a ese puerto. Si el worker
   * escuchara en otro, el healthcheck fallaría y el despliegue quedaría caído.
   * En local no existe PORT y manda WORKER_PORT.
   */
  port: Number(optional('PORT', optional('WORKER_PORT', '8080'))),
  sharedSecret: optional('WORKER_SHARED_SECRET'),

  backupBucket: optional('BACKUP_BUCKET', 'respaldos'),
  backupRetentionDays: Number(optional('BACKUP_RETENTION_DAYS', '30')),

  resendApiKey: optional('RESEND_API_KEY'),
  alertsEmailTo: optional('ALERTS_EMAIL_TO'),
  alertsEmailFrom: optional('ALERTS_EMAIL_FROM', 'RutaAhorro <onboarding@resend.dev>'),

  /**
   * Zona horaria de los trabajos programados.
   * Sin esto el contenedor corre en UTC y el "resumen de las 22:00" llegaría
   * a las 19:00 hora de Chile.
   */
  timezone: optional('TZ', 'America/Santiago'),

  /** Los cron solo corren en producción; en local se disparan a mano. */
  enableCron: optional('ENABLE_CRON', optional('NODE_ENV') === 'production' ? 'true' : 'false') === 'true',
};

export type Env = typeof env;
