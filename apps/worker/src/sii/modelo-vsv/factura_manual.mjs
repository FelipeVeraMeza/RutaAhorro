import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import pkg from 'pg'; 
import crypto from 'crypto'; 
import { encrypt } from '../../../utils/crypto.js'; // ⚠️ Ajusta tu ruta si es necesario
import { credencialesDelSistema } from '../../../utils/credencialesFacturacion.js';
// La misma que usa el facturador masivo para mandar cada factura emitida.
import { enviarCorreoFacturaEnSesion } from './revisar para envios/mensajes_facturador_masivo.mjs';
// Bajar el PDF es su propia responsabilidad, no un efecto del correo.
import { descargarDocumentoSii } from './descargarDocumentoSii.mjs';
import { cerrarNavegador, cerrarCliente } from './cerrarNavegador.mjs';
// Elegir con qué empresa se emite. Vive aparte porque los cuatro robots lo
// necesitan y copiado se corrige en uno y se olvida en los otros tres.
import { seleccionarEmpresaEmisora } from './empresaEmisora.mjs';
import { asegurarCobroDeFactura } from '../../../utils/cobroDeFactura.js';

const { Client } = pkg;
dotenv.config();

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Espera a que el SII deje de navegar (drena las recargas del formulario).
// Evita "Execution context was destroyed" al tocar el DOM mientras el SII recarga
// (por ejemplo, tras escribir el RUT del receptor).
const esperarEstable = async (page) => {
    for (let i = 0; i < 6; i++) {
        try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 });
            await delay(400);
        } catch (e) {
            break; // Sin más navegaciones => página estable.
        }
    }
    await delay(500);
};

const limpiarYTipar = async (page, selector, texto) => {
    if (!texto) return; 
    try {
        await page.waitForSelector(selector, { visible: true, timeout: 5000 });
        await page.click(selector, { clickCount: 3 }); 
        await page.keyboard.press('Backspace');        
        await page.type(selector, texto, { delay: 50 }); 
    } catch (e) {
        console.log(`⚠️ No se pudo escribir en: ${selector}`);
    }
};

// =========================================================================
// 🚀 MEGA FUNCIÓN DE FACTURACIÓN: EXTRACCIÓN + EMISIÓN + GUARDADO
// =========================================================================

// ============================================================================
// AVANCE EN VIVO DE LA FACTURA INDIVIDUAL
// ----------------------------------------------------------------------------
// Emitir una factura tarda entre 30 y 90 segundos: el robot abre el navegador,
// entra al SII, llena el formulario, firma y espera el folio. Sin esto la
// pantalla mostraba un girito y un cartel rojo que decia "SISTEMA BLOQUEADO",
// que no dice en que va ni si sigue viva. Ahora nombra el paso actual.
// ============================================================================
export const estadoFacturaManual = {
    activo: false, paso: '', numero: 0, total: 12,
    avisoCorreo: null, avisoCobro: null, rutaPdf: null, nombrePdf: null,
    folio: null, error: null, iniciado: null,
};

const paso = (n, texto) => {
    estadoFacturaManual.numero = n;
    estadoFacturaManual.paso = texto;
    console.log(`   [${n}/12] ${texto}`);
};

export async function emitirFacturaPuppeteer(datos, credSii = credencialesDelSistema()) {
    
    let razonSocialCapturadaDelSII = null;
    let browser, page, client;

    // 1. INICIAMOS LA CONEXIÓN A LA BASE DE DATOS
    client = new Client({
        user: process.env.DBS_USER,
        host: process.env.DBS_HOST,
        database: process.env.DBS_DATABASE,
        password: process.env.DBS_PASSWORD,
        port: process.env.DBS_PORT,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log("🔌 Búnker PostgreSQL conectado para facturación.");
        Object.assign(estadoFacturaManual, { activo: true, numero: 0, paso: 'Preparando…', folio: null, error: null, avisoCorreo: null, avisoCobro: null, rutaPdf: null, nombrePdf: null, iniciado: Date.now() });
        paso(1, 'Iniciando el robot');
        console.log('>>> Iniciando Robot de Facturación Inteligente...');

        // =======================================================================
        // 2. LANZAR NAVEGADOR Y LOGIN CON RESILIENCIA (AUTO-REINTENTO)
        // =======================================================================
        let navegacionExitosa = false;
        let intentosNavegacion = 0;

        while (!navegacionExitosa && intentosNavegacion < 3) {
            intentosNavegacion++;
            try {
                paso(2, `Abriendo el navegador (intento ${intentosNavegacion} de 3)`);
                console.log(`\n🌐 Levantando navegador (Intento ${intentosNavegacion}/3)...`);
                
                browser = await puppeteer.launch({
                    headless: true, // 👁️ Ponlo en 'false' si quieres ver el proceso en tu pantalla
                    defaultViewport: null,
                    protocolTimeout: 120000, // ⏱️ Evita que un clic/comando lento tumbe todo
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--start-maximized',
                        '--disable-blink-features=AutomationControlled'
                    ]
                });

                page = await browser.newPage();
                // 🔔 Aceptamos automáticamente las alertas/confirmaciones del SII para que NO
                // bloqueen los clics (esos diálogos colgaban el "Input.dispatchMouseEvent").
                page.on('dialog', async d => { try { await d.accept(); } catch (e) {} });
                // Aumentamos un poco el timeout general para darle respiro
                page.setDefaultNavigationTimeout(60000);

                // Intentamos llegar a la página
                await page.goto('https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=33&TIPO=4', { 
                    waitUntil: 'networkidle2', 
                    timeout: 45000 
                });

                // Si pasamos el goto sin que lance error (timeout), marcamos éxito y rompemos el bucle
                navegacionExitosa = true;
                
            } catch (error) {
                console.log(`⚠️ Falló el intento ${intentosNavegacion} por lentitud del SII: ${error.message}`);
                // Si falla, CERRAMOS el navegador actual para no dejar ventanas fantasma
                if (browser) {
                    await browser.close().catch(() => {});
                }
                if (intentosNavegacion < 3) {
                    console.log("⏳ Esperando 5 segundos antes de reintentar con una ventana limpia...");
                    await delay(5000);
                }
            }
        }

        // Si después de los 3 intentos no logró cargar, abortamos la misión
        if (!navegacionExitosa) {
            throw new Error('❌ El portal del SII está demasiado lento o caído. Se abortó la operación tras 3 intentos.');
        }

        // =======================================================================
        // 3. LOGIN EN EL SII (Ya estamos en la página correcta)
        // =======================================================================
        const inputRutExiste = await page.$('#rutcntr');
        if (inputRutExiste) {
            paso(3, 'Entrando al SII');
        console.log(`🔑 Entrando al SII con RUT: ${credSii.DTE_RUT}`);
            await page.type('#rutcntr', `${credSii.DTE_RUT}-${credSii.DTE_DV}`, { delay: 50 });
            await page.type('#clave', credSii.DTE_PASS, { delay: 50 });
            await Promise.all([page.waitForNavigation(), page.click('#bt_ingresar')]);
            await delay(1500); 

            // La empresa emisora se elige por SU RUT, no por su posición en la
            // lista (ver empresaEmisora.mjs). Sin argumento usa el configurado:
            // 78306207-0, VOLLAIRE Y OLIVOS. NO se le pasa credSii.DTE_RUT —ese
            // es el RUT de la PERSONA que inicia sesión, y no figura entre las
            // empresas del desplegable.
            await seleccionarEmpresaEmisora(page);
        }

        // =======================================================================
        // 4. INGRESAR RUT DEL CLIENTE Y LANZAR AJAX (Tus tiempos exactos)
        // =======================================================================
        paso(4, 'Escribiendo el RUT del cliente');
        console.log(`📝 Escribiendo RUT del cliente: ${datos.rutReceptor}-${datos.dvReceptor}`);
        
        // Ya no necesitamos llamar a tu antigua función 'navegarAEmision' porque ya estamos en la página
        // y pasamos la selección de empresa. Solo esperamos a que el input de receptor aparezca.
        
        // Si el formulario no aparece, se dice DÓNDE quedó el robot. El error
        // pelado de Puppeteer —«Waiting for selector EFXP_RUT_RECEP failed»— no
        // permite distinguir un SII lento de una pantalla intermedia inesperada,
        // y fue lo único que quedó del fallo del 31-08.
        try {
            await page.waitForSelector('input[name="EFXP_RUT_RECEP"], #EFXP_RUT_RECEP', { visible: true, timeout: 45000 });
        } catch (err) {
            const donde = await page.evaluate(() => ({
                url: location.href,
                titulo: document.title,
                // Un texto corto de la página basta para reconocer si el SII
                // mostró un aviso, una sesión caída o una pantalla distinta.
                texto: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
            })).catch(() => ({ url: '?', titulo: '?', texto: '?' }));
            throw new Error(
                `No apareció el formulario para escribir el RUT del cliente. ` +
                `El robot quedó en: ${donde.url} («${donde.titulo}»). ` +
                `La página decía: "${donde.texto}". ` +
                `Suele ser el SII lento, o que quedó en una pantalla intermedia distinta a la de emisión.`
            );
        }
        await delay(1000);

        const rutInputSelector = await page.$('#EFXP_RUT_RECEP') ? '#EFXP_RUT_RECEP' : 'input[name="EFXP_RUT_RECEP"]';
        const dvInputSelector = await page.$('#EFXP_DV_RECEP') ? '#EFXP_DV_RECEP' : 'input[name="EFXP_DV_RECEP"]';

        await page.click(rutInputSelector);
        await page.type(rutInputSelector, datos.rutReceptor, { delay: 100 }); 
        await page.keyboard.press('Tab');
        await delay(300);
        await page.type(dvInputSelector, datos.dvReceptor, { delay: 100 });

        console.log('⚡ Simulando movimiento humano para activar el AJAX del SII...');
        await page.keyboard.press('Tab');
        await page.mouse.click(10, 10);

        // 🕒 CLAVE: al validar el RUT del receptor, el SII RECARGA el formulario.
        // Esperamos a que esa recarga termine ANTES de tocar el DOM (evita "context destroyed").
        paso(5, 'Esperando que el SII valide el RUT');
        console.log('⏳ Esperando que el SII termine de validar el RUT (posible recarga)...');
        await delay(1200);
        await esperarEstable(page);
        await delay(1200);

        // =======================================================================
        // 5. LLENAR DATOS SECUNDARIOS MIENTRAS SII PIENSA
        // =======================================================================
        console.log('⏩ Llenando datos secundarios...');

        await limpiarYTipar(page, 'input[name="EFXP_CIUDAD_ORIGEN"]', datos.ciudadEmisor || 'Santiago');
        await limpiarYTipar(page, 'input[name="EFXP_FONO_EMISOR"]', datos.telefonoEmisor || '56978278733');
        await limpiarYTipar(page, 'input[name="EFXP_CIUDAD_RECEP"]', datos.ciudadReceptor || 'Santiago');
        if (datos.contactoReceptor) await limpiarYTipar(page, 'input[name="EFXP_CONTACTO"]', datos.contactoReceptor);
        
        if (datos.rutSolicita && datos.dvSolicita) {
            await limpiarYTipar(page, 'input[name="EFXP_RUT_SOLICITA"]', datos.rutSolicita);
            await limpiarYTipar(page, 'input[name="EFXP_DV_SOLICITA"]', datos.dvSolicita);
        }

        // =======================================================================
        // 6. EXTRACCIÓN DE LA RAZÓN SOCIAL DEL RECEPTOR
        // =======================================================================
        console.log('⏳ Extrayendo la Razón Social del RECEPTOR...');
        
        let nombreEncontrado = null;
        for (let i = 0; i < 8; i++) {
          try {
            nombreEncontrado = await page.evaluate(() => {
                const inputExacto = document.querySelector('#EFXP_NMB_RECEP') || document.querySelector('input[name="EFXP_NMB_RECEP"]');
                if (inputExacto && inputExacto.value && inputExacto.value.trim().length > 2) return inputExacto.value.trim();

                const inputs = Array.from(document.querySelectorAll('input'));
                for(let inp of inputs) {
                    const attr = (inp.name + ' ' + inp.id).toUpperCase();
                    if(attr.includes('RECEP') && (attr.includes('NMB') || attr.includes('SOC') || attr.includes('RZN'))) {
                        if(inp.value && inp.value.length > 2) return inp.value.trim();
                    }
                }

                const tds = Array.from(document.querySelectorAll('td, th, span, div, label'));
                let enSeccionReceptor = false;
                for (let j = 0; j < tds.length; j++) {
                    const txt = tds[j].innerText ? tds[j].innerText.toUpperCase().trim() : '';
                    if (txt.includes('DATOS RECEPTOR') || txt.includes('DATOS DEL RECEPTOR')) enSeccionReceptor = true;
                    if (enSeccionReceptor && (txt === 'RAZÓN SOCIAL' || txt === 'RAZON SOCIAL')) {
                        let nextEl = tds[j].nextElementSibling || (tds[j+1] ? tds[j+1] : null);
                        let textVal1 = nextEl ? nextEl.innerText.trim() : '';
                        if (textVal1.length > 2 && !textVal1.includes('Tipo de Compra')) return textVal1;
                        
                        let nextNextEl = tds[j+2];
                        let textVal2 = nextNextEl ? nextNextEl.innerText.trim() : '';
                        if (textVal2.length > 2 && !textVal2.includes('Tipo de Compra')) return textVal2;
                    }
                }
                return null;
            });
          } catch (eEval) {
            // Si el SII recargó (contexto destruido), esperamos a que se estabilice y reintentamos.
            await esperarEstable(page);
            await delay(500);
            continue;
          }

            if (nombreEncontrado) {
                razonSocialCapturadaDelSII = nombreEncontrado;
                console.log(`✅ ¡Nombre capturado para la Base de Datos!: "${razonSocialCapturadaDelSII}"`);
                break;
            }
            await delay(500);
        }

        if (!nombreEncontrado) {
            console.log('⚠️ Falló la extracción del receptor. Usaremos el nombre por defecto.');
            razonSocialCapturadaDelSII = datos.razonSocial || 'CLIENTE NUEVO SII';
        }

        // =======================================================================
        // 7. PRODUCTOS, FIRMA Y FOLIO
        // =======================================================================
        paso(6, 'Ingresando el detalle del servicio');
        console.log('🛍️ Ingresando detalles del producto/servicio...');
        await page.type('input[name="EFXP_NMB_01"]', datos.producto.nombre || 'Servicio', { delay: 50 });
        await page.type('input[name="EFXP_QTY_01"]', String(datos.producto.cantidad || 1), { delay: 50 });
        await page.type('input[name="EFXP_UNMD_01"]', String(datos.producto.unidad || 1), { delay: 50 });
        await limpiarYTipar(page, 'input[name="EFXP_PRC_01"]', String(datos.producto.precio || 0));
        
        const checkbox = await page.waitForSelector('input[name="DESCRIP_01"]', { visible: true });
        await checkbox.click(); 
        try {
            await page.waitForSelector('textarea[name="EFXP_DSC_ITEM_01"]', { visible: true, timeout: 5000 });
        } catch (e) {
            await checkbox.click(); 
            await page.waitForSelector('textarea[name="EFXP_DSC_ITEM_01"]', { visible: true, timeout: 5000 });
        }
        await page.type('textarea[name="EFXP_DSC_ITEM_01"]', datos.producto.descripcion || 'Sin descripción', { delay: 50 });
        await page.select('select[name="EFXP_FMA_PAGO"]', '1'); 

        console.log('✅ Validando montos...');
        // Clic vía JS (no por el mouse de CDP) para evitar el "Input.dispatchMouseEvent timed out".
        await page.evaluate(() => {
            const btn = document.querySelector('button[name="Button_Update"]');
            if (btn) btn.click();
        });
        // ESPERAR A QUE EL SII RESPONDA, NO 3,5 SEGUNDOS SIEMPRE.
        // Este era el `delay` más caro del robot: se pagaba entero en cada
        // factura, incluso cuando el portal ya había terminado en medio segundo.
        // Ahora se sale apenas el botón de firma queda habilitado —que es la
        // señal real de que la validación terminó— y solo se agotan los 4 s
        // cuando el SII de verdad está lento. En una emisión normal esto
        // devuelve casi al instante.
        await page.waitForFunction(() => {
            const b = document.querySelector('input[name="btnSign"]');
            return b && !b.disabled;
        }, { timeout: 4000, polling: 200 }).catch(() => {});
        
        try {
            const alertaAceptada = await page.evaluate(() => {
                const botones = Array.from(document.querySelectorAll('input[type="button"], button'));
                const btnAceptar = botones.find(b => b.value.includes('Aceptar') || b.innerText.includes('Aceptar'));
                if (btnAceptar && btnAceptar.offsetParent !== null) { btnAceptar.click(); return true; }
                return false;
            });
            if (alertaAceptada) await delay(2000); 
        } catch (e) {}
        
        paso(7, 'Firmando la factura');
        console.log('✍️  Abriendo cuadro de firma...');
        // POR QUÉ ESTO REINTENTA, Y POR QUÉ AHORA TARDA MENOS.
        //
        // El botón de firma del SII (`btnSign`) recién se habilita cuando el
        // portal terminó de validar los montos. Apretarlo antes no hace nada. Por
        // eso el bucle: apretar, esperar el cuadro de la clave y, si no salió,
        // volver a «Actualizar» y probar otra vez.
        //
        // Antes eran 5 vueltas de 3,5 s + 2 s: 27 segundos de reintentos mudos
        // antes de rendirse, y el error final —«El SII no cargó la caja»— no
        // decía nada. Con eso no se puede distinguir un portal lento de un
        // formulario que el SII rechazó. Los 65 s del intento del 31-08 21:37 son
        // en su mayoría este bucle girando en falso.
        //
        // Ahora son 3 vueltas, y antes de apretar se revisa si el botón siquiera
        // existe y está habilitado: si el SII está mostrando un error de
        // validación, se corta enseguida y se dice cuál, en vez de esperar.
        let intentosFirma = 0, cajaVisible = false;
        while (intentosFirma < 3 && !cajaVisible) {
            try {
                const estadoBoton = await page.evaluate(() => {
                    const btn = document.querySelector('input[name="btnSign"]');
                    if (!btn) return 'no-existe';
                    if (btn.disabled) return 'deshabilitado';
                    btn.click();
                    return 'apretado';
                });
                if (estadoBoton === 'apretado') {
                    await page.waitForSelector('#myPass', { visible: true, timeout: 4000 });
                    cajaVisible = true;
                    break;
                }
                intentosFirma++;
            } catch (e) {
                intentosFirma++;
            }
            if (!cajaVisible) {
                await page.evaluate(() => {
                    const btn = document.querySelector('button[name="Button_Update"]');
                    if (btn) btn.click();
                }).catch(() => {});
                await delay(2000);
            }
        }

        if (!cajaVisible) {
            // Se mira la página antes de rendirse: casi siempre el SII está
            // diciendo en pantalla qué campo no le gustó, y ese es justo el dato
            // que hace falta. Sin esto había que adivinar.
            const diag = await page.evaluate(() => {
                const texto = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
                const avisos = texto.split(/(?<=\.)\s+/)
                    .filter(l => /error|obligatori|inv[áa]lid|debe |falta|incorrect|no puede/i.test(l))
                    .slice(0, 3).join(' | ');
                const btn = document.querySelector('input[name="btnSign"]');
                return {
                    avisos,
                    boton: !btn ? 'no está en la página' : (btn.disabled ? 'está deshabilitado' : 'está habilitado'),
                    extracto: texto.slice(0, 250),
                };
            }).catch(() => null);

            throw new Error(
                'El SII no abrió el cuadro para la clave del certificado. ' +
                (diag
                    ? `El botón de firma ${diag.boton}. ` +
                      (diag.avisos ? `El SII decía: "${diag.avisos}". ` : '') +
                      `La página mostraba: "${diag.extracto}".`
                    : 'Además, no se pudo leer la página para saber por qué.') +
                ' Suele ser un dato del formulario que el SII rechazó, o el portal lento.'
            );
        }

        console.log('🔒 Ingresando clave y enviando factura...');
        await page.focus('#myPass');
        await page.type('#myPass', credSii.SII_PFX_PASS, { delay: 50 });
        await delay(500); 
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
            page.evaluate(() => {
                const btnEnviar = document.querySelector('#btnFirma');
                if (btnEnviar) btnEnviar.click();
            })
        ]);
        
        paso(8, 'Esperando el folio del SII');
        console.log('🔍 Buscando Folio...');
        let folio = null;
        for (let j = 0; j < 30; j++) {
            const text = await page.evaluate(() => document.body.innerText).catch(() => "");
            const match = text.match(/N[°º]\s*(\d+)/i) || text.match(/Folio\s*(\d+)/i);
            if (match) { folio = match[1]; break; }
            await delay(1000); 
        }
        if (!folio) throw new Error("No se detectó el folio en la pantalla final.");
        estadoFacturaManual.folio = folio;
        console.log(`🎉 ¡ÉXITO ABSOLUTO! Folio SII N°: ${folio}`);

        // ==============================================================
        // 💾 LÓGICA DE BASE DE DATOS (AUTO-CREACIÓN E HISTORIAL)
        // ==============================================================
        // =======================================================================
        // BAJAR EL PDF  ·  antes solo pasaba si el correo salía bien
        // -----------------------------------------------------------------------
        // Se hace ACÁ, apenas hay folio y con la sesión del SII todavía abierta,
        // y NO dentro del envío de correo. Antes iban juntos: si el correo
        // fallaba —como el 06-08 con el timeout del SII— la factura quedaba
        // emitida y sin ningún archivo en el computador.
        let rutaPdf = null;
        try {
            paso(9, 'Descargando el PDF de la factura');
            const pdf = await descargarDocumentoSii(page, folio, 33);
            if (pdf) {
                rutaPdf = pdf.rutaPC;
                estadoFacturaManual.rutaPdf = pdf.rutaPC;
                estadoFacturaManual.nombrePdf = pdf.nombre;
            }
        } catch { /* la función ya avisa; la factura sigue válida */ }

        paso(10, 'Guardando el documento');
        console.log('💾 Guardando documento en la Base de Datos...');
        
        let empresaIdFinal = datos.empresa_id;
        const rutOriginal = `${datos.rutReceptor}-${datos.dvReceptor}`;

        if (empresaIdFinal === 'EXTERNO') {
            // «EXTERNO» significa que se facturó a alguien que no se eligió de la
            // lista, NO que sea un cliente nuevo: puede estar en el CRM y quien
            // factura simplemente escribió el RUT a mano.
            //
            // Antes se insertaba directo y, si ya existía, la base rechazaba por
            // `empresa_rut_hash_org_key` y el catch dejaba `empresaIdFinal = null`.
            // Eso arrastraba dos consecuencias: la factura no se guardaba en el
            // historial y el cobro tampoco se registraba, aunque el documento ya
            // estuviera emitido ante el SII. Pasó con la factura 1476 el 31-08-2026,
            // facturada a ASESORIA FINANCIERA E INMOBILIARIA SUHOUSE SPA, que ya
            // existía en el CRM.
            //
            // Ahora se busca primero: si está, se usa; si no, se crea.
            const rutHash = crypto.createHash('sha256').update(rutOriginal).digest('hex');
            try {
                const yaExiste = await client.query(
                    `SELECT id, razon_social FROM empresa
                      WHERE rut_hash = $1 AND organizacion_id IS NOT DISTINCT FROM $2::uuid`,
                    [rutHash, datos.organizacion_id || null]);

                if (yaExiste.rows.length > 0) {
                    empresaIdFinal = yaExiste.rows[0].id;
                    console.log(`✅ El cliente ya estaba en el CRM: "${yaExiste.rows[0].razon_social}". Se usa esa ficha.`);
                } else {
                    console.log(`⚠️ Cliente externo detectado. Creando la empresa: "${razonSocialCapturadaDelSII}" en el CRM...`);
                    // organizacion_id es obligatorio de facto: el CRM filtra por él,
                    // así que sin este valor la empresa quedaría creada pero invisible.
                    const resultEmpresa = await client.query(
                        `INSERT INTO empresa (razon_social, rut_encrypted, rut_hash, giro, regimen_tributario, activo, organizacion_id)
                         VALUES ($1, $2, $3, 'Por definir', 'Por definir', true, $4)
                         RETURNING id`,
                        [razonSocialCapturadaDelSII, encrypt(rutOriginal), rutHash, datos.organizacion_id || null]);
                    empresaIdFinal = resultEmpresa.rows[0].id;
                    console.log(`✅ ¡Cliente nuevo creado con éxito! ID: ${empresaIdFinal}`);
                }
            } catch (errCreacion) {
                console.error("❌ Error al resolver la empresa en la BD:", errCreacion.message);
                empresaIdFinal = null;
            }
        }

        // LOS MONTOS SE CALCULAN FUERA DEL `if`, Y ES A PROPÓSITO.
        // Estaban declarados con `const` DENTRO del bloque de abajo, pero el
        // registro del cobro —que viene después y está fuera— usa `montoNeto`.
        // Resultado: «montoNeto is not defined» y la factura quedaba emitida
        // ante el SII sin entrar a la cobranza, así que el cliente no aparecía
        // debiendo. Pasó con la factura 1476 el 31-08-2026.
        const tipoDte = datos.tipo_documento ? parseInt(datos.tipo_documento) : 33;
        const montoNeto = parseInt(datos.producto.precio);
        // IVA y total: la factura afecta (33) lleva 19%; una exenta (34/41) no.
        const montoIva = (tipoDte === 34 || tipoDte === 41) ? 0 : Math.round(montoNeto * 0.19);
        const montoTotal = montoNeto + montoIva;
        // Por la misma razón que los montos: el registro del cobro está fuera de
        // este `if` y necesita la fecha. Declarada adentro daba
        // «fechaEmision is not defined» justo en el camino que registra la plata.
        const fechaEmisionCobro = new Date().toISOString();

        if (empresaIdFinal) {
            const fechaEmision = fechaEmisionCobro;

            try {
                const checkQuery = `SELECT id FROM documentos_emitidos WHERE rut_cliente = $1 AND tipo_dte = $2 AND folio = $3`;
                const checkRes = await client.query(checkQuery, [rutOriginal, tipoDte, folio]);

                if (checkRes.rows.length === 0) {
                    const queryInsert = `
                        INSERT INTO documentos_emitidos
                        (empresa_id, rut_cliente, tipo_dte, folio, monto_neto, monto_iva, monto_total, fecha_emision, url_pdf)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        RETURNING id;
                    `;
                    const valores = [empresaIdFinal, rutOriginal, tipoDte, folio, montoNeto, montoIva, montoTotal, fechaEmision, rutaPdf];
                    const resDB = await client.query(queryInsert, valores);

                    if (resDB.rowCount > 0) {
                        console.log(`✅ ¡Factura ${folio} guardada exitosamente en el historial!`);
                    }
                } else {
                    console.log(`⚠️ La factura ${folio} ya existía en la BD. Omitiendo duplicado.`);
                }
            } catch (dbError) {
                console.error('❌ Error fatal guardando la factura en la BD:', dbError.message);
            }
        }

        // =======================================================================
        // METER LA FACTURA EN LA COBRANZA  ·  una sola puerta
        // -----------------------------------------------------------------------
        // El facturador masivo trabaja sobre cobros que YA existen: los genera el
        // día 26 en estado POR_EMITIR y después `vincularFolios` les pega el folio
        // y los pasa a PENDIENTE_PAGO.
        //
        // El manual no tiene nada de eso. Emitía la factura, la guardaba en
        // documentos_emitidos… y ahí moría: no quedaba ningún cobro asociado, así
        // que el cliente NO aparecía debiendo, no salía en el Cobro del Mes ni en
        // Correo Masivo, y nadie le iba a cobrar nunca.
        //
        // Le pasó a CALDERÓN el 06-08-2026: factura 1367 emitida por $50.000 y
        // cero rastro en la cobranza.
        //
        // ── POR QUÉ ACÁ HABÍA DOS PUERTAS Y AHORA HAY UNA (17-09-2026) ─────────
        //
        // Este archivo registraba el cobro dos veces: `asegurarCobroDeFactura`
        // dentro del bloque del historial, y un INSERT propio acá abajo con
        // `ON CONFLICT (empresa_id, periodo) DO UPDATE`.
        //
        // Ese INSERT llevaba semanas SIN FUNCIONAR NUNCA. La migración
        // 2026-09-04_cobros_multiples_por_mes.sql cambió la restricción
        // (empresa_id, periodo) por dos índices PARCIALES —uno para las filas con
        // folio y otro para las que no—, y un ON CONFLICT sin la misma cláusula
        // WHERE no coincide con un índice parcial. Postgres lo rechaza entero con
        // 42P10 «there is no unique or exclusion constraint matching the ON
        // CONFLICT specification». Comprobado contra la base el 17-09-2026
        // ejerciendo el INSERT tal cual dentro de una transacción revertida.
        //
        // O sea que cada factura manual caía al `catch` y escribía en el registro
        // «la factura se emitió, pero NO quedó en la cobranza» — y era MENTIRA:
        // el cobro sí existía, lo había creado la otra puerta. Un aviso que
        // miente es peor que no tenerlo: manda a registrar a mano algo que ya
        // está, y con el tiempo se aprende a ignorarlo.
        //
        // Se borra el INSERT en vez de repararlo porque lo que hacía —pegarle el
        // folio al cobro del mes que ya existía— quedó contradicho por esa misma
        // migración: desde el 04-09 una empresa PUEDE tener varios cobros en un
        // mes (el del plan más los extras, cada uno con su factura), y pegarle a
        // la cuota mensual el folio de un servicio extra daría por facturado un
        // plan que nadie facturó.
        //
        // La llamada sube acá y sale del bloque del historial a propósito: si la
        // factura ya estaba en `documentos_emitidos` —una reemisión— el bloque de
        // arriba no entra, y con la llamada adentro el cobro no se aseguraba
        // nunca. `asegurarCobroDeFactura` es idempotente y no lanza: si ya hay un
        // cobro con ese folio, no hace nada.
        paso(11, 'Registrando el cobro');
        const cobro = await asegurarCobroDeFactura(client, {
            empresaId: empresaIdFinal, folio, montoNeto, montoTotal,
            tipoDte, fechaEmision: fechaEmisionCobro,
            // Sin esto el cobro nacía con organización NULL y no lo veía NADIE:
            // ni su dueño, que lo tiene fuera de su filtro, ni otra organización.
            // Así quedaron los folios 1483-1486 por $642.600. Va con red abajo
            // —el INSERT la hereda de la empresa si no viene— pero mandarla es lo
            // correcto: acá sí se sabe de qué organización es.
            organizacionId: datos.organizacion_id || null,
        });

        if (cobro.creado) {
            console.log(`✅ Cobro registrado: folio ${folio} por $${Number(montoNeto).toLocaleString('es-CL')}.`);
        } else if (cobro.motivo && cobro.motivo.includes('ya exist')) {
            console.log(`✅ El folio ${folio} ya tenía su cobro. No se duplica.`);
        } else {
            // Ahora el aviso solo sale cuando de verdad no hay cobro. La factura
            // ya está emitida ante el SII: esto no la deshace.
            console.log(`⚠️ La factura ${folio} se emitió, pero NO quedó en la cobranza: ${cobro.motivo}`);
            console.log(`   Hay que registrarla a mano o el cliente no aparecerá debiendo.`);
            estadoFacturaManual.avisoCobro =
                `La factura ${folio} se emitió, pero no se pudo registrar el cobro. `
                + `Revísalo en Cobro del Mes.`;
        }

        // =======================================================================
        // ENVIAR LA FACTURA AL CLIENTE  ·  esto FALTABA
        // -----------------------------------------------------------------------
        // El facturador masivo manda el correo de cada factura que emite; el
        // individual la emitía y ahí quedaba. El cliente nunca recibía nada y
        // había que reenviársela a mano desde Correo Masivo buscando el folio.
        //
        // Se usa la MISMA función del masivo y en la misma sesión del SII, antes
        // de cerrarla: el correo sale desde el portal, con la factura adjunta.
        // Por eso va acá y no después del `finally`, donde la sesión ya no existe.
        //
        // Si el correo falla, la factura NO se deshace: ya está emitida ante el
        // SII y eso no se toca. Se avisa y se sigue; se puede reenviar desde
        // Correo Masivo con el folio.
        let correoEnviado = false;
        try {
            paso(12, 'Enviando la factura al cliente');

            // SE MANDA EL NOMBRE Y EL CORREO DE VERDAD, NO LOS DEL FORMULARIO.
            //
            // Cuando se factura a un RUT que no está en la lista, la pantalla
            // manda `razonSocial: 'CLIENTE EXTERNO (NUEVO)'` —un marcador, no un
            // nombre—. Ese texto quedaba guardado en el registro de correos y
            // salía así en Correo Masivo, donde nadie sabe de qué cliente habla.
            // Pasó con la factura 1476 el 31-08-2026.
            //
            // Para entonces el robot YA sabe quién es: capturó la razón social
            // del propio SII (`razonSocialCapturadaDelSII`) y, si la empresa
            // estaba en el CRM, tiene su ficha. Se usa eso, y el marcador solo
            // queda como último recurso.
            let correoCliente = datos.contactoReceptor || null;
            let nombreCliente = razonSocialCapturadaDelSII || datos.razonSocial || null;
            if (empresaIdFinal) {
                try {
                    const { rows } = await client.query(
                        `SELECT razon_social, email_corporativo FROM empresa WHERE id = $1`,
                        [empresaIdFinal]);
                    if (rows[0]) {
                        nombreCliente = rows[0].razon_social || nombreCliente;
                        // El correo escrito a mano manda: puede ser el de este
                        // envío puntual, distinto al de la ficha.
                        correoCliente = correoCliente || rows[0].email_corporativo || null;
                    }
                } catch { /* si falla, se usa lo que ya se tenía */ }
            }

            await enviarCorreoFacturaEnSesion(page, folio, {
                ...datos,
                razonSocial: nombreCliente,
                contactoReceptor: correoCliente,
            });
            correoEnviado = true;
            console.log(`✅ Factura ${folio} enviada a ${datos.contactoReceptor || 'el cliente'}`);
        } catch (errCorreo) {
            console.log(`⚠️ La factura ${folio} SE EMITIÓ, pero el correo falló: ${errCorreo.message}`);
            console.log(`   Se puede reenviar desde Correo Masivo con el folio ${folio}.`);
            estadoFacturaManual.avisoCorreo =
                `La factura ${folio} se emitió correctamente, pero no se pudo enviar el correo. `
                + `Reenvíala desde Correo Masivo con el folio ${folio}.`;
        }

        return { ok: true, folio, correoEnviado, rutaPdf, fileName: `Factura_${folio}.pdf` };

    } catch (error) {
        console.error(`❌ Error durante el proceso: ${error.message}`);
        // Se guarda el motivo para que la pantalla pueda decir QUÉ falló y en
        // qué paso, en vez de solo apagarse.
        estadoFacturaManual.error = error.message;
        throw error;
    } finally {
        // Pase lo que pase, el proceso deja de estar activo: si no, la pantalla
        // quedaría girando para siempre.
        estadoFacturaManual.activo = false;
        if (page && !page.isClosed()) {
            console.log('🧹 Cerrando sesión del SII...');
            try { await page.goto('https://misiir.sii.cl/cgi_misii/siu/cgi_misii_logout', { timeout: 5000 }); } catch (e) {}
        }
        
        // La base PRIMERO. Antes iba después del navegador y, si `browser.close()`
        // se colgaba, esta línea no corría nunca: quedaba una conexión abierta y
        // el candado del SII sin soltar, o sea sin poder volver a facturar.
        await cerrarCliente(client, 'FACTURA');
        console.log('🛑 Cerrando navegador Puppeteer...');
        await cerrarNavegador(browser, 'FACTURA');

        console.log('🏁 Recursos liberados. ¡Misión Cumplida!');
    }
}