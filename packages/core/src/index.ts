/**
 * @rutaahorro/core — lógica de negocio pura, sin dependencias.
 *
 * Todo lo que está aquí es determinista y probado: cálculo de totales, costo
 * promedio, arqueo, FEFO, validaciones. Lo comparten la app web y el worker.
 * Nada de este paquete toca red, base de datos ni DOM.
 */
export * from './money.js';
export * from './rut.js';
export * from './barcode.js';
export * from './cart.js';
export * from './cost.js';
export * from './cash.js';
export * from './expiry.js';
export * from './errors.js';
export * from './import.js';
export * from './comprobante.js';
export * from './etiqueta.js';
export * from './destino.js';
