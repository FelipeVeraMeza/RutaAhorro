/**
 * Imprime SOLO el ticket, en un documento aparte del ancho del rollo
 * (Felipe, 2026-10-13: impresora térmica YHD-8390, papel de 80 mm).
 *
 * Antes se imprimía la página entera con todo lo demás invisible
 * (`visibility: hidden` en globals.css): lo invisible igual ocupa alto, y en
 * una impresora de rollo eso es papel en blanco. Acá el documento tiene solo
 * el ticket, así que el papel mide lo que mide el ticket.
 *
 * Para que salga sin el cuadro de impresión: impresora térmica como
 * predeterminada en Windows y Chrome abierto con `--kiosk-printing`.
 */
export function imprimirTicket(elemento: HTMLElement | null, anchoPapelMm = 80) {
  if (!elemento) return;
  // El área que imprime una térmica de 80 mm es de unos 72 mm (58 → 48).
  const util = anchoPapelMm >= 80 ? 72 : 48;
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  Object.assign(marco.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(marco);
  const doc = marco.contentDocument;
  const win = marco.contentWindow;
  if (!doc || !win) { marco.remove(); window.print(); return; }

  // Las mismas hojas de estilo de la app (las clases del ticket), y encima el formato del rollo.
  const estilos = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((n) => n.outerHTML).join('');
  doc.open();
  doc.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">${estilos}<style>
    @page { margin: 0; }
    html, body { background: #fff !important; margin: 0; padding: 0; }
    body { width: ${util}mm; padding: 2mm ${(anchoPapelMm - util) / 2}mm 6mm; color: #000;
           font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; line-height: 1.35; }
    /* Lo justo para que el ticket se lea aunque las hojas de la app no carguen. */
    p { margin: 0; }
    .flex { display: flex; } .justify-between { justify-content: space-between; } .gap-2 { gap: 2mm; }
    .shrink-0 { flex-shrink: 0; } .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .text-center { text-align: center; } .font-bold { font-weight: 700; }
    .border-t { border-top: 1px dashed #000; } .my-2 { margin: 2mm 0; } .mb-2 { margin-bottom: 2mm; }
    .mt-1 { margin-top: 1mm; } .mt-3 { margin-top: 3mm; } .whitespace-pre-line { white-space: pre-line; }
    #ticket { position: static !important; width: 100% !important; visibility: visible !important; }
    #ticket * { visibility: visible !important; color: #000 !important; }
    .no-imprimir { display: none !important; }
  </style></head><body>${elemento.outerHTML}</body></html>`);
  doc.close();

  let impreso = false;
  const imprimir = () => {
    if (impreso) return;
    impreso = true;
    win.focus();
    win.print();
    // El cuadro de impresión bloquea hasta cerrarse; después se limpia.
    setTimeout(() => marco.remove(), 1000);
  };
  // Espera las hojas de estilo; si alguna no avisa, igual imprime al segundo.
  marco.onload = imprimir;
  setTimeout(imprimir, 1000);
}
