# 12 — Costos de infraestructura y modelo de servicio

> **Supuesto de tipo de cambio:** 1 USD ≈ **950 CLP**. Todos los valores en CLP
> son referenciales y se mueven con el dólar. **Los precios de los proveedores
> deben verificarse antes de comprometer el precio al cliente**: cambian sin aviso.

---

## 1. El número que importa

| Concepto | Monto |
|---|---:|
| Precio del Plan Completo (IVA incluido) | **$59.990** |
| IVA (19 %) | −$9.578 |
| **Ingreso neto mensual por cliente** | **$50.412** |

Todo lo que sigue se mide contra esos **$50.412**.

---

## 2. Costo de infraestructura

### 2.1 Escenario A — Planes pagados (lo "correcto por manual")

| Servicio | Plan | USD/mes | CLP/mes |
|---|---|---:|---:|
| Vercel | Pro | 20 | 19.000 |
| Supabase | Pro | 25 | 23.750 |
| Railway | Hobby | 5 | 4.750 |
| Resend | Free (3.000 correos/mes) | 0 | 0 |
| Sentry | Developer | 0 | 0 |
| Dominio `.cl` | ~$10.000/año | — | 833 |
| **Total** | | **50** | **≈ $48.333** |

| | |
|---|---:|
| Ingreso neto | $50.412 |
| Costo de infraestructura | −$48.333 |
| **Margen bruto** | **$2.079 (4 %)** |

> **Con un solo cliente en planes pagados, el negocio no existe.** $2.079 al mes
> no paga una hora de soporte, ni el tiempo de desarrollo, ni un solo incidente.

### 2.2 Escenario B — Planes gratuitos / mínimos (viable con 1 cliente)

| Servicio | Plan | USD/mes | CLP/mes |
|---|---|---:|---:|
| Vercel | Hobby ⚠️ | 0 | 0 |
| Supabase | Free ⚠️ | 0 | 0 |
| Railway | Hobby | 5 | 4.750 |
| Resend | Free | 0 | 0 |
| Sentry | Developer | 0 | 0 |
| Dominio | — | — | 833 |
| **Total** | | **5** | **≈ $5.583** |

| | |
|---|---:|
| Ingreso neto | $50.412 |
| Costo de infraestructura | −$5.583 |
| **Margen bruto** | **$44.829 (89 %)** |

**⚠️ Las dos advertencias del escenario B:**

| Limitación | Consecuencia real | Cómo se compensa |
|---|---|---|
| **Vercel Hobby prohíbe el uso comercial** en sus términos de servicio | Riesgo de suspensión del despliegue sin aviso | Verificar los términos vigentes. Alternativa: desplegar también el frontend en Railway (~$5 USD adicionales) y prescindir de Vercel |
| **Supabase Free no incluye respaldos automáticos** ni PITR, y pausa proyectos tras ~1 semana de inactividad | RF-M9-01 quedaría incumplido | **Esto ya está resuelto por diseño**: el worker de Railway ejecuta `pg_dump` diario a Storage (ver [08 §5](08-api-contratos.md)). La pausa por inactividad no aplica a un local que vende todos los días |
| Supabase Free: 500 MB de base y 1 GB de Storage | Suficiente para ~100.000 ventas y ~2.000 imágenes de producto | Monitorear consumo; migrar a Pro cuando se acerque al 80 % |

> El respaldo propio en el worker no fue una decisión de ahorro: es lo que hace
> que el compromiso de respaldo diario con el cliente sea independiente del plan
> contratado con el proveedor. El ahorro es una consecuencia bienvenida.

### 2.3 Escenario C — Multi-tenant con varios clientes

Aquí es donde el modelo de negocio funciona. **Una sola infraestructura atiende a
todos los clientes**, porque el aislamiento es por `tenant_id` + RLS, no por
instancia separada.

| Clientes | Ingreso neto | Infraestructura | Margen | Margen % |
|---:|---:|---|---:|---:|
| 1 | $50.412 | Escenario B — $5.583 | $44.829 | 89 % |
| 3 | $151.236 | Escenario A — $48.333 | $102.903 | 68 % |
| 5 | $252.060 | Escenario A — $48.333 | $203.727 | 81 % |
| 10 | $504.120 | Pro + consumo — ~$75.000 | $429.120 | 85 % |

> **Ésta es la justificación económica de [ADR-004](adr/ADR-004-multi-tenant.md).**
> Diseñar multi-tenant no agrega trabajo perceptible hoy (una columna y una
> política RLS), y es la diferencia entre un servicio que escala con margen del
> 85 % y uno que no escala en absoluto. Si cada cliente exigiera su propia
> infraestructura, el costo crecería linealmente con los ingresos y el negocio
> nunca despegaría.

**Recomendación:** operar en escenario B mientras haya 1 o 2 clientes, y migrar a
planes pagados al tercero. La migración de Free a Pro en Supabase y Vercel se
hace en minutos y sin tiempo fuera de servicio.

---

## 3. Costos que no son infraestructura

Lo que realmente consume el margen:

| Concepto | Estimación mensual | Notas |
|---|---:|---|
| Soporte y atención | 4 – 8 h | Alto los primeros meses, decreciente |
| Mantención correctiva | 2 – 4 h | Corrección de errores |
| Actualizaciones y mejoras | 4 h | Comprometidas en el plan |
| Monitoreo y operación | 1 h | Revisión de respaldos y alertas |
| **Total** | **11 – 17 h/mes** | |

Con un valor hora referencial de $15.000, eso equivale a **$165.000 – $255.000**
mensuales de dedicación.

> **Conclusión honesta:** con **un solo cliente**, los $50.412 netos no cubren la
> dedicación mensual estimada. El plan de $59.990 solo se vuelve rentable a
> partir del **tercer o cuarto cliente**, cuando la infraestructura y el esfuerzo
> de mantención se reparten entre varios. Esto no es un problema del precio: es
> la economía normal de un SaaS en sus primeros meses. Pero conviene saberlo
> antes, no después.

---

## 4. Proyección de consumo (un local)

Supuestos: 100 ventas/día, 3 productos por venta, 1.000 SKU.

| Recurso | Consumo mensual | Límite Free | Uso |
|---|---|---|---|
| Base de datos | ~15 MB/año | 500 MB | 3 % anual |
| Peticiones a la API | ~180.000 | Ilimitado | — |
| Ancho de banda | ~2 GB | 5 GB (Vercel Hobby) | 40 % |
| Storage de imágenes | ~200 MB (1.000 productos) | 1 GB | 20 % |
| Correos | ~35 | 3.000 | 1 % |
| Horas del worker | 730 | ~550 con $5 de crédito | ⚠️ Ajustado |

> **Punto de atención:** el worker de Railway corriendo 24/7 puede superar el
> crédito de $5. Dado que solo ejecuta trabajos programados, conviene evaluar
> ejecución por cron en lugar de proceso permanente, o aceptar un costo de
> ~$8 – 10 USD mensuales. Se resuelve al desplegar F4 con datos de consumo reales.

---

## 5. Modelo de servicio

### 5.1 Qué incluye el Plan Completo ($59.990 CLP/mes, IVA incluido)

✅ Uso ilimitado del sistema para el local
✅ Usuarios ilimitados
✅ Toda la infraestructura (servidor, base de datos, almacenamiento, dominio)
✅ Respaldo diario con retención de 30 días
✅ Actualizaciones y nuevas funcionalidades del producto
✅ Soporte en horario hábil
✅ Corrección de errores sin costo

### 5.2 Qué NO incluye 🔶

❌ Desarrollo de funcionalidades a medida solicitadas por el cliente
❌ Carga inicial del inventario (es responsabilidad del cliente, con apoyo y plantilla)
❌ Capacitación adicional más allá de las 2 sesiones iniciales
❌ Soporte fuera de horario hábil
❌ Integración con SII, Transbank u otros sistemas de terceros
❌ Hardware de cualquier tipo
❌ Recuperación de datos por error del usuario más allá del respaldo diario

### 5.3 Niveles de servicio (SLA) 🔶

| Compromiso | Valor |
|---|---|
| Disponibilidad mensual | 99,0 % en horario comercial |
| **Continuidad de venta** | **100 % — el POS opera offline aunque el servicio central esté caído** |
| Respuesta a incidente crítico (no se puede vender) | 2 h hábiles |
| Respuesta a incidente mayor (una función no opera) | 8 h hábiles |
| Respuesta a consulta o mejora | 48 h hábiles |
| Horario de soporte | Lunes a viernes, 09:00 – 19:00 |
| Respaldo | Diario, retención 30 días |

> El compromiso más valioso para el cliente es el segundo: **su local no deja de
> vender aunque falle todo lo demás.** Ningún competidor a este precio ofrece eso,
> y es la consecuencia directa de haber construido el modo offline desde el inicio.

### 5.4 Condiciones comerciales 🔶

| Tema | Propuesta |
|---|---|
| Facturación | Mensual, por adelantado |
| Medio de pago | Transferencia bancaria |
| Reajuste | Anual, según IPC |
| Permanencia mínima | Sin permanencia |
| Aviso de término | 30 días |
| Al término | Exportación completa de datos en CSV, sin costo |
| Suspensión por no pago | Tras 30 días, previo aviso. **Los datos se conservan 90 días** |

---

## 6. Recomendaciones comerciales

1. **Cobrar la implementación por separado.** El precio actual no distingue entre
   construir el sistema y operarlo. La carga inicial y la puesta en marcha son
   entre 40 y 80 horas que hoy no están pagadas por nadie. Sugerencia: un valor
   de implementación único, y luego la mensualidad.
2. **No bajar de $59.990.** El precio ya es ajustado. Descontarlo vuelve el
   servicio inviable apenas aparezca el primer mes con soporte intensivo.
3. **Buscar el tercer cliente antes de pasar a planes pagados.** El punto de
   equilibrio real está entre el tercer y el cuarto cliente.
4. **Aclarar por escrito el alcance de "control contable"** antes de firmar. Es
   la única ambigüedad del acuerdo que puede costar el proyecto entero. Ver
   [10 §6.3](10-seguridad-cumplimiento.md).
5. **Definir el valor hora de trabajo fuera de alcance** ahora, no cuando llegue
   la primera solicitud. Sin esa tarifa acordada, toda petición extra se
   convierte en trabajo gratis.
6. **Revisar los precios de los proveedores cada seis meses.** Un alza del dólar
   o un cambio de plan de Supabase golpea directamente el margen.
