# Modelo: el robot de facturación de VSV-Contadores

Copia **sin modificar** de los archivos de
`VSV-Contadores/src/components/facturacion/scripts/` (commit `78577d2`,
2026-09-18), traída el 2026-09-28 por pedido de Felipe: el emisor real de
RutaAhorro se construye a partir de este robot.

| Archivo | Qué hace en VSV |
|---|---|
| `factura_manual.mjs` | Entra al portal gratuito del SII con la clave del contribuyente, llena el formulario de factura (33), firma con la clave del certificado, lee el folio, baja el PDF y guarda en `documentos_emitidos` |
| `empresaEmisora.mjs` | Elige la empresa emisora por su RUT (no por su posición en la lista) |
| `descargarDocumentoSii.mjs` | Baja el PDF de un folio ya emitido |
| `cerrarNavegador.mjs` | Cierra Chrome con tope de tiempo, sin colgarse |

**No se ejecutan ni se compilan** (el worker compila solo `src/**/*.ts`, y
estos importan módulos que existen en VSV y no acá). Son la referencia: si el
portal del SII cambia y VSV lo arregla, se compara contra esta copia.

## Lo que cambió al adaptarlo (`../portal.ts` y `../../jobs/facturas-sii.ts`)

| En VSV | En RutaAhorro | Por qué |
|---|---|---|
| Una sola línea de detalle (`EFXP_NMB_01`) | Hasta 60 líneas (`_01` … `_60`) | La factura manual trae varias líneas, de catálogo y libres |
| El precio se escribe tal cual y se asume neto | Precio **neto** por unidad calculado en core (`planFacturaPortal`), y antes de firmar se compara el total que calculó el portal con el de la base | En RutaAhorro los precios incluyen IVA (regla 7). Si el portal da otro total, **no se firma** |
| Credenciales del `.env` o de `credencial_global` | `sii_credenciales` cifrada con AES-256-GCM (`@rutaahorro/core` `cifrado`), llave `SII_CLAVE_CIFRADO` solo en el servidor | Las claves del cliente no viven en un archivo |
| `puppeteer` (baja Chrome al instalar) | `puppeteer-core` con el Chromium del sistema (`CHROME_PATH`) | El `npm ci` de la raíz instala todos los paquetes: con `puppeteer` la web también bajaría 170 MB de Chrome en cada despliegue |
| Se llama desde un botón y el usuario espera 30–90 s | La factura queda en cola (`por_emitir`); el worker la toma, emite y registra el folio | El POS y la pantalla no esperan al SII |
| Guarda en `documentos_emitidos` y crea la empresa en el CRM | `fn_sii_registrar_emision` crea el `dte_documentos` con el folio del SII y marca la factura emitida | El receptor ya quedó como cliente al facturar (0026) |
| Envía el correo al cliente y registra la cobranza | No se hace todavía | No hay correo propio (T-50) ni cobranza en RutaAhorro |
| RUT de VSV escrito como valor por omisión | Sin valores por omisión: todo sale de la base | Es otro contribuyente |
| URL del SII escritas en el código | `portal.ts` recibe `portal: { sii, misii }` opcional; por omisión, el SII real. No se lee de una variable de entorno | Para probarlo contra `test/portal-simulado.ts` sin que una variable mal puesta en Railway mande las claves a otro sitio |

## Lo que NO viene de VSV y sigue siendo un supuesto (2026-09-28)

`test/portal.test.ts` hace pasar el robot por un portal simulado con los mismos
`name` e `id` (4 casos: emite con dos líneas, no firma si el total no cuadra,
avisa si el error es después de firmar, se detiene si la empresa no está). Eso
prueba la lógica del robot, **no** que el SII real sea así. VSV nunca hizo esto,
así que hasta la primera emisión real (B-04, B-05) son supuestos:

- **El botón para agregar la 2ª línea.** VSV emite siempre una (`EFXP_NMB_01`).
  El robot busca un botón que diga "agregar línea" o "agregar detalle".
- **Los campos de totales** que se leen antes de firmar (`MNT_NETO`, `IVA`,
  `MNT_TOTAL` en el `name` o el `id`). VSV no los lee.
- **Que el portal redondee el IVA** como `ivaDeNeto` de core.

Si alguno falla, el robot **no firma**: se detiene con "El portal no mostró la
línea 2" o "No se pudo leer el total" y dice en qué página quedó. Esto lo confirma el **ensayo**
(`npm run ensayo-sii -w @rutaahorro/worker -- --ver`, `ensayarEnPortal`): el
recorrido completo contra el portal real, sin firmar. Sin un ensayo exitoso
con las credenciales vigentes, la base no deja encender la emisión (0028).
