# ADR-009 · Modelo y simulador de DTE antes que la integración real

**Estado:** Aceptada
**Fecha:** 2026-09-15

## Contexto

El 2026-09-15 el cliente respondió P-03: sí espera emitir **boleta electrónica
y factura electrónica con vinculación al Servicio de Impuestos Internos**.
Durante toda la planificación esto fue R-01, el mayor riesgo de expectativa del
proyecto. Dejó de ser riesgo y pasó a ser alcance.

Emitir un DTE válido exige cinco cosas que **no son código**: certificado
digital, enrolamiento como emisor electrónico, certificación con el set de
pruebas del SII, folios CAF, y firma XML de cada documento. Las cuatro primeras
dependen de trámites del cliente que hoy no están hechos, y cuya fecha de
término no controlamos.

La pregunta no es *si* se hace, sino **en qué orden**, sabiendo que el sistema
tiene que seguir avanzando mientras esos trámites ocurren.

## Alternativas evaluadas

### A · Esperar a tener certificado y proveedor para empezar
**A favor:** se construye una sola vez, contra la interfaz real.
**En contra:** deja el módulo detenido por semanas o meses sobre una
dependencia administrativa. Y cuando llegue, habrá que construir el modelo, la
pantalla, el flujo y la integración al mismo tiempo, que es cuando se cometen
los errores caros.

### B · Integrar directo con el SII desde el principio
**A favor:** sin intermediarios ni costo por documento.
**En contra:** la certificación es un proyecto propio, iterativo y sin fecha
garantizada. Para un cliente, no se paga. Además hace nuestra la mantención de
cada cambio normativo.

### C · Modelo de datos + simulador ahora, proveedor después ← **elegida**
Se construye el modelo completo (`dte_documents`, `dte_folios`, `dte_events`),
el flujo de emisión, los estados y la representación impresa, contra un emisor
ficticio con folios simulados. El simulador respeta las mismas reglas que la
emisión real: folio que se consume aunque falle el envío, documento inmutable,
neto e IVA guardados y no recalculados.

**A favor:** el desarrollo no queda bloqueado por un trámite; cuando lleguen
las credenciales se cambia el adaptador, no el modelo; y el simulador queda
después como ambiente de prueba permanente.
**En contra:** hay que diseñar bien la frontera entre el modelo y el emisor, o
el simulador se convierte en deuda. Riesgo real de creer que "está listo"
cuando lo que está listo es la mitad que no requiere permiso.

## Decisión

**Se construye el modelo de DTE y un emisor simulado, detrás de una interfaz
que después implementa el proveedor real.** La emisión real se integra con un
**proveedor autorizado** y no directo con el SII (P-27 define cuál).

En paralelo y sin esperar nada: **el comprobante interno no tributario**, que
es lo que el cliente describió querer entregar en el mostrador y que hoy no
existe (RF-M5-14).

Dos reglas que acompañan la decisión:

1. **El comprobante interno dice en el papel que no es un documento
   tributario.** Un ticket que se parece a una boleta sin serlo es un problema
   del cliente ante el SII, y se lo habríamos causado nosotros.
2. **El estado "simulado" es visible en la interfaz y en la base.** Nunca se
   puede confundir un documento simulado con uno emitido. Un documento de
   prueba que aparenta validez es exactamente el modo de falla que ADR-003
   describía para los respaldos: genera confianza injustificada.

## Consecuencias

**Positivas**
- El desarrollo avanza sin depender del calendario de trámites del cliente.
- Cuando lleguen las credenciales, lo que se integra es un adaptador, no el
  módulo entero.
- El simulador queda como ambiente de prueba permanente, que es justo lo que
  hace falta para no probar contra folios reales.

**Negativas**
- Trabajo que no produce valor tributario hasta que exista el proveedor.
- Riesgo de dar por terminado el módulo cuando solo está terminada la parte que
  no requiere autorización. **Mitigación:** el cronograma
  ([19](../19-cronograma.md)) separa explícitamente "simulador listo" de
  "emisión real", y la lista de comprobación previa a producción exige la
  segunda.

**Condiciona**
- Ningún documento tributario se edita ni se borra: se anula con nota de
  crédito. Mismo principio que [ADR-006](ADR-006-kardex-inmutable.md), aquí
  además por ley.
- La venta y su documento se emiten en la misma transacción, o no se emite
  ninguno de los dos.
- Los trámites del cliente (certificado, enrolamiento) deben iniciarse **ahora**,
  en paralelo al desarrollo. Si se dejan para cuando el código esté listo, el
  módulo queda esperando igual y se pierde la ventaja de esta decisión.
