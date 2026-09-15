# 18 — Documentos tributarios electrónicos (SII)

> **Este documento existe porque P-03 quedó respondida el 2026-09-15.** El
> cliente sí espera emitir boleta electrónica y factura electrónica con
> vinculación al **Servicio de Impuestos Internos**. Durante toda la
> planificación esto fue el riesgo R-01 — "el mayor riesgo de expectativa del
> proyecto" — y hoy dejó de ser un riesgo para pasar a ser alcance.

---

## 1. Lo que hay que entender antes de programar

Emitir una boleta electrónica en Chile **no es imprimir un papel con el
detalle de la compra**. Son dos cosas distintas y conviene no confundirlas
nunca más en este proyecto:

| | Comprobante interno | Boleta electrónica (DTE 39) |
|---|---|---|
| Qué es | Un papel que dice qué compró y cuánto pagó | Un documento tributario con validez legal ante el SII |
| Quién lo autoriza | Nadie | El SII, con folios que entrega él |
| Qué exige | Nada | Certificado digital, enrolamiento, CAF, certificación |
| Se puede hacer hoy | **Sí** | No, hasta completar trámites que no son código |
| Sirve para | Que el cliente sepa qué lleva | Cumplir la obligación tributaria |

El cliente describió el comprobante interno ("un papel donde salgan los
productos y el valor neto a total a pagar"), pero pidió boleta electrónica.
Necesita los dos, y llegan en momentos distintos.

---

## 2. Lo que el SII exige para emitir

Ninguno de estos puntos se resuelve escribiendo código. Son requisitos previos
del contribuyente, y el sistema no puede emitir un solo documento válido hasta
que estén los cinco.

| # | Requisito | Quién lo hace | Notas |
|---|---|---|---|
| 1 | **Certificado digital** de firma electrónica | El cliente, con un proveedor autorizado | Anual, de pago. Va a nombre del representante legal |
| 2 | **Enrolamiento como emisor electrónico** ante el SII | El cliente, en sii.cl | Trámite en línea |
| 3 | **Certificación** — set de pruebas del SII | Desarrollo + cliente | El SII entrega casos que hay que emitir correctamente antes de autorizar producción |
| 4 | **CAF** (Código de Autorización de Folios) | El cliente descarga, el sistema consume | Un XML por tipo de documento, con un rango de folios. Se agota y hay que pedir más |
| 5 | **Firma XML de cada documento** y su envío | El sistema | XMLDSig sobre el XML del DTE |

> **Verificar la normativa vigente en sii.cl antes de comprometer fechas.** Las
> reglas de boleta electrónica cambiaron varias veces desde 2020 y este
> documento no reemplaza la fuente oficial.

Además, la **representación impresa** de una boleta electrónica tiene contenido
obligatorio: RUT del emisor, tipo y folio del documento, fecha, detalle, monto,
y el **timbre electrónico** (un PDF417 con la firma). Un ticket sin timbre no
es una boleta, es un comprobante interno con otro nombre.

---

## 3. Las dos formas de integrarse, y cuál recomiendo

### A · Integración directa con el SII
Construir el XML del DTE, firmarlo, mantener los CAF, enviar, manejar el
Reporte de Consumo de Folios, y pasar la certificación por cuenta propia.

**A favor:** sin costo por documento, sin depender de un tercero.
**En contra:** es un proyecto en sí mismo. La certificación es iterativa y no
tiene fecha garantizada. Cada cambio normativo del SII pasa a ser mantención
nuestra. Para un solo cliente, no se paga.

### B · Proveedor autorizado con API ← **recomendada**
Hay proveedores chilenos que ya están certificados y exponen una API: se les
manda el detalle de la venta y devuelven el DTE timbrado, el PDF y el envío al
SII. El cliente sigue necesitando su certificado y su enrolamiento, pero la
certificación técnica ya la hizo el proveedor.

**A favor:** semanas en vez de meses; el riesgo normativo es del proveedor.
**En contra:** costo mensual o por documento; dependencia de un tercero.

> **Cuál proveedor es una decisión abierta (P-27).** Hay que comparar costo por
> documento, si cubre boleta *y* factura, y si tiene ambiente de pruebas.
> Ninguna comparación de precios de este documento debe darse por vigente sin
> verificarla.

---

## 4. Lo que sí se construye ahora: modelo + simulador

La parte que no depende de ningún trámite es el **modelo de datos y el flujo**.
Se construye completo, se prueba completo, y se conecta al proveedor cuando el
cliente tenga sus credenciales. El simulador no es una maqueta: emite
documentos con la misma estructura, los mismos folios y las mismas
validaciones, contra un emisor ficticio.

### 4.1 Lo que ya está a favor

Revisando el esquema actual, hay tres cosas que juegan a favor y que no había
que rehacer:

- **El IVA ya se calcula.** `fn_register_sale` toma `iva_pct` de
  `tenants.settings` (19 por defecto) y guarda `tax_amount` en `sales`,
  extrayéndolo de un total que **incluye** IVA:
  `tax_amount = round(total − total / (1 + iva/100))`. Es la convención del
  retail chileno y es la correcta.
- **El folio correlativo ya existe y es atómico.** `fn_next_folio` con
  `folio_counters`, probado sin saltos bajo concurrencia. El folio tributario
  es otro contador distinto — viene del CAF — pero el mecanismo ya está
  resuelto y se replica.
- **La compra ya modela el documento del proveedor.** `purchase_receipts` tiene
  `document_type` (`guia`, `factura`, `boleta`, `sin_documento`) y
  `document_number`. Es exactamente lo que se pidió: la factura que respalda el
  ingreso de inventario.

### 4.2 Lo que falta modelar

| Pieza | Qué es |
|---|---|
| `dte_documents` | Un documento emitido: tipo, folio, estado, XML, timbre, monto neto, IVA, total, referencia a la venta |
| `dte_folios` | Rangos de CAF cargados y cuál es el próximo folio libre por tipo |
| `dte_events` | Bitácora de cada intento de envío y su respuesta. Inmutable, como el kardex |
| Emisor | RUT, razón social, giro, dirección, actividad económica — en `tenants.settings` o tabla propia |
| Receptor | Para factura: RUT y razón social del comprador. Para boleta: normalmente no se pide |
| Estados | `borrador → emitido → enviado → aceptado / rechazado / anulado` |

### 4.3 Reglas que el simulador debe respetar desde el día uno

Estas son las que, si se dejan para después, obligan a rehacer:

- **Un documento tributario emitido no se edita ni se borra. Jamás.** Se anula
  con una nota de crédito. Mismo principio que el kardex inmutable
  ([ADR-006](adr/ADR-006-kardex-inmutable.md)), y aquí además es ley.
- **El folio se consume aunque el envío falle.** No se puede reutilizar. Un
  folio quemado se reporta, no se recicla.
- **Neto, IVA y total se guardan en el documento**, no se recalculan al
  mostrarlo. Si mañana cambia la tasa de IVA, los documentos viejos tienen que
  seguir mostrando lo que efectivamente se cobró.
- **Montos en enteros.** Ya es la convención del proyecto y aquí no es
  negociable: un peso de diferencia por redondeo en un documento tributario es
  una observación del SII.
- **La venta y el documento se emiten en la misma transacción o ninguno de los
  dos.** Una venta sin documento, o un documento sin venta, es un descuadre que
  después nadie sabe arreglar.

---

## 5. El comprobante interno (lo que se entrega mañana)

Independiente de todo lo anterior, y disponible sin ningún trámite:

Al cerrar una venta, un comprobante con el detalle línea por línea —
`2 × Bebida 500 ml .... $2.000` — el subtotal neto, el IVA desglosado, el
total, el medio de pago y el vuelto. Compartible por WhatsApp e imprimible en
impresora térmica de 58/80 mm.

**Tiene que decir en el propio papel que no es un documento tributario.** Un
comprobante que se parece a una boleta y no lo es, es un problema para el
cliente, no para nosotros.

Esto cubre RF-M5-14 y es, además, la representación impresa que después se
reemplaza por la de la boleta timbrada. El trabajo no se bota.

---

## 6. Simultaneidad: la pregunta que se hizo sobre inventario y ventas

*¿Se puede hacer al mismo tiempo la toma de inventario, el ingreso de productos
y la emisión de documentos?*

**Sí, y ya está resuelto en la base de datos.** Cada operación entra por una
función atómica (`fn_register_sale`, `fn_confirm_receipt`, `fn_apply_stock_count`,
`fn_adjust_stock`), el stock se descuenta con `INSERT … ON CONFLICT … RETURNING`
y los lotes se toman con `SELECT … FOR UPDATE`. Dos cajeros vendiendo el mismo
último producto no pueden dejar el stock en −1.

**Con dos salvedades que hay que decir en voz alta:**

1. **Nada de eso está probado bajo concurrencia real.** Los casos CP-01 a CP-08
   de [16](16-plan-pruebas.md) siguen pendientes. Los siete requerimientos de
   M10 marcados como hechos son correctos *por diseño*, no *verificados*.
2. **Editar el mismo producto en simultáneo sí pierde datos** (RF-M10-03). Hoy
   el segundo que guarda sobrescribe al primero sin aviso. Es un hueco conocido
   y está en el cronograma.

Para el caso concreto que se planteó — recepcionar mercadería con su factura
mientras otra persona vende — no hay conflicto: son movimientos de kardex
distintos sobre la misma tabla, y la tabla es append-only.

---

## 7. Lo que esto le cambia al proyecto

Decirlo claro, porque es la parte incómoda:

- **La propuesta comercial y el precio fueron hechos sin esto adentro.** Emitir
  documentos tributarios agrega un costo recurrente (certificado + proveedor) y
  un esfuerzo de desarrollo y certificación que no está en
  [12](12-costos-modelo-servicio.md) ni en [11](11-plan-trabajo.md).
- **Hay una dependencia que no controlamos:** sin certificado digital y
  enrolamiento del cliente, este módulo no pasa de simulador. Conviene iniciar
  esos trámites **ahora**, en paralelo al desarrollo, no cuando el código esté
  listo.
- **R-01 deja de ser un riesgo de expectativa y pasa a ser alcance comprometido.**
  Corresponde actualizar [13](13-riesgos.md) y reflejarlo en el contrato.

---

## 8. Preguntas que esto abre

| # | Pregunta |
|---|---|
| P-27 | ¿Integración directa con el SII o proveedor autorizado? ¿Cuál? |
| P-28 | ¿El cliente ya tiene certificado digital y está enrolado como emisor electrónico? |
| P-29 | ¿Emite solo boleta, o también factura a empresas? La factura agrega receptor, libro de compras y acuse de recibo |
| P-30 | ¿Quién asume el costo recurrente del certificado y del proveedor? |
| P-31 | ¿Hay productos exentos de IVA en el catálogo? Cambia el tipo de documento |

Todas van a [15](15-preguntas-abiertas.md).
