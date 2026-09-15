# ADR-005 · El modo offline es un requisito, no una mejora

**Estado:** Aceptada
**Fecha:** 2026-09-14

## Contexto

El POS corre en el celular del trabajador, dentro de un local comercial. La
conectividad real en ese escenario es variable: WiFi que no llega al fondo de la
tienda, datos móviles con señal intermitente, cortes del proveedor.

Si el sistema deja de funcionar cuando se cae internet, ocurre lo siguiente: el
local vuelve al cuaderno, registra las ventas "después" (o no las registra), y el
inventario deja de reflejar la realidad. **Una sola tarde sin conexión puede
destruir la confianza en el sistema de forma permanente.**

## Alternativas evaluadas

### A · Requiere conexión
**A favor:** mucho más simple; una sola fuente de verdad; sin conflictos.
**En contra:** el local deja de vender, o vende fuera del sistema. Inaceptable
para el caso de uso.

### B · Offline como mejora posterior (v1.1)
**A favor:** libera antes la primera versión.
**En contra:** agregar el modo offline después obliga a reescribir el flujo de
venta completo: la generación de identificadores, el manejo de errores, el estado
del carrito, la búsqueda de productos y la escritura del stock cambian todos. En
la práctica significa construir el POS dos veces.

### C · Offline desde el diseño ← **elegida**
**A favor:** el local nunca deja de vender; el POS responde instantáneamente
porque no espera a la red ni siquiera cuando hay conexión.
**En contra:** es la parte técnicamente más difícil del proyecto (R-04).

## Decisión

**El POS se diseña y construye offline desde F3, junto con la venta, no después.**

Arquitectura:

| Pieza | Rol |
|---|---|
| Service Worker | Cachea el esqueleto de la aplicación |
| IndexedDB (Dexie) | Catálogo replicado + cola de ventas pendientes |
| `client_uuid` | Identificador generado en el dispositivo, clave de idempotencia |
| Background Sync | Despierta la sincronización al recuperar la señal |
| `sold_at` vs `synced_at` | Hora real de la venta vs. hora de llegada al servidor |

### Las tres decisiones difíciles, tomadas de antemano

**1. Se permite vender con stock desactualizado.**
Dos cajeros offline pueden vender el mismo último producto. Al sincronizar, el
stock queda negativo. **El sistema lo registra y alerta; no lo bloquea.** Un
stock negativo no es un error del software: es información verdadera sobre lo que
pasó en el local. Bloquear la venta para proteger un número sería anteponer la
prolijidad del sistema al negocio del cliente.

**2. La venta vale a la hora en que ocurrió.**
`sold_at` lo fija el dispositivo; `synced_at`, el servidor. Una venta de las 14:30
sincronizada a las 18:00 **es una venta de las 14:30** para el reporte del día y
para el arqueo de esa caja.

**3. Se cobra el precio que el dispositivo conocía.**
Si el precio cambió mientras el celular estaba offline, se respeta lo que se le
cobró al cliente y se congela en `sale_items.unit_price`. Corregir el precio a
posteriori significaría que el reporte no coincide con lo que realmente pasó en
el mostrador.

## Consecuencias

**Positivas**
- **Continuidad de venta del 100 %**, incluso con el servicio central caído. Es
  el compromiso más valioso del SLA ([12 §5.3](../12-costos-modelo-servicio.md)) y
  algo que los competidores a este precio no ofrecen.
- El POS se siente instantáneo siempre: no espera a la red ni con buena señal.
- La búsqueda de productos es local, por lo tanto inmediata (RNF-02).

**Negativas**
- Es la parte más compleja y riesgosa del proyecto (R-04, exposición 15).
- El catálogo completo viaja al dispositivo: con más de 5.000 SKU hay que
  replicar solo un subconjunto (R-12).
- Requiere pruebas específicas y deliberadas de corte de red, que no se pueden
  improvisar al final.

**Condiciona**
- Toda operación del POS debe poder expresarse como una intención encolable.
- La sincronización **nunca** es "todo o nada": cada venta se resuelve por
  separado, para que una venta problemática no bloquee las demás del turno
  ([08 §4.1](../08-api-contratos.md)).
- La demostración de fin de F3 se hace **con el modo avión activado**. Si no pasa
  esa prueba, la fase no está terminada.
