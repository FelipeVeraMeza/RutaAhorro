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

### 🟢 P-18 · ¿Habrá dominio propio o se usa el que entrega Railway?
Un dominio `.cl` cuesta ~$10.000 al año y transmite más seriedad que
`rutaahorro.up.railway.app`.

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

### 🟡 P-26 · ¿El cliente acepta que el sistema no se despliegue en Vercel?
**Por qué importa:** [ADR-003](adr/ADR-003-vercel-railway.md) deja constancia de
que el cliente pidió explícitamente Vercel + Railway. [ADR-008](adr/ADR-008-railway-servicio-unico.md)
se aparta de ese pedido y despliega todo en un solo servicio de Railway.
**Argumentos para la conversación:** el plan Hobby de Vercel prohíbe el uso
comercial y el Pro son ~19.000 CLP/mes ([12 §4](12-costos-modelo-servicio.md));
la razón técnica original (que un `pg_dump` no cabe en serverless) ya no aplica
porque el respaldo hace export lógico.
**Qué se pierde y hay que decirlo:** las vistas previa por Pull Request y la
entrega al borde.

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

---

## Resumen

| Prioridad | Cantidad | Preguntas |
|---|:--:|---|
| 🔴 Bloqueantes | 7 | P-01, P-02, P-03, P-04, P-05, P-08, P-13 |
| 🟡 Importantes | 12 | P-06, P-09, P-10, P-11, P-12, P-14, P-15, P-16, P-17, P-21, P-24, P-26 |
| 🟢 Diferibles | 6 | P-18, P-19, P-20, P-22, P-23, P-25 |
| ✅ Respondidas | 1 | P-07 (productos perecibles: sí) |

> **Las tres que hay que hacer primero, en este orden:**
> **P-03** (¿qué entiende por control contable?) — puede cambiar el proyecto entero.
> **P-08** (¿cómo lleva el inventario hoy?) — define el plazo real.
> **P-02** (¿cuántos productos?) — define el esfuerzo de puesta en marcha.
