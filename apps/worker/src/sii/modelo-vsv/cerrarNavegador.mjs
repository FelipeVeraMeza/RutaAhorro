// ============================================================================
// CERRAR EL NAVEGADOR SIN QUEDARSE COLGADO
// ----------------------------------------------------------------------------
// `browser.close()` de Puppeteer puede colgarse indefinidamente cuando queda un
// proceso hijo atascado — pasa cuando el SII deja una pestaña a medio cargar.
// Y estaba llamado con `await` pelado dentro de un `finally`, así que cuando se
// colgaba se llevaba puesto todo lo que venía después:
//
//   · `client.end()` no corría   → conexión a la base abierta para siempre
//   · el `finally` no terminaba  → la petición nunca respondía
//   · `soltarCuenta()` del que llama tampoco corría → EL SII QUEDABA TRABADO y
//     no se podía volver a facturar hasta reiniciar el servidor
//
// El robot masivo ya resolvía esto con una carrera contra el reloj; acá está
// extraído para que lo usen todos por igual.
//
// NUNCA lanza: se usa en bloques de limpieza, donde un error tapa el error de
// verdad que se estaba propagando.
// ============================================================================

const TOPE_MS = 8000;

/**
 * Cierra el navegador con tope de tiempo y, si no cede, mata el proceso.
 * @param {import('puppeteer').Browser|null} browser
 * @param {string} etiqueta  para poder distinguir quién lo dejó colgado en el log
 */
export async function cerrarNavegador(browser, etiqueta = 'ROBOT') {
    if (!browser) return;
    try {
        await Promise.race([
            browser.close(),
            new Promise((_, rechazar) =>
                setTimeout(() => rechazar(new Error(`no cerró en ${TOPE_MS / 1000}s`)), TOPE_MS)),
        ]);
    } catch (e) {
        console.log(`⚠️ [${etiqueta}] Cierre forzado del navegador: ${e.message}`);
        try {
            // Último recurso: matar el proceso. Vale la pena aunque sea brusco —
            // la alternativa es dejar Chrome vivo comiendo memoria hasta que
            // alguien reinicie el servidor.
            const proceso = browser.process();
            if (proceso) proceso.kill('SIGKILL');
        } catch (e2) {
            console.log(`⚠️ [${etiqueta}] Tampoco se pudo matar el proceso: ${e2.message}`);
        }
    }
}

/**
 * Suelta la conexión a la base. Se llama ANTES de cerrar el navegador: es lo
 * que más caro sale dejar abierto y no puede quedar detrás de algo que se cuelga.
 */
export async function cerrarCliente(client, etiqueta = 'ROBOT') {
    if (!client) return;
    try { await client.end(); }
    catch (e) { console.log(`⚠️ [${etiqueta}] La conexión a la base ya estaba cerrada: ${e.message}`); }
}
