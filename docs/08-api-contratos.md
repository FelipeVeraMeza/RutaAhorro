# 08 — Contratos de API

Tres superficies de acceso, con propósitos distintos:

| Superficie | Quién la usa | Para qué |
|---|---|---|
| **PostgREST** (Supabase directo) | Navegador | Lecturas y CRUD simple, protegido por RLS |
| **RPC** (funciones PL/pgSQL) | Navegador y route handlers | Operaciones **transaccionales**: venta, recepción, caja |
| **Worker** (Railway) | Trabajos programados y peticiones internas | Respaldos, correos, reportes pesados |

> Regla: si una operación toca **más de una tabla** y no puede quedar a medias, va
> por RPC. Nunca se orquesta una transacción desde el celular.

---

## 1. Convenciones

- **Autenticación**: `Authorization: Bearer <access_token>` de Supabase Auth.
  El `tenant_id` **nunca** se acepta como parámetro: se deriva del token vía
  `auth.tenant_id()`. Aceptarlo del cliente sería el agujero de seguridad más
  obvio posible.
- **Montos**: enteros CLP.
- **Cantidades**: decimal con hasta 3 decimales.
- **Fechas**: ISO 8601 con zona (`2026-09-14T14:32:00-03:00`).
- **Errores**: siempre con la forma

```json
{
  "error": {
    "code": "STOCK_INSUFICIENTE",
    "message": "No hay stock suficiente de Coca-Cola 1.5L",
    "details": { "product_id": "…", "available": 2, "requested": 5 }
  }
}
```

El `message` va en **español y en lenguaje del negocio**: se muestra tal cual al
cajero (RNF-20).

---

## 2. RPC transaccionales

### 2.1 `fn_register_sale` — registrar una venta

`POST /rest/v1/rpc/fn_register_sale`

```jsonc
{
  "p_client_uuid": "3f1c…",        // generado en el dispositivo — idempotencia
  "p_sold_at":     "2026-09-14T14:32:00-03:00",  // hora REAL de la venta
  "p_items": [
    { "product_id": "…", "quantity": 2, "unit_price": 1990, "discount_amount": 0 }
  ],
  "p_payments": [
    { "method": "efectivo", "amount": 3980, "received_amount": 5000 }
  ],
  "p_discount_total": 0,
  "p_notes": null
}
```

**Respuesta 200**
```jsonc
{
  "sale_id": "…",
  "folio": 1042,
  "total": 3980,
  "change_amount": 1020,
  "sold_at": "2026-09-14T14:32:00-03:00",
  "synced_at": "2026-09-14T14:32:01-03:00",
  "already_existed": false        // true si fue un reenvío deduplicado
}
```

**Comportamiento**
1. Si ya existe una venta con ese `client_uuid`, **devuelve la existente** con
   `already_existed: true`. No es un error: es el reenvío esperado tras un corte
   de red.
2. Valida caja abierta del usuario → `CAJA_NO_ABIERTA`.
3. Valida que los pagos sumen el total → `PAGO_NO_CUADRA`.
4. Si falta stock: advierte a `vendedor` (`STOCK_INSUFICIENTE`), permite a
   `admin`/`supervisor` con `p_force: true`.
5. Todo ocurre en una transacción. Cualquier fallo revierte todo.

**Errores**: `CAJA_NO_ABIERTA` · `PRODUCTO_NO_ENCONTRADO` · `PRODUCTO_INACTIVO` ·
`STOCK_INSUFICIENTE` · `PAGO_NO_CUADRA` · `DESCUENTO_EXCEDE_LIMITE` · `VENTA_VACIA`

---

### 2.2 `fn_void_sale` — anular una venta

```jsonc
{ "p_sale_id": "…", "p_reason": "Cliente se arrepintió" }
```

Revierte stock (movimientos `anulacion_venta`), ajusta la caja, marca la venta
como `anulada` y escribe en la bitácora. **No borra nada.**

Errores: `VENTA_NO_ENCONTRADA` · `VENTA_YA_ANULADA` · `SIN_PERMISO_ANULAR` ·
`CAJA_YA_CERRADA` · `MOTIVO_REQUERIDO`

---

### 2.3 `fn_confirm_receipt` — confirmar recepción

```jsonc
{
  "p_supplier_id": "…",
  "p_document_type": "guia",
  "p_document_number": "12345",
  "p_received_at": "2026-09-14T09:00:00-03:00",
  "p_items": [
    { "product_id": "…", "quantity": 24, "unit_cost": 1200 }
  ]
}
```

Aumenta stock, escribe el kardex y **recalcula el costo promedio ponderado**
(fórmula en [06 §5.2](06-modelo-datos.md)).

**Respuesta** incluye, por producto, `old_avg_cost` y `new_avg_cost` para que la
interfaz muestre la variación (RF-M3-08).

---

### 2.4 `fn_adjust_stock` — ajuste de inventario

```jsonc
{
  "p_product_id": "…",
  "p_new_quantity": 5,
  "p_movement_type": "merma",     // ajuste_positivo | ajuste_negativo | merma
  "p_reason": "Producto vencido"  // OBLIGATORIO
}
```

Errores: `MOTIVO_REQUERIDO` · `SIN_PERMISO_AJUSTAR` · `CANTIDAD_INVALIDA`

---

### 2.5 Caja

| Función | Entrada | Notas |
|---|---|---|
| `fn_open_cash_session` | `p_opening_amount` | Falla con `CAJA_YA_ABIERTA` si el usuario ya tiene una |
| `fn_add_cash_movement` | `p_type`, `p_amount`, `p_reason` | Motivo obligatorio |
| `fn_close_cash_session` | `p_counted_amount`, `p_notes` | Exige notas si hay diferencia |
| `fn_force_close_session` | `p_session_id`, `p_reason` | Solo `admin`. Queda en bitácora |

`fn_close_cash_session` devuelve el resumen completo del turno:

```jsonc
{
  "session_id": "…",
  "opening_amount": 30000,
  "cash_sales": 162400,
  "cash_in": 0,
  "cash_out": 5000,
  "expected_amount": 187400,
  "counted_amount": 185400,
  "difference": -2000,
  "sales_count": 47,
  "average_ticket": 4821,
  "by_payment_method": {
    "efectivo": 162400, "debito": 71000, "credito": 12500, "transferencia": 0
  }
}
```

---

### 2.6 `fn_apply_stock_count` — aplicar toma de inventario

```jsonc
{
  "p_count_id": "…",
  "p_items": [ { "product_id": "…", "counted_qty": 18 } ]
}
```

Genera un movimiento `toma_inventario` por cada diferencia y devuelve el resumen:
productos con diferencia, unidades y **valor de la diferencia en pesos**.

---

## 3. Lecturas directas (PostgREST)

Consultas simples van directo contra las tablas, protegidas por RLS.

```http
GET /rest/v1/products?select=id,name,sale_price,stock_levels(quantity)
    &is_active=eq.true&order=name.asc
```

Búsqueda por código de barras:
```http
GET /rest/v1/product_barcodes?select=product_id,products(*)&barcode=eq.7801234567890
```

> En el POS **no se usa** esta ruta para buscar: el catálogo está replicado en
> IndexedDB y la búsqueda es local (RNF-02). La consulta remota es el respaldo
> cuando el producto no está en la copia local.

Vistas de reporte (materializadas donde convenga):

| Vista | Contenido |
|---|---|
| `v_sales_daily` | Ventas por día: monto, transacciones, ticket promedio |
| `v_sales_by_product` | Unidades, venta, costo y utilidad por producto |
| `v_inventory_valued` | Stock × costo promedio, por producto y categoría |
| `v_low_stock` | Productos bajo `min_stock` |
| `v_stale_products` | Sin movimiento en N días |
| `v_cash_sessions_summary` | Cierres con sus diferencias |

---

## 4. Route handlers de Next.js

Solo para lo que **no puede** resolverse con RPC o PostgREST:

| Ruta | Método | Para qué |
|---|---|---|
| `/api/sync/sales` | POST | Sincronización por lotes de la cola offline |
| `/api/productos/import` | POST | Carga masiva CSV/Excel: valida todo antes de aplicar |
| `/api/productos/export` | GET | Exportación del catálogo |
| `/api/reportes/[tipo]/export` | GET | Reportes chicos a CSV (los grandes van al worker) |
| `/api/upload/imagen-producto` | POST | Sube a Storage con redimensionado previo |
| `/api/health` | GET | Salud del servicio |

### 4.1 `/api/sync/sales` — sincronización por lotes

```jsonc
// Petición
{ "sales": [ { "client_uuid": "…", "sold_at": "…", "items": [], "payments": [] } ] }

// Respuesta — resultado individual por venta, nunca "todo o nada"
{
  "results": [
    { "client_uuid": "…", "status": "creada",    "sale_id": "…", "folio": 1042 },
    { "client_uuid": "…", "status": "duplicada", "sale_id": "…", "folio": 1039 },
    { "client_uuid": "…", "status": "error",
      "error": { "code": "PRODUCTO_INACTIVO", "message": "…" } }
  ]
}
```

> Cada venta se resuelve por separado a propósito: una venta con un producto que
> alguien desactivó mientras el celular estaba offline **no puede** impedir que
> se sincronicen las otras seis del turno.
> El cliente solo borra de su cola las ventas con estado `creada` o `duplicada`;
> las que fallan quedan en pantalla para resolución manual.

---

## 5. API del worker (Railway)

Servicio privado. Toda petición externa exige
`X-Worker-Secret: <WORKER_SHARED_SECRET>`.

| Ruta | Método | Para qué |
|---|---|---|
| `/health` | GET | Healthcheck de Railway. **Sin autenticación** |
| `/jobs/backup` | POST | Disparar respaldo manualmente |
| `/jobs/daily-summary` | POST | Reenviar el resumen del día |
| `/reports/generate` | POST | Encolar un reporte pesado (Excel/PDF) |
| `/reports/:id/status` | GET | Estado y enlace de descarga |

### Trabajos programados

| Trabajo | Horario (`America/Santiago`) | Qué hace |
|---|---|---|
| `backup-daily` | 03:00 | `pg_dump` → Storage, retención 30 días, alerta si falla |
| `daily-summary` | 22:00 | Correo al admin: ventas, diferencias de caja, stock bajo |
| `low-stock-check` | 08:00 | Alertas de productos bajo mínimo |
| `open-cash-check` | 23:30 | Avisa cajas sin cerrar |
| `rebuild-stock-check` | Domingos 04:00 | Recalcula el stock desde el kardex y **alerta si difiere** |
| `cleanup-old-backups` | 04:00 | Elimina respaldos con más de 30 días |

> `rebuild-stock-check` es el control de integridad del sistema. Si el saldo
> derivado se aparta del kardex, el equipo se entera el domingo, no cuando el
> cliente descubre que su inventario no cuadra.

---

## 6. Catálogo de códigos de error

| Código | HTTP | Mensaje al usuario |
|---|:--:|---|
| `NO_AUTENTICADO` | 401 | Tu sesión expiró. Vuelve a ingresar |
| `SIN_PERMISO` | 403 | No tienes permiso para esta acción |
| `CAJA_NO_ABIERTA` | 409 | Debes abrir caja antes de vender |
| `CAJA_YA_ABIERTA` | 409 | Ya tienes una caja abierta |
| `CAJA_YA_CERRADA` | 409 | Esta caja ya fue cerrada |
| `STOCK_INSUFICIENTE` | 409 | No hay stock suficiente de {producto} |
| `PRODUCTO_NO_ENCONTRADO` | 404 | No encontramos ese producto |
| `PRODUCTO_INACTIVO` | 409 | Ese producto está desactivado |
| `CODIGO_DUPLICADO` | 409 | Ese código ya pertenece a {producto} |
| `PAGO_NO_CUADRA` | 400 | El monto pagado no coincide con el total |
| `DESCUENTO_EXCEDE_LIMITE` | 403 | El descuento supera tu límite autorizado |
| `MOTIVO_REQUERIDO` | 400 | Debes indicar un motivo |
| `VENTA_YA_ANULADA` | 409 | Esta venta ya estaba anulada |
| `RUT_INVALIDO` | 400 | El RUT ingresado no es válido |
| `LIMITE_PETICIONES` | 429 | Demasiados intentos. Espera un momento |
| `ERROR_INTERNO` | 500 | Ocurrió un problema. Ya fuimos notificados |

---

## 7. Límites de tasa

| Endpoint | Límite |
|---|---|
| Inicio de sesión | 5 por minuto por IP |
| Recuperar contraseña | 3 por hora por correo |
| `fn_register_sale` | 60 por minuto por usuario |
| `/api/sync/sales` | 10 por minuto por usuario (lotes de hasta 50) |
| `/api/productos/import` | 5 por hora por tenant |
| Generación de reportes | 20 por hora por tenant |
