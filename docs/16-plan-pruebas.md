# 16 — Plan de pruebas (QA)

> **Principio de este plan:** un sistema que maneja dinero e inventario no se
> prueba mostrando que funciona. Se prueba intentando **romperlo**: dos personas
> haciendo lo mismo a la vez, la red cayéndose a mitad de una venta, un
> empleado tratando de ver lo que no le corresponde.

---

## 1. Niveles de prueba

| Nivel | Qué cubre | Herramienta | Cuándo corre |
|---|---|---|---|
| **Unitarias** | Lógica pura: totales, costo promedio, arqueo, FEFO, RUT, EAN | Vitest | Cada commit |
| **Base de datos** | Funciones PL/pgSQL, triggers, RLS | SQL + cliente de prueba | Cada PR |
| **Integración** | Flujos completos contra Supabase real (proyecto `dev`) | Vitest + supabase-js | Cada PR |
| **End-to-end** | Venta, caja y recepción desde la interfaz | Playwright | Cada PR |
| **Concurrencia** | Varios usuarios simultáneos | Script de carga | Antes de cada release |
| **Manual / exploratoria** | Escaneo en celulares reales, usabilidad | Persona | Antes de cada release |

**Estado al 2026-09-18:**

- **Unitarias:** 291 pruebas en `packages/core` (`npm test`).
- **Base de datos y concurrencia:** 33 pruebas contra un PostgreSQL real, en
  `tools/pg-test/` (`npm run db:test`, ~30 s). Levanta un PostgreSQL embebido,
  le pone encima lo mínimo de Supabase —`auth.uid()`, los roles y **los
  privilegios por omisión que Supabase concede**, sin los cuales una política
  permisiva pasaría las pruebas y fallaría en producción— y aplica las
  migraciones. Tres archivos: `concurrencia` (CP-01 a CP-08 y cinco carreras
  más), `seguridad` (ataques con la sesión de cada rol, CP-09, CP-10) e
  `instalacion` (el `instalar.sql` que se pega en Supabase).
- **Integración, end-to-end:** pendientes. Necesitan el proyecto de Supabase
  instalado (B-01).

> Las carreras no se lanzan "a la vez" esperando que choquen: se fuerza el
> peor intercalado. La sesión 1 hace su operación en una transacción abierta,
> la 2 lanza la suya, se espera a que quede bloqueada, y recién entonces se
> confirma la 1. El resultado no depende de la suerte.

---

## 2. Casos críticos de concurrencia

Son los que corresponden al módulo **M10**. Cada uno describe el escenario, lo
que debe pasar y **cómo se rompe si está mal implementado**.

### Resultado de la primera ejecución — 2026-09-18

| Caso | Antes de 0012 | Hoy |
|---|---|---|
| CP-01 · última unidad | ✅ (ver nota) | ✅ |
| CP-02 · folios | ✅ | ✅ |
| CP-03 · reenvío | ✅ secuencial · ❌ con el primer envío en curso | ✅ |
| CP-04 · FEFO | ✅ | ✅ |
| CP-05 · toma dos veces | ❌ la toma decía 7, quedó en 4 | ✅ |
| CP-06 · edición simultánea | ⬜ no implementado (P-24) | ⬜ |
| CP-07 · cierre ajeno | ❌ la venta quedaba fuera del arqueo | ✅ |
| CP-08 · dos cajas | ❌ error de la base en vez de `CAJA_YA_ABIERTA` | ✅ |

Además, cinco carreras que el plan no tenía y que fallaban igual: anular la
misma venta, anular la misma recepción y dar de baja el mismo lote dos veces;
dos recepciones del mismo producto (costo promedio pisado); dos ajustes al
mismo producto. Detalle en [21](21-qa-pantallas.md) §0c.

> **Nota sobre CP-01.** El resultado esperado de abajo (stock −1) supone que las
> dos ventas pasan. No pasan: las ventas de un local quedan en fila por el
> contador de folios, y la segunda ve stock 0. Un vendedor recibe
> `STOCK_INSUFICIENTE`; un supervisor sí vende, queda en −1 y se alerta. Lo que
> el caso protege —que ninguna venta se pierda— se cumple en los dos.

### CP-01 · Dos cajeros venden la última unidad — `RF-M10-02`
| | |
|---|---|
| **Precondición** | Producto A con stock = 1. Cajero 1 y Cajero 2 con caja abierta |
| **Acción** | Ambos confirman una venta de 1 unidad de A **en el mismo segundo** |
| **Resultado esperado** | Ambas ventas quedan registradas. Stock final = **−1**. Se genera alerta de stock negativo |
| **Resultado INCORRECTO** | Stock final = 0 (una venta descontó y la otra se perdió) |
| **Por qué se permite el negativo** | ADR-005: el local no deja de vender. El −1 es información verdadera sobre lo que ocurrió |
| **Cómo romperlo** | Implementar el descuento como `SELECT` + `UPDATE` separados en vez de una sola sentencia atómica |

### CP-02 · Folios sin saltos ni repetidos — `RF-M10-04`
| | |
|---|---|
| **Acción** | 50 ventas simultáneas desde 5 dispositivos |
| **Esperado** | 50 folios consecutivos, sin repetir y sin saltos |
| **Verificación** | `select count(*), count(distinct folio), max(folio)-min(folio)+1 from sales` — los tres números deben coincidir |

### CP-03 · Reintento de venta offline no duplica — `RF-M10-09`
| | |
|---|---|
| **Acción** | Enviar la misma venta (mismo `client_uuid`) 3 veces seguidas |
| **Esperado** | 1 sola venta. La 2ª y 3ª devuelven `already_existed: true` y **no** son un error |
| **Cómo romperlo** | Quitar el índice `UNIQUE (tenant_id, client_uuid)` |

### CP-04 · FEFO no descuenta dos veces del mismo lote — `RF-M10-10`
| | |
|---|---|
| **Precondición** | Producto perecible con lote A (vence 20/09, 5 u) y lote B (vence 15/10, 10 u) |
| **Acción** | Dos cajeros venden 4 unidades cada uno a la vez |
| **Esperado** | Lote A queda en 0, lote B en 7. Total descontado = 8 |
| **Resultado INCORRECTO** | Lote A en 1 y lote B en 10 (ambos leyeron el mismo saldo inicial) |
| **Mecanismo** | `SELECT … FOR UPDATE` en `fn_consume_lots` |

### CP-05 · Toma de inventario no se aplica dos veces — `RF-M10-08`
| | |
|---|---|
| **Acción** | Dos usuarios pulsan "Aplicar" sobre la misma toma |
| **Esperado** | La primera aplica; la segunda falla con `TOMA_YA_APLICADA`. Los ajustes se generan **una sola vez** |

### CP-06 · Edición simultánea del mismo producto — `RF-M10-03` ⚠️
| | |
|---|---|
| **Acción** | Usuario 1 y Usuario 2 abren el producto A. U1 cambia el precio a $2.000 y guarda. U2, con el valor viejo en pantalla, cambia el nombre y guarda |
| **Esperado** | U2 recibe aviso de que el producto cambió y ve el precio actual antes de confirmar |
| **Estado actual** | ❌ **No implementado.** Hoy U2 sobrescribe el precio de U1 sin aviso |
| **Acción requerida** | Implementar bloqueo optimista por `updated_at`. Ver P-24 |

### CP-07 · Cierre de caja ajeno — `RF-M10-05`
| | |
|---|---|
| **Acción** | Un supervisor cierra la caja de un cajero que tiene un carrito a medias |
| **Esperado** | El supervisor ve una advertencia. Si continúa, el cajero recibe `CAJA_YA_CERRADA` al cobrar y no pierde el carrito |
| **Resultado INCORRECTO** | El cajero pierde la venta sin explicación |

### CP-08 · Dos cajas abiertas del mismo usuario — `RF-M6-09`
| | |
|---|---|
| **Acción** | Un usuario intenta abrir caja desde dos dispositivos |
| **Esperado** | La segunda falla con `CAJA_YA_ABIERTA` |
| **Mecanismo** | Índice único parcial `one_open_session_per_user` |

---

## 3. Casos críticos de seguridad y permisos

### CP-09 · Un vendedor no ve las ventas de otro — `RF-M10-07`
Autenticarse como `vendedor` y consultar `sales` directamente por la API,
saltándose la interfaz. Debe devolver **solo** las propias.

### CP-10 · Un vendedor no ve costos
Consultar `products` como `vendedor`. La columna `avg_cost` no debe ser
accesible. Se verifica atacando la API directamente, no mirando la pantalla.

### CP-11 · Aislamiento entre locales — `RNF-27`
Crear dos tenants con datos. Autenticarse en el tenant A e intentar leer datos
del B por id explícito en **todas** las tablas. Cero filas en todos los casos.

### CP-12 · El kardex es inmutable — `RF-M4-11`
Intentar `UPDATE` y `DELETE` sobre `inventory_movements` y `audit_log` con cada
uno de los cuatro roles, **incluido `admin`**. Los ocho intentos deben fallar.

### CP-13 · Ninguna llave secreta en el navegador — `RNF-25`
Compilar y buscar `sb_secret_` y `"role":"service_role"` en todo el bundle.
Cero coincidencias. **Este test corre en CI y bloquea el despliegue.**

### CP-14 · Toda tabla con RLS — `RNF-24`
```sql
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
```
Debe devolver **cero filas**.

---

## 4. Casos críticos de modo offline

### CP-15 · Venta sin conexión
Modo avión → registrar 5 ventas → reconectar. Las 5 llegan, en orden, sin
duplicados. El indicador vuelve a cero.

### CP-16 · Venta con respuesta perdida
Cortar la red **después** de enviar pero antes de recibir respuesta. Al
reintentar, la venta no se duplica (CP-03).

### CP-17 · Una venta con error no bloquea a las demás
Cola de 6 ventas donde la 3ª tiene un producto desactivado. Las otras 5 se
sincronizan; la 3ª queda visible en error para resolución manual.

### CP-18 · La hora de la venta es la real
Venta offline a las 14:30, sincronizada a las 18:00. Debe aparecer en el reporte
como venta **de las 14:30** y afectar la caja de ese turno.

---

## 5. Casos de negocio

| ID | Caso | Esperado |
|---|---|---|
| CP-19 | Costo promedio: 10 u a $1.000 + 10 u a $1.400 | `avg_cost` = $1.200 |
| CP-20 | Recepción con stock negativo | `avg_cost` = costo de la compra |
| CP-21 | Cierre con diferencia sin comentario | Rechazado con `MOTIVO_REQUERIDO` |
| CP-22 | Anular venta | Stock repuesto, caja ajustada, venta marcada (no borrada), bitácora escrita |
| CP-23 | Anular venta de perecible | Unidades vuelven **al lote exacto** del que salieron |
| CP-24 | Recibir perecible sin fecha | Rechazado con `VENCIMIENTO_REQUERIDO` |
| CP-25 | Recibir lote ya vencido | Rechazado con `LOTE_YA_VENCIDO` |
| CP-26 | Descuento sobre el límite del rol | Rechazado |
| CP-27 | Vender sin caja abierta | Rechazado con `CAJA_NO_ABIERTA` |
| CP-28 | Código de barras duplicado | Rechazado indicando a qué producto pertenece |

---

## 6. Pruebas en dispositivo real

No se pueden automatizar y son las que deciden si el sistema se usa o no.

| ID | Caso | Criterio |
|---|---|---|
| CP-29 | Escaneo en 3 modelos distintos (Android + iPhone) | ≥ 90 % de lecturas exitosas sobre 50 productos reales |
| CP-30 | Escaneo con poca luz | Funciona o falla con mensaje claro y búsqueda manual disponible |
| CP-31 | Operación con una sola mano | Vender completo con el pulgar en un celular de 5" |
| CP-32 | Instalación como PWA | Ícono en pantalla de inicio, abre sin barra del navegador |
| CP-33 | Tiempo de venta | < 10 s desde escanear hasta comprobante (OP-1) |
| CP-34 | Capacitación | Un trabajador nuevo vende solo tras 15 min (RNF-18) |

---

## 7. Criterios de salida por fase

| Fase | No se cierra hasta que… |
|---|---|
| F1 | CP-11, CP-13, CP-14 pasan |
| F2 | CP-19 a CP-21, CP-24, CP-25, CP-28 pasan |
| F3 | **CP-01 a CP-08 y CP-15 a CP-18 pasan.** Es la puerta más estricta del proyecto |
| F4 | CP-09, CP-10, CP-12 pasan; respaldo restaurado con éxito |
| F5 | CP-29 a CP-32 pasan |
| F6 | CP-33, CP-34 pasan; todos los anteriores siguen pasando |

---

## 8. Registro de defectos

| Severidad | Definición | Plazo |
|---|---|---|
| **Crítica** | No se puede vender, o hay pérdida/corrupción de datos | Bloquea el release. Corrección inmediata |
| **Alta** | Una función central no opera, o un rol ve lo que no debe | Antes del release |
| **Media** | Función secundaria con falla, con alternativa disponible | Siguiente versión |
| **Baja** | Cosmético o de conveniencia | Backlog |

> **Regla:** un defecto de concurrencia o de permisos es **siempre crítico o
> alto**, aunque parezca raro de reproducir. Un stock que se descuadra una vez
> cada mil ventas descuadra el inventario igual, y nadie sabrá por qué.
