/**
 * Escritura de CSV para exportar reportes (RF-M7-09).
 *
 * Tres decisiones que no son de estilo:
 *
 * 1. **Punto y coma, no coma.** Excel en español interpreta la coma como
 *    separador decimal y abre un archivo separado por comas en una sola
 *    columna. El almacenero ve su reporte convertido en una tira de texto y
 *    concluye que el sistema exporta mal.
 *
 * 2. **BOM al principio.** Sin él, Excel abre el archivo en la codificación
 *    del sistema y "Categoría" sale como "CategorÃ­a". El archivo está bien;
 *    lo que está mal es cómo lo abre Excel, y eso no se le puede explicar a
 *    nadie cada vez.
 *
 * 3. **Los números van con coma decimal.** Es la convención chilena, y es la
 *    que Excel espera con la configuración regional de acá. Exportar "1234.5"
 *    hace que Excel lo lea como texto y que no se pueda sumar la columna, que
 *    es lo primero que alguien intenta hacer con un reporte exportado.
 */

/** Una celda: texto, número o nada. */
export type CeldaCSV = string | number | null | undefined;

export interface ColumnaCSV<T> {
  /** Encabezado, tal como lo verá el usuario en Excel. */
  titulo: string;
  valor: (fila: T) => CeldaCSV;
}

const SEPARADOR = ';';
const BOM = '﻿';

/**
 * Escapa una celda.
 *
 * Se entrecomilla en cuanto aparece el separador, una comilla o un salto de
 * línea. El motivo de mayor peso es el salto: un motivo de merma escrito en
 * dos líneas partía la fila en dos y corría todo el resto del archivo.
 */
export function celdaCSV(valor: CeldaCSV): string {
  if (valor === null || valor === undefined) return '';

  const texto = typeof valor === 'number'
    // Los enteros se dejan tal cual: un monto en pesos no lleva decimales, y
    // "2290,0" se ve como un error de quien exportó.
    ? (Number.isInteger(valor) ? String(valor) : String(valor).replace('.', ','))
    : valor;

  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Arma el contenido completo de un archivo CSV, listo para descargar. */
export function aCSV<T>(filas: readonly T[], columnas: ReadonlyArray<ColumnaCSV<T>>): string {
  const lineas = [columnas.map((c) => celdaCSV(c.titulo)).join(SEPARADOR)];
  for (const fila of filas) {
    lineas.push(columnas.map((c) => celdaCSV(c.valor(fila))).join(SEPARADOR));
  }
  // \r\n y no \n: es lo que espera Excel, y lo que evita que en Windows el
  // archivo se vea como una sola línea al abrirlo con el Bloc de notas.
  return BOM + lineas.join('\r\n') + '\r\n';
}

/**
 * Nombre de archivo seguro para un reporte.
 *
 * Sin acentos ni espacios: un archivo llamado "Ventas por período.csv" viaja
 * mal por correo y por WhatsApp, que es exactamente por donde el dueño se lo
 * va a mandar a su contador.
 */
export function nombreArchivoReporte(titulo: string, desde?: string, hasta?: string): string {
  const base = titulo
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const rango = desde && hasta ? `-${desde}-a-${hasta}` : desde ? `-${desde}` : '';
  return `${base}${rango}.csv`;
}
