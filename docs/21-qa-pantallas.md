# 21 — Auditoría de pantallas (QA)

**Fecha:** 2026-09-15 · **Método:** lectura del código de cada pantalla,
contrastada contra [17](17-inventario-alcance.md) y [03](03-requerimientos-funcionales.md).

## Alcance de esta pasada

| Pantalla | Revisión |
|---|---|
| Caja | Completa |
| Productos (listado) | Completa |
| Inventario | Completa |
| Recepción de mercadería | Completa |
| Vender (POS) | Completa |
| Inicio | Parcial |
| Usuarios | Parcial |
| Proveedores · Importar · Formulario de producto · Ingreso | **Pendiente** |

Las cuatro últimas no se auditaron línea por línea. Cualquier conclusión sobre
ellas en este documento es provisional.

---

## 1. Corregido en esta pasada

### 1.1 · RF-M3-08 no habría funcionado en producción — **grave**

`buscarParaRecepcion` leía el costo anterior de la clave `demo:costos` de
IndexedDB. Esa clave solo la escribe el repositorio **local**: contra Supabase
estaba siempre vacía, así que todo producto llegaba con costo anterior 0 y el
aviso de variación de costo no se disparaba nunca.

Es el peor tipo de falla: un requerimiento marcado como hecho, que funciona en
la demo y no hace nada en la base del cliente. Se habría descubierto cuando un
proveedor subiera un precio y nadie se enterara.

### 1.2 · El «nuevo costo promedio» mostraba otra cosa

La línea de recepción llamaba a `weightedAverageCost` con `currentStock: 0`.
Esa función, por diseño, devuelve el costo entrante cuando el stock es cero
(promediar contra un saldo cero no significa nada). El número rotulado «nuevo
costo prom.» era, en realidad, el costo que el usuario acababa de escribir.

### 1.3 · Escanear en recepción dejaba el costo en cero

Al agregar por escáner se pasaba `costoAnterior: 0`, y con eso el costo
unitario partía en 0. Confirmar sin corregirlo a mano dejaba el costo promedio
del producto en cero, y con él el margen y el inventario valorizado.

### 1.4 · Seed de producción

`seed.sql` inserta 12 productos de ejemplo con códigos EAN inventados. Se creó
`supabase/seed-produccion.sql`, que crea solo tenant y tienda. Los códigos
falsos no son inocuos: ocupan números que el producto real no podrá usar,
porque `product_barcodes` tiene `unique (tenant_id, barcode)`.

---

## 2. Pendiente, por severidad

### Alta

| # | Pantalla | Hallazgo |
|---|---|---|
| A-1 | Inventario | **Aplicar la toma no pide confirmación.** Ajusta el stock de muchos productos y queda en el kardex, que es inmutable. Un toque accidental en «Aplicar toma de 47 productos» no pregunta nada |
| A-2 | Inventario | La toma **aplica conteos de productos ocultos por el filtro**. Contar por partes es deliberado y correcto, pero no hay pantalla de revisión previa: el usuario no puede ver qué 47 productos va a ajustar |
| A-3 | Todas | **`parseCLP` acepta negativos** y ningún campo de dinero lo valida. Un «ingreso» de caja de −500 se registra como egreso encubierto. Afecta apertura de caja, movimientos, conteo de cierre y ajustes |
| A-4 | Productos | **El alta no es atómica.** Son tres escrituras encadenadas (producto → códigos → stock inicial) sin transacción. Si falla la de códigos, queda el producto sin códigos y el usuario ve un error; al reintentar, crea un duplicado. El resto del sistema usa funciones transaccionales justamente para esto |

### Media

| # | Pantalla | Hallazgo |
|---|---|---|
| M-1 | Caja | No se puede corregir un movimiento mal ingresado. Un egreso de 50.000 en vez de 5.000 no tiene arreglo dentro del sistema |
| M-2 | Caja | El botón «Cerrar caja» no advierte que el cierre es irreversible |
| M-3 | Inventario | El ajuste y el conteo aceptan cantidades negativas |
| M-4 | Inventario | El kardex trae 80 movimientos fijos, **sin filtros ni paginación**. Por eso M4-12 bajó a 🟡 |
| M-5 | Productos | Sin paginación: con un catálogo de 1.000 productos renderiza los 1.000. Depende de P-02 |
| M-6 | Recepción | Se puede confirmar con costo unitario 0 sin ningún aviso |
| M-7 | Inventario | M4-16 (stock por lote) figura ✅ como «visible en pantalla Stock» y en el código el listado no muestra lotes. **Verificar** |

### Baja

| # | Pantalla | Hallazgo |
|---|---|---|
| B-1 | Productos | El botón «Reactivar» usa el color de alerta. Reactivar no es destructivo |
| B-2 | Caja | Los campos de monto y motivo del movimiento no tienen `<label>`, solo `placeholder` |
| B-3 | Inventario | El diálogo de ajuste no tiene nombre accesible (`role="dialog"` sin `aria-label`) |
| B-4 | Productos | Al abrir la confirmación de baja no hay estado de carga mientras se consulta si el producto tiene movimientos |

---

## 3. Funciones de base sin pantalla

Confirmado revisando qué RPC invoca la aplicación:

| Función | Requerimiento | Estado |
|---|---|---|
| `fn_void_sale` | M5-15 · Anular venta | Probada, **no la invoca ninguna pantalla** |
| `fn_write_off_lot` | M4-19 · Dar de baja lote vencido | Probada, sin pantalla |
| Cierre forzado de caja | M6-10 | Sin pantalla |

`fn_void_receipt` sí se invoca, desde Proveedores.

---

## 4. Lo que quedó bien

No todo son hallazgos. Estas decisiones resistieron la revisión:

- **El enlace producto ↔ código de barra está correcto en la base:** FK con
  borrado en cascada, `unique (tenant_id, barcode)` haciendo cumplir RF-M2-03,
  índice por producto y RLS activa. El formulario permite varios códigos y
  valida que no estén en uso; la carga masiva trae columna `codigo_barras` con
  validación de dígito EAN y detección de repetidos dentro del archivo.
- **Recepción** exige la fecha de vencimiento en perecibles y bloquea la
  confirmación mientras falte, con el conteo de cuántos faltan a la vista.
- **Productos** distingue desactivar de eliminar, y solo ofrece eliminar cuando
  el producto no tiene historial.
- **Inventario** explica en pantalla por qué el kardex no se edita, y el
  diálogo de ajuste advierte que el movimiento queda con nombre y motivo.
- **Caja** exige comentario cuando hay diferencia y no deja cerrar sin él.
- Los estados de stock usan color **y** texto, no solo color (RNF-46).

---

## 5. Cómo seguir

El orden sugerido, que se integra a [19](19-cronograma.md):

1. A-3 y M-3 juntos: una validación de monto compartida en `core`, con
   pruebas, y aplicarla en los cinco campos de dinero.
2. A-1 y A-2 juntos: pantalla de revisión previa a aplicar la toma, que además
   resuelve la confirmación.
3. A-4: función transaccional `fn_create_product`, como el resto del sistema.
4. M-1 y M-2 con el resto del módulo de caja.
5. Las de severidad baja, en una pasada de accesibilidad junto con las cuatro
   pantallas que faltan auditar.
