// ============================================================================
// DESCARGAR EL PDF DE UN DOCUMENTO EMITIDO EN EL SII
// ----------------------------------------------------------------------------
// Hasta ahora el PDF se bajaba SOLO como efecto secundario de mandar el correo,
// y únicamente en las facturas. Eso dejaba tres agujeros:
//
//   · Si el correo fallaba, no quedaba PDF en ninguna parte. Pasó con la
//     factura 1367 el 06-08-2026: emitida a las 20:51, correo caído por
//     timeout del SII, y el archivo no existió hasta que se reenvió a mano.
//   · Las EXENTAS y las NOTAS DE CRÉDITO/DÉBITO no bajaban nada: no mandan
//     correo, así que nunca pasaban por ese camino.
//   · La columna documentos_emitidos.url_pdf quedaba NULL — en las 1.177
//     filas. Nadie sabía dónde estaba cada archivo.
//
// Esta función hace UNA cosa: dado el folio y una sesión del SII ya abierta,
// baja el PDF y devuelve dónde quedó. No manda correos ni escribe en la base;
// de eso se encarga quien la llama.
//
// Va aparte y no dentro del módulo de correos porque bajar el documento y
// enviarlo son dos cosas distintas, y mezclarlas fue justamente el problema.
// ============================================================================
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Copia de trabajo (la que se adjunta al correo) y copia para la persona.
const CARPETA_TEMPORAL = path.join(__dirname, 'revisar para envios', 'pdf_descargados');
const CARPETA_PC = path.join(
    os.homedir(),
    fs.existsSync(path.join(os.homedir(), 'Downloads')) ? 'Downloads' : 'Descargas',
    'facturacion masiva'
);

const asegurarCarpeta = (ruta) => { if (!fs.existsSync(ruta)) fs.mkdirSync(ruta, { recursive: true }); };

// Cómo se llama el archivo según lo que sea. Un "Factura_1367.pdf" para una
// nota de crédito confunde a quien después busca el documento en la carpeta.
const PREFIJO = {
    33: 'Factura',
    34: 'Factura_Exenta',
    56: 'Nota_Debito',
    61: 'Nota_Credito',
};

/**
 * Busca el folio en el portal de emitidos y baja su PDF.
 *
 * @param page      página de Puppeteer con la sesión del SII YA iniciada
 * @param folio     número del documento
 * @param tipoDte   33 factura · 34 exenta · 56 nota débito · 61 nota crédito
 * @returns {rutaPC, rutaTemporal, nombre} o null si no se pudo
 */
export async function descargarDocumentoSii(page, folio, tipoDte = 33) {
    const folioStr = String(folio).trim();
    const etiqueta = PREFIJO[Number(tipoDte)] || 'Documento';

    try {
        // Se va DIRECTO al listado ya filtrado por folio y tipo.
        //
        // El recorrido anterior era: elegir empresa → cargar las últimas 100 →
        // recién ahí filtrar. Tres navegaciones para llegar al mismo lugar, y
        // la lista sin filtrar trae 100 filas de HTML que no se usan.
        //
        // Además leer las filas visibles solo funcionaba para algo recién
        // emitido: el SII muestra "1-100 de 1179", así que el folio 119 —una
        // nota de crédito de junio— estaba doce páginas atrás y la descarga
        // moría con "todavía no aparece en el portal".
        //
        // TPO_DOC importa tanto como el folio: cada tipo lleva su propia serie,
        // así que existe una factura 119 Y una nota de crédito 119, distintas.
        const urlFiltrada =
            'https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsEmi.cgi'
            + `?RUT_RECP=&FOLIO=${encodeURIComponent(folioStr)}&RZN_SOC=`
            + `&FEC_DESDE=&FEC_HASTA=&TPO_DOC=${encodeURIComponent(tipoDte)}`
            + '&ESTADO=&ORDEN=&NUM_PAG=1';

        // PRIMERO hay que pasar por la selección de empresa. No es un paso de
        // adorno: es el que le dice al SII con qué contribuyente se trabaja.
        //
        // Saltárselo e ir directo al listado filtrado parece más rápido y no
        // funciona: el SII rebota a factura_sii.htm, la página genérica que
        // muestra cuando no hay contexto. Se probó y falló.
        await page.goto(
            'https://www1.sii.cl/cgi-bin/Portal001/mipeSelEmpresa.cgi?DESDE_DONDE_URL=OPCION%3D2%26TIPO%3D4',
            { waitUntil: 'domcontentloaded', timeout: 30000 }
        );

        const eligio = await page.evaluate(() => {
            const select = document.querySelector('select');
            if (!select) return false;
            const opt = Array.from(select.options).find(o => o.text.includes('78306207'));
            if (!opt) return false;
            select.value = opt.value;
            const btn = document.querySelector('input[type="submit"], button[type="submit"], input[name="btnContinuar"]');
            if (!btn) return false;
            btn.click();
            return true;
        }).catch(() => false);
        // Solo se espera navegación si de verdad se hizo clic: si no, son 30s muertos.
        if (eligio) await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        // Busca el folio en la tabla y devuelve el código con que el SII
        // identifica el documento para descargarlo.
        //
        // Se comprueba el FOLIO **y** el TIPO. Cada tipo lleva su propia serie,
        // así que el folio 3 existe como factura, como exenta y como nota de
        // crédito a la vez. Quedarse con la primera fila que calce el número
        // baja el documento equivocado: pasó con la exenta 3, donde el SII
        // devolvió algo que ni siquiera era un PDF.
        const buscarEnTabla = async () => {
            const listo = await page.waitForSelector('table tbody tr', { timeout: 20000 })
                .then(() => true).catch(() => false);
            if (!listo) return { cargo: false, codigo: null, visto: [] };

            const r = await page.evaluate((buscado, tipo) => {
                // Cómo se llama cada tipo en la columna "Documento" del SII.
                const calzaTipo = (texto) => {
                    const t = texto.toLowerCase();
                    const exenta = t.includes('exenta') || t.includes('no afecta');
                    if (tipo === 34) return exenta;
                    if (tipo === 61) return t.includes('cr') && t.includes('dito');   // crédito / credito
                    if (tipo === 56) return t.includes('b') && t.includes('dito');    // débito / debito
                    if (tipo === 33) return t.includes('factura') && !exenta;
                    return true;
                };

                const vistos = [];
                for (const fila of Array.from(document.querySelectorAll('table tbody tr'))) {
                    const celdas = fila.querySelectorAll('td');
                    // Ver · Receptor · Razón Social · Documento · Folio · Fecha · Monto · Estado
                    const folioFila = celdas?.[4]?.innerText.trim();
                    const tipoFila = celdas?.[3]?.innerText.trim() || '';
                    if (folioFila !== buscado) continue;

                    vistos.push(tipoFila);
                    if (!calzaTipo(tipoFila)) continue;

                    const href = celdas?.[0]?.querySelector('a')?.href;
                    if (!href) continue;
                    return {
                        codigo: new URLSearchParams(href.split('?')[1] || '').get('CODIGO'),
                        href,
                        vistos,
                    };
                }
                return { codigo: null, href: null, vistos };
            }, folioStr, Number(tipoDte)).catch(() => ({ codigo: null, vistos: [] }));

            return { cargo: true, codigo: r.codigo, href: r.href, visto: r.vistos };
        };

        // Primer intento: filtrado por folio Y tipo.
        await page.goto(urlFiltrada, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        let { cargo, codigo, href, visto } = await buscarEnTabla();

        // Segundo intento: SOLO por folio.
        //
        // El código que el SII usa en TPO_DOC no siempre es el número del DTE, y
        // si no coincide devuelve una tabla vacía sin avisar. Filtrando solo por
        // folio el documento aparece igual; el tipo sirvió para acotar, no es
        // imprescindible. Pasó con la factura 1367: con TPO_DOC=33 no salía.
        if (cargo && !codigo) {
            const soloFolio =
                'https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsEmi.cgi'
                + `?RUT_RECP=&FOLIO=${encodeURIComponent(folioStr)}&RZN_SOC=`
                + '&FEC_DESDE=&FEC_HASTA=&TPO_DOC=&ESTADO=&ORDEN=&NUM_PAG=1';
            await page.goto(soloFolio, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            ({ cargo, codigo, href, visto } = await buscarEnTabla());
        }

        if (!cargo) {
            console.log(`   ⚠️ [PDF] La tabla no cargó para el folio ${folioStr}. Estoy en ${page.url()}`);
            return null;
        }

        if (!codigo) {
            if (visto?.length) {
                // Está en la tabla, pero es de otro tipo: el número solo no basta.
                console.log(`   ⚠️ [PDF] El folio ${folioStr} existe, pero como: ${visto.join(' / ')}.`);
                console.log(`      Se pidió ${etiqueta.replace('_', ' ')}. Revisa el tipo de documento.`);
            } else {
                // Recién emitido, el SII a veces tarda en listarlo.
                console.log(`   ⚠️ [PDF] El folio ${folioStr} no aparece en el portal. Se puede reintentar.`);
            }
            return null;
        }

        // Se descarga con las cookies de la sesión: sin ellas el SII devuelve
        // la página de login en vez del documento.
        const cookies = await page.cookies();
        // El PDF se pide con el código que trae el enlace de la fila.
        //
        // Funciona para facturas (DTE 33) y notas de crédito/débito (61/56).
        // NO funciona para la exenta (34): el SII responde "Error al
        // contribuyente". Se probó seguir el enlace de la fila y entrar a la
        // ficha del documento, y ambas cosas rompieron lo que ya andaba, así
        // que quedó pendiente y anotado en vez de seguir tanteando.
        const urlPdf = `https://www1.sii.cl/cgi-bin/Portal001/mipeDisplayPDF.cgi?DHDR_CODIGO=${codigo}`;
        const respuesta = await fetch(urlPdf, {
            headers: {
                Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
                // Algunos CGI del SII rechazan la petición sin referer.
                Referer: page.url(),
            },
        });
        const contenido = Buffer.from(await respuesta.arrayBuffer());

        // Un PDF de verdad empieza con "%PDF". Si el SII devolvió un HTML de
        // error, guardarlo dejaría un archivo roto con nombre de factura.
        if (contenido.length < 1000 || !contenido.subarray(0, 4).toString().startsWith('%PDF')) {
            console.log(`   ⚠️ [PDF] Lo que devolvió el SII para el folio ${folioStr} no es un PDF. No se guarda.`);
            console.log(`      url usada: ${urlPdf}`);
            console.log(`      content-type: ${respuesta.headers.get('content-type')}`);
            console.log(`      tamaño: ${contenido.length} bytes`);
            console.log(`      empieza con: ${contenido.subarray(0, 220).toString().replace(/\s+/g, ' ')}`);
            return null;
        }

        asegurarCarpeta(CARPETA_TEMPORAL);
        asegurarCarpeta(CARPETA_PC);

        const nombre = `${etiqueta}_${folioStr}.pdf`;
        const rutaTemporal = path.join(CARPETA_TEMPORAL, `${folioStr}.pdf`);
        const rutaPC = path.join(CARPETA_PC, nombre);
        fs.writeFileSync(rutaTemporal, contenido);
        fs.writeFileSync(rutaPC, contenido);

        console.log(`   📄 [PDF] ${nombre} guardado en ${CARPETA_PC}`);
        return { rutaPC, rutaTemporal, nombre };

    } catch (err) {
        // Que no se pueda bajar el PDF NO invalida el documento: ya está emitido
        // ante el SII. Se avisa y se sigue.
        console.log(`   ⚠️ [PDF] No se pudo descargar el folio ${folioStr}: ${err.message}`);
        return null;
    }
}

export const carpetaDeDescargas = () => CARPETA_PC;
