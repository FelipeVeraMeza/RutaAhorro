# ADR-006 · Kardex inmutable como fuente de verdad del inventario

**Estado:** Aceptada
**Fecha:** 2026-09-14

## Contexto

Hay que decidir cómo se representa el stock. La pregunta parece técnica, pero es
de negocio: **cuando dentro de seis meses falten 12 unidades de un producto, el
dueño va a querer saber qué pasó.** Si el sistema no puede responder eso, no
resuelve el problema por el que se contrató.

Además, la amenaza más probable en un comercio pequeño no es un atacante externo:
es alguien del propio local intentando tapar un faltante
([10 §1](../10-seguridad-cumplimiento.md)).

## Alternativas evaluadas

### A · Una columna `stock` que se actualiza
**A favor:** simplísimo; una lectura, una escritura.
**En contra:** no hay historia. Si el número está mal, no hay forma de saber
cuándo ni por qué se desvió. Y cualquiera con permiso de edición puede ajustar el
número sin dejar rastro — justo lo que hay que impedir.

### B · Solo el kardex, sin saldo almacenado
**A favor:** una única fuente de verdad, imposible de desincronizar.
**En contra:** cada escaneo del POS tendría que sumar todos los movimientos
históricos del producto. Con un año de operación, eso rompe el objetivo de
búsqueda en menos de 300 ms (RNF-02).

### C · Kardex inmutable + saldo derivado ← **elegida**
**A favor:** historia completa y auditable, con lecturas rápidas.
**En contra:** dos representaciones del mismo dato pueden desincronizarse.

## Decisión

**`inventory_movements` es la fuente de verdad. `stock_levels` es una caché
mantenida por trigger.**

Reglas:

1. Todo cambio de stock inserta una fila en `inventory_movements` con tipo,
   cantidad con signo, saldo resultante, usuario, motivo y referencia al
   documento origen.
2. **Sin `UPDATE`. Sin `DELETE`.** Un trigger los rechaza para todos los roles,
   incluido `admin`. Corregir significa insertar un movimiento compensatorio.
3. `stock_levels` se actualiza por trigger en la misma transacción.
4. `fn_rebuild_stock_levels()` puede reconstruir la caché completa desde el
   kardex en cualquier momento.
5. Un trabajo semanal compara ambos y **alerta si difieren**.

## Consecuencias

**Positivas**
- El dueño puede reconstruir la historia completa de cualquier producto: quién lo
  movió, cuándo, por qué y con qué documento.
- La merma, el robo y el error de digitación quedan **separados y medibles**, en
  lugar de confundidos en un solo número.
- **Nadie puede tapar un faltante**, ni siquiera un administrador con acceso
  total. Ese es el control de negocio que hace confiable todo el sistema.
- Anular una venta no borra nada: deja el movimiento original **y** el de
  reversa. La historia muestra que se anuló, no finge que nunca ocurrió.

**Negativas**
- `inventory_movements` crece de forma indefinida. A ~300 movimientos diarios son
  ~110.000 filas al año: irrelevante para PostgreSQL con los índices correctos.
- La caché puede desincronizarse por un error en un trigger. **Mitigación:** la
  verificación semanal automática (`rebuild-stock-check`) detecta la desviación
  antes de que la note el cliente.

**Condiciona**
- Ninguna operación puede escribir `stock_levels` directamente. Toda modificación
  de stock pasa por un movimiento del kardex, sin excepción.
- El mismo principio se aplica a `audit_log`: inmutable por las mismas razones y
  con el mismo mecanismo.
