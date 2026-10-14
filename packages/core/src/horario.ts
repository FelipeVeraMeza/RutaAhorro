/**
 * Horario de atención del local (RF-T71), para la tienda: "Abierto · cierra a
 * las 21:00" y el horario de la semana en el pie y en Contacto.
 *
 * Se guarda en `settings.tienda_horario` como un texto por día, igual que lo
 * escribiría el dueño: "09:00-14:00, 16:00-21:00", o vacío si ese día no abre.
 */

export const DIAS_SEMANA = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export type DiaSemana = typeof DIAS_SEMANA[number];
export type HorarioSemana = Partial<Record<DiaSemana, string>>;

export const NOMBRE_DIA: Record<DiaSemana, string> = {
  lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado', dom: 'domingo',
};
const CORTO: Record<DiaSemana, string> = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom' };

/** Un tramo en minutos desde la medianoche: [apertura, cierre). */
export type Tramo = [number, number];

function minutos(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

/**
 * "09:00-14:00, 16:00-21:00" → [[540, 840], [960, 1260]]. "9-21" también vale.
 * Vacío = cerrado ([]). Null si no se entiende o un tramo cierra antes de abrir.
 */
export function parsearTramos(texto: string | null | undefined): Tramo[] | null {
  const t = (texto ?? '').trim();
  if (!t || /^cerrado$/i.test(t)) return [];
  const tramos: Tramo[] = [];
  for (const parte of t.split(/[,;y]+/).map((x) => x.trim()).filter(Boolean)) {
    const [a, b, ...resto] = parte.split(/\s*[-–a]\s*/);
    if (resto.length || a == null || b == null) return null;
    const desde = minutos(a);
    const hasta = minutos(b);
    if (desde == null || hasta == null || hasta <= desde) return null;
    tramos.push([desde, hasta]);
  }
  tramos.sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < tramos.length; i++) if (tramos[i][0] < tramos[i - 1][1]) return null;
  return tramos;
}

/** Qué días tienen un horario que no se entiende. Vacío = todo bien. */
export function validarHorario(h: HorarioSemana): DiaSemana[] {
  return DIAS_SEMANA.filter((d) => parsearTramos(h[d]) == null);
}

/** "09:00", "21:30". */
export function hora(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function textoTramos(tramos: Tramo[]): string {
  return tramos.length ? tramos.map(([a, b]) => `${hora(a)}–${hora(b)}`).join(' y ') : 'Cerrado';
}

/** El día de la semana y el minuto del día en la zona del local. */
export function momentoLocal(ahora: Date, zona: string): { dia: DiaSemana; minuto: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ahora);
  const valor = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  const indice = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(valor('weekday'));
  return { dia: DIAS_SEMANA[Math.max(0, indice)], minuto: Number(valor('hour')) * 60 + Number(valor('minute')) };
}

/** ¿Hay algún día con horario? Sin ninguno, la tienda no muestra nada de esto. */
export function hayHorario(h: HorarioSemana | null | undefined): boolean {
  return Boolean(h) && DIAS_SEMANA.some((d) => (parsearTramos(h![d]) ?? []).length > 0);
}

/**
 * Abierto o cerrado ahora, en palabras:
 * "Abierto · cierra a las 21:00", "Cerrado · abre hoy a las 16:00",
 * "Cerrado · abre el lunes a las 09:00". Null sin horario.
 */
export function estadoAtencion(h: HorarioSemana | null | undefined, ahora: Date, zona: string): { abierto: boolean; texto: string } | null {
  if (!hayHorario(h)) return null;
  const { dia, minuto } = momentoLocal(ahora, zona);
  const hoy = parsearTramos(h![dia]) ?? [];
  const abiertoAhora = hoy.find(([a, b]) => minuto >= a && minuto < b);
  if (abiertoAhora) return { abierto: true, texto: `Abierto · cierra a las ${hora(abiertoAhora[1])}` };
  const despuesHoy = hoy.find(([a]) => a > minuto);
  if (despuesHoy) return { abierto: false, texto: `Cerrado · abre hoy a las ${hora(despuesHoy[0])}` };
  const i = DIAS_SEMANA.indexOf(dia);
  for (let k = 1; k <= 7; k++) {
    const d = DIAS_SEMANA[(i + k) % 7];
    const t = parsearTramos(h![d]) ?? [];
    if (t.length) return { abierto: false, texto: `Cerrado · abre ${k === 1 ? 'mañana' : `el ${NOMBRE_DIA[d]}`} a las ${hora(t[0][0])}` };
  }
  return null;
}

/**
 * El horario de la semana agrupando días seguidos iguales:
 * [{ dias: 'Lun a Vie', horas: '09:00–21:00' }, { dias: 'Dom', horas: 'Cerrado' }].
 */
export function resumenHorario(h: HorarioSemana | null | undefined): Array<{ dias: string; horas: string }> {
  if (!hayHorario(h)) return [];
  const filas: Array<{ desde: DiaSemana; hasta: DiaSemana; horas: string }> = [];
  for (const d of DIAS_SEMANA) {
    const horas = textoTramos(parsearTramos(h![d]) ?? []);
    const ultima = filas[filas.length - 1];
    if (ultima && ultima.horas === horas) ultima.hasta = d;
    else filas.push({ desde: d, hasta: d, horas });
  }
  return filas.map((f) => ({
    dias: f.desde === f.hasta ? CORTO[f.desde] : `${CORTO[f.desde]} a ${CORTO[f.hasta]}`,
    horas: f.horas,
  }));
}
