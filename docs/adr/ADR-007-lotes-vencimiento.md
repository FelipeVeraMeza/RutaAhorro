# ADR-007 · Control de vencimientos por lote con consumo FEFO

**Estado:** Aceptada
**Fecha:** 2026-09-14

## Contexto

La pregunta P-07 se respondió afirmativamente: **el local maneja productos
perecibles**. Esto llegó después de cerrar el diseño inicial, y cambia el modelo
de datos: un producto con vencimiento ya no es "una cantidad", sino "varias
cantidades, cada una con su fecha".

Sin control de vencimiento, el sistema reportaría 40 unidades disponibles sin
distinguir que 12 vencen esta semana. El dueño descubriría la pérdida al botar el
producto, que es exactamente el problema que vino a resolver.

## Alternativas evaluadas

### A · Una fecha de vencimiento en el producto
**A favor:** trivial, una columna.
**En contra:** falso. Un producto recibido en marzo y otro en junio tienen fechas
distintas y conviven en la misma góndola. Una sola fecha sería mentira desde la
segunda recepción.

### B · Lote obligatorio para todo el catálogo
**A favor:** modelo uniforme, sin casos especiales.
**En contra:** obliga a pedir lote y fecha al recibir tornillos, bolsas y
detergente. Encarece **cada** recepción y **cada** carga inicial para resolver un
problema que afecta a una fracción del catálogo. Con R-02 (la carga inicial ya es
el mayor riesgo del proyecto) esto sería agravarlo gratis.

### C · Lote opt-in por producto + FEFO automático ← **elegida**
**A favor:** solo los perecibles pagan el costo; el resto del catálogo no cambia.
**En contra:** dos caminos de código en venta y recepción.

## Decisión

**`products.tracks_expiry` activa el control por lote producto a producto. La
venta consume FEFO automáticamente, sin intervención del cajero.**

### Las cuatro decisiones concretas

**1. El cajero nunca elige el lote.**
Pedirle que elija destruiría el objetivo de vender en menos de 10 segundos
(OP-1) y, peor, delegaría en la persona más apurada del local una decisión que el
sistema puede tomar sola. `fn_consume_lots` descuenta del lote con
`expiry_date` más cercana. El cajero escanea y cobra, igual que con cualquier
otro producto.

**2. Recibir un perecible sin fecha es un error, no un dato opcional.**
`fn_confirm_receipt` rechaza la recepción con `VENCIMIENTO_REQUERIDO`. Un lote sin
fecha no puede ordenarse por FEFO ni alertarse: aceptarlo produciría un dato
inútil que además contamina el orden de consumo de los demás lotes.

**3. Anular una venta devuelve las unidades a su lote exacto.**
Por eso existe `sale_item_lots`. Devolver al lote más nuevo, o simplemente sumar
al stock, corrompería el control de vencimientos en la primera anulación: el
sistema creería tener producto fresco que en realidad vence mañana.

**4. Vender más de lo que hay en lotes no bloquea la venta.**
Consistente con [ADR-005](ADR-005-offline-first.md): el sobrante se marca como
`unallocated` y queda visible como descuadre. El local no deja de vender porque
el sistema dude.

### Alertas

`v_expiring_lots` clasifica cada lote en `vigente`, `por_vencer` (según
`expiry_alert_days` del producto) o `vencido`, e informa el **valor en riesgo** en
pesos. El trabajo diario del worker lo incluye en el resumen al administrador.

`fn_write_off_lot` da de baja un lote vencido como **merma**, con motivo
obligatorio, de modo que la pérdida aparezca en el reporte de mermas y no se
confunda con un error de inventario.

## Consecuencias

**Positivas**
- El dueño ve qué va a perder **antes** de perderlo, con el monto en pesos.
- La merma por vencimiento queda separada y medible, no diluida en "diferencias".
- La rotación real mejora sola: siempre sale primero lo más viejo, sin depender
  de que el repositor lo recuerde.
- El catálogo no perecible no paga ningún costo adicional.

**Negativas**
- Dos caminos de código en venta y recepción, que hay que probar por separado.
- La recepción de perecibles es más lenta: hay que ingresar la fecha.
- El stock de un perecible vive en dos lugares (`stock_levels` y `product_lots`)
  y podrían desincronizarse. **Mitigación:** extender la verificación semanal
  `rebuild-stock-check` para comparar también la suma de lotes contra
  `stock_levels`, y alertar si difieren.

**Condiciona**
- Marcar un producto como perecible **después** de tener stock exige crear un
  lote inicial para ese saldo; si no, FEFO no encontrará de dónde descontar.
  Debe resolverse en la interfaz de edición de producto.
- La carga inicial debe capturar fecha de vencimiento en los perecibles, lo que
  suma tiempo a R-02. Hay que advertirlo al planificar la puesta en marcha.
