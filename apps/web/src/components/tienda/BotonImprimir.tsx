'use client';

/** Imprimir o guardar en PDF el pedido (el comprobante del cliente, RF-T81). */
export function BotonImprimir({ texto = 'Imprimir' }: { texto?: string }) {
  return <button type="button" className="btn btn-secundario" onClick={() => window.print()}>{texto}</button>;
}
