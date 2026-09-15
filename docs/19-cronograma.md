# 19 — Cronograma por estado

**Fecha de corte:** 2026-09-15

Este cronograma se ordena por **estado real verificado**, no por el orden en
que aparecen los módulos. El criterio es uno solo: *qué produce valor para el
cliente por unidad de esfuerzo*.

> **Sobre las estimaciones.** Están en días de trabajo efectivo y son órdenes
> de magnitud, no compromisos. Ninguna se ha calibrado contra velocidad real
> porque todavía no hay una medición. Después de F1 hay que recalibrarlas con
> lo que efectivamente costó.

---

## Cómo leer los estados

Del [inventario de alcance](17-inventario-alcance.md):

| | |
|:--:|---|
| ✅ | Hecho y verificado |
| 🔵 | **La lógica existe en la base; no hay pantalla que la alcance** |
| 🟡 | Parcial |
| ⬜ | No empezado |

La regla que ordena todo lo que sigue: **convertir 🔵 en ✅ es mucho más barato
que construir ⬜, y es trabajo ya pagado que hoy no produce nada.** Hay lógica
probada en la base que ningún usuario puede alcanzar.

---

## Mapa de dependencias

```
F0 Producción ──────────────┬──> F1 Cerrar el POS ──> F5 DTE simulador ──> F6 DTE real
   (bloqueado en Felipe)    │                                                  ▲
                            ├──> F2 Reportes                                   │
                            ├──> F3 Alertas y configuración                    │
                            └──> F4 QA de concurrencia                         │
                                                                               │
   Trámites del cliente (certificado, enrolamiento, CAF) ──────────────────────┘
   ⚠️ Empiezan HOY, en paralelo. No dependen de ninguna fase.
```

Lo único que bloquea a todo lo demás es F0. Lo único que bloquea a F6 son
trámites que no controlamos, y por eso tienen que arrancar ya.

---

## F0 · Puesta en producción — *bloqueado, no en desarrollo*

**Estimación: 1 día. Depende de Felipe, no de programar.**

| # | Tarea | Estado |
|---|---|---|
| F0-1 | Aplicar el esquema en Supabase: `npm run db:bundle` → SQL Editor → `seed.sql` | ⬜ |
| F0-2 | Configurar el servicio web en el panel de Railway ([09 §3](09-despliegue.md)) | ⬜ |
| F0-3 | Generar dominio, cargar `NEXT_PUBLIC_APP_URL`, redesplegar | ⬜ |
| F0-4 | Registrar el dominio en las Redirect URLs de Supabase | ⬜ |
| F0-5 | Crear el primer admin y verificar el acceso con un rol de cada tipo | ⬜ |

> **Mientras F0 no pase, el sistema no existe para el cliente.** Todo lo que se
> ha visto corre contra IndexedDB en modo demo. Es la única tarea del
> cronograma que no avanza escribiendo código.

---

## F1 · Cerrar el punto de venta — *el mayor retorno inmediato*

**Estimación: 5–7 días.** Todo lo de aquí es 🔵 o directamente visible para el
cajero. Es lo que se toca todos los días.

| RF | Tarea | Hoy | Por qué ahora |
|---|---|:--:|---|
| M5-14 | **Comprobante de venta** con detalle, neto, IVA y total. Compartible e imprimible | ⬜ | Es lo que el cliente pidió entregar en el mostrador, y no requiere ningún trámite. Base de la futura boleta |
| M5-15 | **Anular venta** — `fn_void_sale` está probada y **no la invoca nadie** | 🔵 | Sin esto, un error de cobro no tiene arreglo dentro del sistema |
| M5-08 | **Descuento por línea o total** — `isDiscountAllowed()` probado, sin control en el POS | 🔵 | El tope por rol ya existe en `tenants.settings` y no se puede usar |
| M5-10 | **Pago mixto** — la base acepta varias filas de pago; `Cobro.tsx` ya recibe un arreglo | 🔵 | Falta poco: el tipo ya está |
| M5-04 | Ofrecer crear producto al escanear uno desconocido | 🟡 | Hoy avisa y deja el código en la búsqueda; falta abrir el formulario |
| M2-04 | Salto desde el POS al alta de producto | 🟡 | Mismo trabajo que el anterior |

**Criterio de término (QA):** una venta completa con descuento, pago mixto,
comprobante impreso y anulación posterior, verificada contra el kardex y el
arqueo de caja.

---

## F2 · Reportes — *seis pantallas sobre vistas que ya existen*

**Estimación: 4–6 días.**

Verificado el 2026-09-15: existen **11 vistas** en la base y la aplicación usa
**tres**. Las otras ocho son trabajo hecho que nadie puede ver.

| RF | Vista que ya existe | Estado |
|---|---|:--:|
| M7-02 | `v_sales_daily` | 🔵 |
| M7-03 | `v_sales_by_user` | 🔵 |
| M7-04 | `v_sales_by_product` | 🔵 |
| M7-06 | Margen y utilidad (la vista ya calcula la utilidad bruta) | 🔵 |
| M7-07 | `v_stale_products` | 🔵 |
| M7-08 | `v_adjustments` | 🔵 |
| M7-09 | Exportar a CSV | ⬜ |
| M7-10 | Gráfico de 30 días | ⬜ |

Al crear `/reportes`, agregarlo a `apps/web/src/lib/navegacion.ts` — hay un
comentario marcando el lugar exacto.

---

## F3 · Alertas y configuración del local

**Estimación: 3–4 días.**

| RF | Tarea | Hoy |
|---|---|:--:|
| — | **Pantalla de alertas.** La tabla `alerts` se llena por trigger y por el worker, y no hay dónde verlas | ⬜ |
| M9-08 | Configuración del local — `tenants.settings` existe (IVA, topes de descuento, horas de caja) y no se puede editar | 🔵 |
| M8-04 | Alerta por diferencia de arqueo | ⬜ |
| M8-05 | Configurar destinatario y tipos de alerta | ⬜ |
| M6-10 | Cierre forzado de caja por admin — función lista, sin pantalla | 🔵 |
| M6-11 | Aviso en pantalla de caja abierta demasiado tiempo | 🟡 |

M8-02 y M8-03 quedan 🟡 hasta que exista `RESEND_API_KEY` **y** el worker esté
desplegado ([ADR-008](adr/ADR-008-railway-servicio-unico.md)).

---

## F4 · QA de concurrencia — *la deuda silenciosa*

**Estimación: 4–5 días.**

> ⚠️ **Los siete requerimientos de M10 marcados como hechos no están probados.**
> Son correctos *por diseño*. Los casos CP-01 a CP-08 de
> [16](16-plan-pruebas.md) siguen pendientes. Es el riesgo más grande del
> proyecto en este momento, y el que menos se nota hasta que se nota.

| # | Tarea | Hoy |
|---|---|:--:|
| CP-01…CP-08 | Ejecutar los ocho casos de concurrencia | ⬜ |
| M10-03 | **Bloqueo optimista al editar.** Hoy dos personas editando el mismo producto: el segundo sobrescribe sin aviso | ⬜ |
| M10-05 | Advertir cierre de caja ajena | ⬜ |
| M10-06 | Stock actualizado en otras pantallas (requiere Realtime) | ⬜ |

F4 puede correr en paralelo con F2 y F3: toca la base y las pruebas, no las
mismas pantallas.

---

## F5 · DTE simulado — *modelo, flujo y representación impresa*

**Estimación: 8–12 días.** Ver [18](18-documentos-tributarios-sii.md) y
[ADR-009](adr/ADR-009-dte-simulador-primero.md).

| # | Tarea |
|---|---|
| F5-1 | Migración: `dte_documents`, `dte_folios`, `dte_events`. Inmutabilidad por trigger, como el kardex |
| F5-2 | Datos del emisor: RUT, razón social, giro, dirección, actividad económica |
| F5-3 | Interfaz `EmisorDTE` con dos implementaciones: simulada y real. Misma frontera que la capa de repositorio |
| F5-4 | Emisión simulada: consume folio, genera el XML con la estructura real, firma con certificado de prueba |
| F5-5 | Estados y su máquina: `borrador → emitido → enviado → aceptado / rechazado / anulado` |
| F5-6 | Nota de crédito para anulación. Un DTE no se borra |
| F5-7 | Representación impresa con timbre (PDF417) |
| F5-8 | Marca visible de "documento simulado", en la pantalla y en el papel |
| F5-9 | Pruebas: folio consumido aunque falle el envío, neto+IVA=total sin descuadre de un peso, no hay dos documentos con el mismo folio bajo concurrencia |

**Criterio de término:** se puede emitir, anular y reimprimir un documento
simulado de punta a punta, y el cambio a emisión real es cambiar una
implementación de `EmisorDTE`.

---

## F6 · DTE real — *depende del cliente, no de nosotros*

**Estimación: 5–10 días de desarrollo, más un plazo de certificación que no
controlamos.**

| # | Tarea | Depende de |
|---|---|---|
| F6-1 | Elegir proveedor autorizado (P-27) | Decisión comercial |
| F6-2 | Certificado digital vigente | **Trámite del cliente** |
| F6-3 | Enrolamiento como emisor electrónico | **Trámite del cliente** |
| F6-4 | Carga de CAF y control de folios disponibles | F6-2, F6-3 |
| F6-5 | Implementar `EmisorDTE` real contra la API del proveedor | F6-1 |
| F6-6 | Set de pruebas / certificación | Todas las anteriores |
| F6-7 | Alerta de folios por agotarse | F6-4 |

> **Los trámites F6-2 y F6-3 hay que iniciarlos hoy.** No dependen de ninguna
> fase de desarrollo, y son la ruta crítica real de este módulo. Si se dejan
> para cuando el código esté listo, el módulo espera igual.

---

## Fuera de alcance de este cronograma

Marcados *Could* en el inventario, o sin valor inmediato: M1-10 (segundo
factor), M2-15 (duplicar producto), M3-11 (orden de compra sugerida), M4-13
(stock por ubicación), M7-11 (comparación de períodos), M8-06 (push), M10-11
(último que modificó).

También queda fuera **M2-07 (imagen de producto)**, que requiere configurar
Storage y no es urgente para operar.

---

## Lo que hay que decidir antes de comprometer fechas

Ninguna de estas se resuelve programando ([15](15-preguntas-abiertas.md)):

| # | Pregunta | Bloquea |
|---|---|---|
| P-27 | ¿Proveedor de DTE, cuál? | F6 completa |
| P-28 | ¿El cliente tiene certificado digital y enrolamiento? | F6-2, F6-3 |
| P-29 | ¿Solo boleta, o también factura? | Alcance de F5 y F6 |
| P-30 | ¿Quién paga el costo recurrente del DTE? | Contrato |
| P-31 | ¿Hay productos exentos de IVA? | Modelo de F5 |
| P-13 | ¿Repositorio público o privado? | Rotación de llaves |
| P-26 | ¿El cliente acepta que no se use Vercel? | Cierre de F0 |

---

## Control de cambios

| Fecha | Cambio |
|---|---|
| 2026-09-15 | Versión inicial. Se agrega F5 y F6 tras responderse P-03: el cliente sí requiere documentos tributarios electrónicos |
