/**
 * Lectura de planillas Excel (.xlsx) para la carga masiva de productos.
 *
 * Por qué existe, si ya se leía CSV: porque el almacenero **no tiene un CSV**.
 * Tiene un Excel, o una planilla de Google, o la lista que le manda el
 * proveedor. Pedirle "guárdalo como CSV, separado por punto y coma, en UTF-8"
 * antes de poder usar el sistema es pedirle que resuelva un problema nuestro,
 * y es justo donde se abandona una migración (P-08).
 *
 * Por qué sin biblioteca: un .xlsx es un ZIP con XML adentro, y las dos piezas
 * difíciles —inflar y decodificar— ya vienen en la plataforma
 * (`DecompressionStream`, `TextDecoder`). Traer un lector de Excel completo
 * serían cientos de kilobytes en una aplicación que se usa desde un celular
 * con datos móviles, para leer once columnas.
 *
 * Lo que este lector hace y lo que no:
 *
 * - Lee la **primera hoja** del libro. Si hay más de una, la pantalla lo dice.
 * - Devuelve una matriz de texto. La validación es la misma de siempre
 *   (`parsearProductos`): un .xlsx y un .csv terminan en el mismo camino, así
 *   que no hay dos juegos de reglas que se puedan desincronizar.
 * - **No** evalúa fórmulas: usa el último valor que Excel dejó calculado, que
 *   es el que se ve en pantalla.
 * - **No** lee .xls antiguo (binario de 1997) ni archivos con contraseña. Los
 *   dos se avisan con un mensaje que dice qué hacer.
 */

/** Lo que no se pudo leer, ya en lenguaje del negocio. */
export class ErrorPlanilla extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorPlanilla';
  }
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

interface EntradaZip {
  nombre: string;
  metodo: number;
  offsetLocal: number;
  tamComprimido: number;
}

const FIRMA_EOCD = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

function u16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

function u32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

/**
 * Índice del ZIP.
 *
 * Se busca el fin del directorio central desde el final, que es como manda el
 * formato: el encabezado del archivo no dice dónde está nada. El comentario
 * final puede ocupar hasta 64 KB, así que ese es el tramo que se recorre.
 */
function leerDirectorio(datos: Uint8Array): Map<string, EntradaZip> {
  let eocd = -1;
  const desde = Math.max(0, datos.length - 65_557);
  for (let i = datos.length - 22; i >= desde; i--) {
    if (u32(datos, i) === FIRMA_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) {
    throw new ErrorPlanilla('El archivo está dañado o no es una planilla de Excel');
  }

  const total = u16(datos, eocd + 10);
  let p = u32(datos, eocd + 16);
  if (total === 0xffff || p === 0xffffffff) {
    throw new ErrorPlanilla('La planilla es demasiado grande para leerla en el navegador');
  }

  const entradas = new Map<string, EntradaZip>();
  const texto = new TextDecoder('utf-8');
  for (let n = 0; n < total; n++) {
    if (u32(datos, p) !== FIRMA_CENTRAL) break;
    const metodo = u16(datos, p + 10);
    const tamComprimido = u32(datos, p + 20);
    const largoNombre = u16(datos, p + 28);
    const largoExtra = u16(datos, p + 30);
    const largoComentario = u16(datos, p + 32);
    const offsetLocal = u32(datos, p + 42);
    const nombre = texto.decode(datos.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, { nombre, metodo, offsetLocal, tamComprimido });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

async function inflar(comprimido: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const escritor = ds.writable.getWriter();
  void escritor.write(comprimido);
  void escritor.close();

  const partes: Uint8Array[] = [];
  const lector = ds.readable.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    if (value) partes.push(value as Uint8Array);
  }
  const total = partes.reduce((t, x) => t + x.length, 0);
  const salida = new Uint8Array(total);
  let i = 0;
  for (const parte of partes) { salida.set(parte, i); i += parte.length; }
  return salida;
}

async function leerEntrada(datos: Uint8Array, e: EntradaZip): Promise<string> {
  if (u32(datos, e.offsetLocal) !== FIRMA_LOCAL) {
    throw new ErrorPlanilla('La planilla está dañada y no se puede leer');
  }
  // El encabezado local repite el nombre y los extras, y sus largos no tienen
  // por qué coincidir con los del directorio central: hay que leerlos de acá.
  const inicio =
    e.offsetLocal + 30 + u16(datos, e.offsetLocal + 26) + u16(datos, e.offsetLocal + 28);
  const crudo = datos.subarray(inicio, inicio + e.tamComprimido);

  if (e.metodo === 0) return new TextDecoder('utf-8').decode(crudo);
  if (e.metodo !== 8) {
    throw new ErrorPlanilla('La planilla usa una compresión que no sabemos leer');
  }
  return new TextDecoder('utf-8').decode(await inflar(crudo));
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function desescapar(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (todo, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const n = cuerpo[1] === 'x' || cuerpo[1] === 'X'
        ? parseInt(cuerpo.slice(2), 16)
        : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[cuerpo] ?? todo;
  });
}

/** Junta el texto de todos los `<t>` que haya dentro del fragmento. */
function textoDeT(fragmento: string): string {
  let salida = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragmento)) !== null) salida += desescapar(m[1] ?? '');
  return salida;
}

/**
 * Tabla de textos compartidos.
 *
 * Excel no repite un texto que aparece en varias celdas: lo guarda una vez acá
 * y en la celda deja el índice. Un `<si>` puede venir partido en varios `<r>`
 * si el usuario puso una palabra en negrita en medio, y hay que juntarlos o el
 * nombre del producto llega cortado.
 */
function leerTextosCompartidos(xml: string): string[] {
  const salida: string[] = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) salida.push(textoDeT(m[1] ?? ''));
  return salida;
}

/** "BC12" → 54 (índice de columna, base 0). */
export function columnaDesdeRef(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;   // deja de contar al llegar al número de fila
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * Número de serie de Excel → fecha ISO.
 *
 * Excel cuenta días desde 1900 y arrastra un error famoso: cree que 1900 fue
 * bisiesto, así que tiene un 29 de febrero que no existió. Ese día fantasma es
 * el número 60, y a partir de ahí toda la cuenta va corrida un día.
 *
 * Por eso hay dos anclas y no una. La receta corriente —anclar en el 30/12/1899
 * y olvidarse— acierta de la serie 61 en adelante, que son todas las fechas que
 * alguien va a escribir en una planilla de productos, y falla por un día en
 * enero y febrero de 1900. Se corrigen igual: una fecha mal leída es una fecha
 * mal leída, y el día que alguien importe un histórico no vamos a estar acá
 * para explicar por qué ese mes salió corrido.
 */
export function fechaDesdeSerie(serie: number): string {
  const dias = Math.floor(serie);
  const ancla = dias < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(ancla + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Formatos de fecha que Excel trae de fábrica (ECMA-376, §18.8.30). */
const FORMATOS_FECHA = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function estilosDeFecha(xml: string | null): Set<number> {
  const fechas = new Set<number>();
  if (!xml) return fechas;

  // Los formatos que definió el usuario: se consideran fecha si el código
  // menciona día, mes o año, ignorando lo que vaya entre comillas o corchetes
  // —"mes" como texto literal no convierte un número en fecha—.
  const personalizados = new Set<number>();
  const reFmt = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = reFmt.exec(xml)) !== null) {
    const codigo = desescapar(m[2]).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    if (/[dmy]/i.test(codigo)) personalizados.add(Number(m[1]));
  }

  const bloque = xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? '';
  const reXf = /<xf\b[^>]*>/g;
  let i = 0;
  while ((m = reXf.exec(bloque)) !== null) {
    const id = Number(m[0].match(/numFmtId="(\d+)"/)?.[1] ?? NaN);
    if (FORMATOS_FECHA.has(id) || personalizados.has(id)) fechas.add(i);
    i++;
  }
  return fechas;
}

// ---------------------------------------------------------------------------
// Hoja
// ---------------------------------------------------------------------------

function celdasDeFila(
  filaXml: string, compartidos: string[], estilosFecha: Set<number>,
): string[] {
  const celdas: string[] = [];
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  let siguiente = 0;

  while ((m = re.exec(filaXml)) !== null) {
    const atributos = m[1] ?? '';
    const cuerpo = m[2] ?? '';
    const ref = atributos.match(/\br="([A-Z]+\d+)"/)?.[1];
    const tipo = atributos.match(/\bt="([^"]+)"/)?.[1] ?? 'n';
    const estilo = Number(atributos.match(/\bs="(\d+)"/)?.[1] ?? NaN);

    // Excel no escribe las celdas vacías: si la columna B está en blanco, el
    // XML salta de A a C. Sin mirar la referencia, el precio terminaría
    // guardado en la columna del código de barra.
    const col = ref ? columnaDesdeRef(ref) : siguiente;
    while (celdas.length < col) celdas.push('');
    siguiente = col + 1;

    let valor: string;
    if (tipo === 's') {
      const idx = Number(desescapar(cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''));
      valor = compartidos[idx] ?? '';
    } else if (tipo === 'inlineStr') {
      valor = textoDeT(cuerpo);
    } else {
      const crudo = desescapar(cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '').trim();
      if (tipo === 'b') {
        valor = crudo === '1' ? 'si' : crudo === '0' ? 'no' : crudo;
      } else if (crudo !== '' && Number.isFinite(estilo) && estilosFecha.has(estilo)) {
        valor = fechaDesdeSerie(Number(crudo));
      } else {
        // Los errores de fórmula (t="e": #¡DIV/0!, #N/A) se dejan tal cual:
        // la validación de la fila los rechaza nombrando la columna, que es
        // más útil que una celda misteriosamente vacía.
        valor = crudo;
      }
    }
    celdas.push(valor);
  }
  return celdas;
}

/** Nombre de la primera hoja y su ruta dentro del ZIP. */
function primeraHoja(workbook: string, rels: string): { nombre: string; ruta: string } | null {
  const hoja = workbook.match(/<sheet\b[^>]*?\/?>/)?.[0];
  if (!hoja) return null;
  const nombre = desescapar(hoja.match(/\bname="([^"]*)"/)?.[1] ?? 'Hoja 1');
  const rid = hoja.match(/r:id="([^"]+)"/)?.[1];
  if (!rid) return null;

  const rel = rels.match(new RegExp('<Relationship[^>]*Id="' + rid + '"[^>]*>'))?.[0];
  let destino = desescapar(rel?.match(/Target="([^"]+)"/)?.[1] ?? '');
  if (!destino) return null;
  if (destino.startsWith('/')) destino = destino.slice(1);
  else if (!destino.startsWith('xl/')) destino = 'xl/' + destino;
  return { nombre, ruta: destino };
}

export interface PlanillaLeida {
  /** Filas y columnas como texto, listas para `parsearProductos`. */
  filas: string[][];
  /** Nombre de la hoja que se leyó. */
  hoja: string;
  /** Cuántas hojas tiene el libro: si son varias, hay que decírselo al usuario. */
  totalHojas: number;
}

/**
 * Lee la primera hoja de un .xlsx y la devuelve como matriz de texto.
 *
 * Todo sale como texto a propósito: el validador de productos ya sabe leer
 * "1.500", "1,5" y "$ 990", y es el mismo que revisa el CSV. Dos caminos de
 * conversión distintos son dos juegos de reglas que con el tiempo dejan de
 * coincidir, y el que se usa menos es el que se rompe sin que nadie lo note.
 */
export async function leerXlsx(datos: Uint8Array): Promise<PlanillaLeida> {
  // "PK" es la firma de todo ZIP, y un .xlsx es un ZIP. "D0 CF" es el formato
  // binario del Excel de 1997, que todavía anda dando vueltas.
  if (datos.length < 4 || datos[0] !== 0x50 || datos[1] !== 0x4b) {
    throw new ErrorPlanilla(
      datos.length > 8 && datos[0] === 0xd0 && datos[1] === 0xcf
        ? 'Ese archivo es un Excel antiguo (.xls). Ábrelo en Excel y usa «Guardar como» → «Libro de Excel (.xlsx)»'
        : 'El archivo no es una planilla de Excel',
    );
  }

  const entradas = leerDirectorio(datos);
  if ([...entradas.keys()].some((n) => n.startsWith('EncryptedPackage'))) {
    throw new ErrorPlanilla(
      'La planilla está protegida con contraseña. Quítasela y vuelve a subirla',
    );
  }

  const workbook = entradas.get('xl/workbook.xml');
  const rels = entradas.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) {
    throw new ErrorPlanilla('El archivo no es una planilla de Excel válida');
  }

  const xmlWorkbook = await leerEntrada(datos, workbook);
  const hoja = primeraHoja(xmlWorkbook, await leerEntrada(datos, rels));
  const entradaHoja = hoja ? entradas.get(hoja.ruta) : undefined;
  if (!hoja || !entradaHoja) {
    throw new ErrorPlanilla('La planilla no tiene ninguna hoja con datos');
  }

  const compartidas = entradas.get('xl/sharedStrings.xml');
  const estilos = entradas.get('xl/styles.xml');
  const [xmlHoja, textos, estilosFecha] = await Promise.all([
    leerEntrada(datos, entradaHoja),
    compartidas ? leerEntrada(datos, compartidas).then(leerTextosCompartidos) : Promise.resolve([]),
    estilos ? leerEntrada(datos, estilos).then(estilosDeFecha) : Promise.resolve(new Set<number>()),
  ]);

  const filas: string[][] = [];
  const re = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let m: RegExpExecArray | null;
  let esperada = 1;
  while ((m = re.exec(xmlHoja)) !== null) {
    // Igual que con las columnas: una fila en blanco no se escribe. Se reponen
    // para que el número de fila del error sea el que el usuario ve en Excel.
    const n = Number(m[1]?.match(/\br="(\d+)"/)?.[1] ?? esperada);
    while (esperada < n) { filas.push([]); esperada++; }
    filas.push(celdasDeFila(m[2] ?? '', textos, estilosFecha));
    esperada = n + 1;
  }

  // Excel deja rastro de filas que se usaron y se borraron: una planilla "de
  // 900 filas" suele tener 300 con datos y el resto vacías. Sin esto, la
  // pantalla diría "600 filas con error: falta el nombre".
  while (filas.length > 0 && filas[filas.length - 1].every((c) => c.trim() === '')) filas.pop();

  return {
    filas,
    hoja: hoja.nombre,
    totalHojas: (xmlWorkbook.match(/<sheet\b[^>]*?\/?>/g) ?? []).length,
  };
}
