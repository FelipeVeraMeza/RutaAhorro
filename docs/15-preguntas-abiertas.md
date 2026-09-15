# 15 — Preguntas abiertas

Estado: 🔴 **bloqueante** (detiene el inicio del desarrollo) · 🟡 importante
(condiciona el diseño) · 🟢 se puede decidir después.

**Cómo usar este documento:** llevarlo a la reunión con el cliente, completar la
columna de respuesta y la fecha. Ninguna pregunta 🔴 puede quedar sin responder
antes de iniciar F1.

---

## A · Alcance del negocio

### 🔴 P-01 · ¿Qué vende exactamente el local?
Rubro, tipo de producto, tamaño del catálogo aproximado.
**Por qué importa:** define si hay venta por peso, productos perecibles (con
fecha de vencimiento) o productos sin código de barras.
**Impacto si cambia:** RF-M2-14, FA-7, y el diseño completo de la unidad de medida.

> **Respuesta:** _______________________ · Fecha: ______

### 🔴 P-02 · ¿Cuántos productos distintos (SKU) maneja?
**Por qué importa:** determina el esfuerzo de carga inicial (R-02) y la
viabilidad de replicar el catálogo completo en el celular para la búsqueda offline.
**Umbrales:** < 1.000 sin problema · 1.000–3.000 requiere medición · > 5.000
obliga a cambiar la estrategia offline.

> **Respuesta:** _______________________ · Fecha: ______

### 🔴 P-03 · ¿Qué espera el cliente cuando la propuesta dice "control contable"?
**Por qué importa:** **es el riesgo más grave del proyecto (R-01).**
Hay que preguntarlo de forma directa: *¿necesita emitir boletas desde este
sistema, o solo llevar el control de su caja y sus márgenes?*
**Impacto si es lo primero:** proyecto adicional de integración DTE, con
certificado digital, folios y homologación.

> **Planteado explícitamente el 2026-09-15:** se mencionó la necesidad de
> **facturas y boletas**. Queda registrado, pero **sin responder**: no se aclaró
> si el sistema debe *emitirlas* ante el SII o solo *registrarlas* para control
> interno. Son dos proyectos de tamaño muy distinto y la respuesta define cuál.

**Hay que separar tres cosas que no son lo mismo:**

| | Qué implica | Estado hoy |
|---|---|---|
| **Registrar** la venta para control interno | Ya funciona: folio correlativo, `tax_amount`, arqueo | ✅ Hecho |
| **Emitir boleta** electrónica al SII | Certificado digital, folios CAF, homologación (FA-1) | ⬜ Fuera de alcance |
| **Emitir factura** electrónica | Todo lo de la boleta **más** identificar al comprador: RUT, razón social, giro y dirección | ⬜ Fuera de alcance **y sin modelo de datos** |

⚠️ **La factura tiene un impacto extra que la boleta no tiene:** hoy **no existe
tabla de clientes** en el esquema (`0001_schema.sql`) y los clientes registrados
están fuera de alcance por FA-8. Una factura obliga a identificar al comprador,
así que además del DTE hay que modelar cliente, asociarlo a la venta y validar su
RUT. La boleta no necesita nada de eso.

**Esto contradice el supuesto S-7** de [01 §Supuestos](01-vision-alcance.md), que
declara que el cliente *no* requiere emitir boleta electrónica desde el sistema.
Si la respuesta confirma que sí la requiere, **S-7 cae** y hay que reabrir FA-1 y
replanificar.

> **Respuesta:** _______________________ · Fecha: ______

### 🔴 P-04 · ¿Cuántas personas trabajan en el local y qué hace cada una?
**Por qué importa:** valida los cuatro roles definidos en [02](02-stakeholders-roles.md).
Si son dos personas que hacen de todo, la matriz de permisos puede simplificarse.

> **Respuesta:** _______________________ · Fecha: ______

### 🔴 P-05 · ¿Es un solo local, o hay o habrá más?
**Por qué importa:** S-1. Multi-sucursal con traspasos agrega ~2 semanas.

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-06 · ¿Vende algo por peso o a granel?
**Por qué importa:** cambia la unidad de medida a decimal y puede requerir
integración con balanza (FA-7).

> **Respuesta:** _______________________ · Fecha: ______

### ✅ P-07 · ¿Maneja productos con fecha de vencimiento? — **RESPONDIDA**
**Por qué importaba:** requiere control por lote y alertas de vencimiento, y
cambia el modelo de datos.

> **Respuesta: SÍ.** El local maneja productos perecibles. · Fecha: 2026-09-14
>
> **Consecuencia (alcance ampliado):** se incorporó control por lote con fecha de
> vencimiento, consumo **FEFO** automático en la venta, alertas de caducidad y
> baja de lote vencido como merma. Ver [ADR-007](adr/ADR-007-lotes-vencimiento.md),
> RF-M4-14 a RF-M4-19 y `supabase/migrations/0006_lotes_vencimiento.sql`.
> FA-7 deja de estar fuera de alcance en lo relativo a vencimientos.

---

## B · Operación actual

### 🔴 P-08 · ¿Cómo lleva hoy el inventario y las ventas?
Cuaderno, Excel, otro sistema, nada.
**Por qué importa:** si hay un Excel, se puede migrar y ahorrar buena parte de la
carga inicial (R-02). Es la pregunta con mayor impacto en el plazo.

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-09 · ¿Cómo es la conectividad del local?
WiFi, datos móviles, calidad de la señal, frecuencia de cortes.
**Por qué importa:** determina si el modo offline es una red de seguridad o el
modo principal de operación (S-4, R-08). **Conviene medirlo en terreno.**

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-10 · ¿Qué celulares tiene el personal?
Marca, modelo y sistema operativo aproximado.
**Por qué importa:** Safari iOS no soporta `BarcodeDetector` y necesita la
librería de respaldo (R-05). Hay que probar en los equipos reales.

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-11 · ¿Qué medios de pago acepta?
Efectivo, débito, crédito, transferencia, otros.
**Por qué importa:** define las opciones del POS y el cálculo del arqueo (RF-M5-09).

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-12 · ¿Cuántas ventas hace al día, aproximadamente? ¿Y en el día peak?
**Por qué importa:** dimensiona la infraestructura y valida las proyecciones de
consumo de [12 §4](12-costos-modelo-servicio.md).

> **Respuesta:** _______________________ · Fecha: ______

---

## C · Técnicas y de proyecto

### 🔴 P-13 · ¿El repositorio de GitHub será público o privado?
**Por qué importa:** es el control de seguridad que sostiene la decisión de no
rotar las llaves ([10 §2](10-seguridad-cumplimiento.md)). **Si va a ser público,
las llaves secretas deben rotarse antes.**
**Recomendación:** privado hasta el cierre de la v1.0.

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-14 · ¿Se crea un proyecto Supabase separado para desarrollo?
**Por qué importa:** probar la carga masiva o un ajuste de stock contra la base
del cliente puede corromper datos reales.
**Recomendación: sí.** Cuesta $0 y evita el peor tipo de error.

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-15 · ¿Se mantiene la región `ca-central-1` (Canadá)?
**Por qué importa:** implicancias de transferencia internacional de datos
([10 §6.2](10-seguridad-cumplimiento.md)) y latencia desde Chile.
**Recomendación:** decidirlo **ahora**. Migrar un proyecto Supabase con datos de
producción es mucho más costoso que elegir bien la región antes de empezar. Si
hay dudas legales, `sa-east-1` (São Paulo) reduce latencia y simplifica el
cumplimiento.

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-16 · ¿Habrá revisión legal del contrato de servicio?
**Por qué importa:** tratamiento de datos personales, SLA, responsabilidad ante
pérdida de datos, condiciones de término. Con la Ley 21.719 acercándose, no es un
trámite menor.

> **Respuesta:** _______________________ · Fecha: ______

### 🟡 P-17 · ¿Se cobra la implementación aparte de la mensualidad?
**Por qué importa:** la propuesta actual no lo distingue. La puesta en marcha son
entre 40 y 80 horas que hoy nadie está pagando ([12 §6](12-costos-modelo-servicio.md)).

> **Respuesta:** _______________________ · Fecha: ______

### 🟢 P-18 · ¿Habrá dominio propio o se usa el de Vercel?
Un dominio `.cl` cuesta ~$10.000 al año y transmite más seriedad que
`rutaahorro.vercel.app`.

> **Respuesta:** _______________________ · Fecha: ______

### 🟢 P-19 · ¿Qué proveedor de correo se usa para las alertas?
**Recomendación:** Resend — 3.000 correos mensuales gratis, suficiente de sobra.
Requiere verificar el dominio del remitente.

> **Respuesta:** _______________________ · Fecha: ______

### 🟢 P-20 · ¿El contador del cliente necesita acceso al sistema?
**Por qué importa:** si sí, se agrega un quinto rol de solo lectura sobre
reportes. Si no, basta con la exportación a Excel.

> **Respuesta:** _______________________ · Fecha: ______

---

## D · Diseño y experiencia

### 🟡 P-21 · ¿Hay identidad visual del local (logo, colores)?
**Por qué importa:** define el tema de la aplicación y los comprobantes.

> **Respuesta:** _______________________ · Fecha: ______

### 🟢 P-22 · ¿Se necesita comprobante impreso o basta con la pantalla?
**Por qué importa:** la impresión térmica está fuera del alcance (FA-4). Si el
cliente lo necesita, hay que cotizarlo aparte.

> **Respuesta:** _______________________ · Fecha: ______

### 🟢 P-23 · ¿Qué descuento máximo puede aplicar un vendedor sin autorización?
**Por qué importa:** parametriza `profiles.max_discount_pct` (RF-M5-08).
**Sugerencia por defecto:** 0 % para `vendedor`, 10 % para `supervisor`.

> **Respuesta:** _______________________ · Fecha: ______

---

### 🟡 P-24 · ¿Qué debe pasar si dos empleados editan el mismo producto a la vez?
**Por qué importa:** RF-M10-03. Hoy el segundo en guardar sobrescribe al primero
sin avisar. Las opciones son: (a) avisar y mostrar el valor actual antes de
sobrescribir — recomendado; (b) bloquear el registro mientras alguien lo edita;
(c) dejarlo como está y asumir el riesgo.
**Recomendación:** (a). Es la única que no pierde trabajo de nadie ni bloquea a
nadie.

> **Respuesta:** _______________________ · Fecha: ______

### 🟢 P-25 · ¿Cuántos empleados operarán en simultáneo en el peak?
**Por qué importa:** dimensiona RNF-50 y la prueba de carga concurrente. Con 2
cajeros el riesgo es bajo; con 6 hay que medirlo en serio antes de producción.

> **Respuesta:** _______________________ · Fecha: ______

### 🔴 P-26 · ¿Se necesitan tasas de impuesto distintas según el producto?
*Planteado el 2026-09-15 junto con P-03.*

**El caso concreto son los bebestibles.** En Chile las bebidas pagan **ILA
(Impuesto Adicional a las Bebidas Analcohólicas) además del IVA**, y no es una
sola tasa:

| Producto | ILA |
|---|:--:|
| Bebida analcohólica azucarada (≥ 15 g/240 ml) | 18 % |
| Bebida analcohólica sin azúcar o baja en azúcar | 10 % |
| Cerveza y vino | 20,5 % |
| Licores y destilados | 31,5 % |

**Qué asume el sistema hoy:** una tasa única para todo el local.
`tenants.settings.iva_pct = 19`, y `fn_register_sale` calcula el impuesto hacia
atrás sobre el total de la venta:
`tax_amount = total − (total / 1,19)` (`0002_functions.sql:249`).
Con tasas mixtas en un mismo carrito **ese cálculo da mal**, y el margen de las
bebidas sale inflado porque no descuenta el ILA.

**Por qué importa que se decida pronto:** `sale_items` congela `product_name`,
`unit_price` y `unit_cost` justamente para poder reconstruir la historia. El
impuesto **no está congelado**. Si se calcula el neto al momento del reporte
leyendo la configuración *actual* del producto, el día que cambie una tasa por ley
—o que alguien reclasifique un producto— **todas las ventas históricas cambian de
neto solas**, que es exactamente lo que el [ADR-006](adr/ADR-006-kardex-inmutable.md)
busca evitar. Una vez que existan ventas reales sin la tasa congelada, **ese dato
no se recupera.** Por eso está marcada 🔴: no bloquea el desarrollo, pero **debe
decidirse antes de la primera venta real.**

**Diseño propuesto si la respuesta es sí:**
1. Tabla `tax_rates (id, tenant_id, nombre, ila_pct, is_active)` y
   `products.tax_rate_id` → `tax_rates(id)`, con `null` = solo IVA.
   Un booleano "es bebestible" **no sirve**: no puede expresar cuatro tasas.
2. **No colgarlo de `categories`.** La categoría es un concepto comercial que el
   usuario renombra y reorganiza cuando quiere; el impuesto es legal. Si alguien
   reordena categorías se rompe el cálculo tributario.
3. Congelar la tasa aplicada en `sale_items`, como las demás copias congeladas.
4. `fn_register_sale` debe sumar el impuesto **línea por línea**, no sobre el
   total.

⚠️ **La mecánica exacta del cálculo debe confirmarla un contador** antes de
implementar. El entendimiento de trabajo es que el ILA se aplica sobre la misma
base neta que el IVA (total = neto × (1 + 0,19 + ILA)), **pero no está
validado profesionalmente.** Equivocarse acá produce cifras incorrectas en algo
que el cliente va a leer como "control contable" (R-01).

> **Respuesta:** _______________________ · Fecha: ______

---

## Resumen

| Prioridad | Cantidad | Preguntas |
|---|:--:|---|
| 🔴 Bloqueantes | 8 | P-01, P-02, P-03, P-04, P-05, P-08, P-13, **P-26** |
| 🟡 Importantes | 11 | P-06, P-09, P-10, P-11, P-12, P-14, P-15, P-16, P-17, P-21, P-24 |
| 🟢 Diferibles | 6 | P-18, P-19, P-20, P-22, P-23, P-25 |
| ✅ Respondidas | 1 | P-07 (productos perecibles: sí) |

> **Las tres que hay que hacer primero, en este orden:**
> **P-03** (¿qué entiende por control contable?) — puede cambiar el proyecto entero.
> **P-08** (¿cómo lleva el inventario hoy?) — define el plazo real.
> **P-02** (¿cuántos productos?) — define el esfuerzo de puesta en marcha.
>
> **P-26** (tasas por producto) no cambia el plazo, pero tiene **fecha de
> vencimiento distinta a las demás**: hay que decidirla **antes de la primera
> venta real**, porque después el dato histórico ya no se puede reconstruir.
