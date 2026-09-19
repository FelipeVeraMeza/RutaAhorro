/**
 * El día del local.
 *
 * Una venta se guarda como un instante (`timestamptz`), pero el almacenero
 * piensa en días: "lo vendido hoy". Pasar de uno a otro exige la zona horaria
 * del local, y en Chile esa zona cambia de desfase dos veces al año (-04:00 en
 * invierno, -03:00 en verano). Tres errores de este proyecto vinieron de
 * saltarse eso:
 *
 *  - Inicio armaba el día con '-03:00' escrito fijo: en invierno lo vendido
 *    después de las 23:00 aparecía al día siguiente.
 *  - Ventas filtraba con 'YYYY-MM-DDT00:00:00' sin zona, que la base lee en
 *    UTC: lo vendido después de las 20:00 o 21:00 no aparecía en su día.
 *  - fn_void_sale comparaba una fecha en UTC con otra en hora de Chile.
 *
 * La zona se recibe siempre como parámetro: viene de `tenants.settings`, no
 * de un valor escrito acá.
 */

const partes = (zona: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

/** Minutos que la zona está adelantada respecto de UTC en ese instante (Chile: -240 o -180). */
export function desfaseMinutos(zona: string, instante: Date): number {
  const p = Object.fromEntries(partes(zona).formatToParts(instante).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60000);
}

/** El día ('YYYY-MM-DD') al que pertenece un instante en la zona del local. */
export function diaLocal(instante: Date | string, zona: string): string {
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  return d.toLocaleDateString('en-CA', { timeZone: zona });
}

/** Suma días a una fecha 'YYYY-MM-DD'. Aritmética de calendario, sin zonas. */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * El instante en que empieza un día en la zona del local, como ISO en UTC.
 * El día de un cambio de horario la medianoche puede no existir (el reloj
 * salta de 23:59 a 01:00): se devuelve el primer instante que sí existe.
 */
export function inicioDelDia(fecha: string, zona: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const medianocheUtc = Date.UTC(y, m - 1, d);
  let t = medianocheUtc - desfaseMinutos(zona, new Date(medianocheUtc)) * 60000;
  const corregido = medianocheUtc - desfaseMinutos(zona, new Date(t)) * 60000;
  if (corregido !== t) t = Math.max(t, corregido);
  // Si la medianoche no existe, `t` cae en el día anterior: avanzar a la hora.
  while (diaLocal(new Date(t), zona) < fecha) t += 3600000;
  return new Date(t).toISOString();
}

/**
 * Rango [desde, hasta) en instantes para filtrar de un día a otro, ambos
 * incluidos, en la zona del local. `hasta` es exclusivo: el inicio del día
 * siguiente, así no hay que adivinar cuántos milisegundos tiene un segundo.
 */
export function rangoDeDias(desde: string, hasta: string, zona: string): { desde: string; hasta: string } {
  return { desde: inicioDelDia(desde, zona), hasta: inicioDelDia(sumarDias(hasta, 1), zona) };
}
