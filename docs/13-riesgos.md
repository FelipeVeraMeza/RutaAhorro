# 13 — Registro de riesgos

**Escala:** Probabilidad y Severidad de 1 (baja) a 5 (alta). **Exposición = P × S.**
Un riesgo con exposición **≥ 12** exige plan de mitigación activo desde el día 1.

---

## Mapa de exposición

| Exposición | Riesgos |
|---|---|
| **20 – 25 · Crítico** | R-01, R-02 |
| **12 – 16 · Alto** | R-03, R-04, R-05, R-06 |
| **6 – 10 · Medio** | R-07 a R-12 |
| **1 – 5 · Bajo** | R-13 a R-16 |

---

## Riesgos críticos

### R-01 · El cliente esperaba boleta electrónica y contabilidad tributaria
**P: 4 · S: 5 · Exposición: 20**

La propuesta comercial enviada por WhatsApp menciona *"control contable"*. El
sistema entrega control de caja, márgenes e inventario, **no** emisión de DTE ni
libros tributarios. Si el cliente entendió otra cosa, la brecha se descubre el día
de la puesta en marcha, con el sistema ya construido y pagado.

| | |
|---|---|
| **Mitigación** | Aclarar por escrito **antes de firmar** qué significa exactamente "control contable" en el alcance. Incluir la lista de exclusiones de [01 §5.2](01-vision-alcance.md) en el documento que firma el cliente |
| **Plan de contingencia** | Cotizar la integración DTE como proyecto adicional vía proveedor certificado |
| **Indicador de alerta** | El cliente pregunta por boletas, folios, F29 o el SII en cualquier conversación |
| **Responsable** | Felipe · **antes de F1** |

---

### R-02 · La carga inicial del inventario no se completa
**P: 5 · S: 4 · Exposición: 20**

Es el riesgo más subestimado de todo proyecto de inventario. Alguien tiene que
contar físicamente cada producto, definir su precio, su costo y su código. Para
1.000 SKU son entre 40 y 80 horas de trabajo humano que **no puede hacer el
software**. Si no se completa, el sistema arranca con datos falsos y el personal
deja de creerle en la primera semana.

| | |
|---|---|
| **Mitigación** | Definir por escrito quién carga, con qué plazo y con qué plantilla. Entregar plantilla Excel validada. Permitir carga **por etapas**: empezar por las categorías de mayor rotación y crecer desde ahí |
| **Plan de contingencia** | Arrancar con un subconjunto (top 200 productos) y completar durante la marcha blanca. Cotizar la carga como servicio adicional si el cliente no puede hacerla |
| **Indicador de alerta** | Al final de la semana 1 de F5 hay menos del 50 % del catálogo cargado |
| **Responsable** | Cliente, con apoyo de Felipe · **desde F2** |

---

## Riesgos altos

### R-03 · El personal no adopta el sistema
**P: 4 · S: 4 · Exposición: 16**

Si el POS es más lento que cobrar de memoria, el personal lo evitará. Volverán al
cuaderno y el inventario dejará de reflejar la realidad en días.

| | |
|---|---|
| **Mitigación** | Involucrar al personal desde el diseño; que la venta tome menos de 10 s (OP-1); operación con una mano (RNF-17); capacitación con sus propios celulares |
| **Contingencia** | Sesión de ajuste de usabilidad con los usuarios reales durante F5 |
| **Alerta** | Durante la marcha blanca aparecen ventas registradas "en bloque" al final del turno |

### R-04 · El modo offline resulta más complejo de lo estimado
**P: 3 · S: 5 · Exposición: 15**

La sincronización sin duplicados, en orden y con conflictos de stock es el
problema técnico más difícil del proyecto.

| | |
|---|---|
| **Mitigación** | Construirlo **junto con** el POS en F3, no después. Idempotencia por `client_uuid` desde el primer día. Decisión tomada de antemano: se permite stock negativo y se alerta, en vez de bloquear la venta |
| **Contingencia** | Si se atrasa, liberar la v1.0 con modo offline solo de lectura (catálogo consultable, venta requiere conexión) y completar en la v1.1 |
| **Alerta** | Al final de la semana 7 la prueba de modo avión aún produce duplicados |

### R-05 · El escaneo no funciona bien en los celulares reales del local
**P: 3 · S: 4 · Exposición: 12**

Safari en iOS no soporta `BarcodeDetector`; cámaras antiguas enfocan mal; la luz
del local puede ser pobre; hay códigos rayados o arrugados.

| | |
|---|---|
| **Mitigación** | Respaldo con ZXing desde el inicio; probar temprano en los celulares **reales** del personal; búsqueda manual siempre visible |
| **Contingencia** | Sugerir un lector Bluetooth económico (~$25.000), que se comporta como teclado y no requiere desarrollo |
| **Alerta** | Menos del 90 % de lecturas exitosas en la prueba con 50 productos reales |

### R-06 · La rentabilidad no alcanza para sostener el servicio
**P: 4 · S: 3 · Exposición: 12**

Con un solo cliente, el ingreso neto no cubre la dedicación mensual estimada.
Ver [12 §3](12-costos-modelo-servicio.md).

| | |
|---|---|
| **Mitigación** | Operar en planes gratuitos mientras haya 1 o 2 clientes; arquitectura multi-tenant para amortizar; cobrar la implementación por separado |
| **Contingencia** | Ajustar el precio en la renovación anual o acotar el alcance del soporte |
| **Alerta** | Más de 20 horas mensuales de soporte pasados los primeros 3 meses |

---

## Riesgos medios

### R-07 · Crecimiento del alcance sin ajuste de precio ni plazo
**P: 4 · S: 2 · Exposición: 8**
Peticiones pequeñas que se acumulan ("¿y podrías agregar…?").
**Mitigación:** todo cambio de alcance se registra por escrito con su impacto en plazo y costo, antes de implementarse.

### R-08 · Conectividad deficiente en el local
**P: 3 · S: 3 · Exposición: 9**
**Mitigación:** el modo offline ya lo contempla. Verificar la calidad de la señal **en terreno** durante F0.

### R-09 · Un solo desarrollador — factor bus
**P: 2 · S: 5 · Exposición: 10**
Si Felipe no está disponible, el proyecto se detiene y el cliente queda sin soporte.
**Mitigación:** esta documentación es precisamente la mitigación. Además: código en GitHub, infraestructura reproducible desde el repositorio, credenciales en un gestor de contraseñas con acceso de emergencia definido.

### R-10 · Dependencia de proveedores externos
**P: 2 · S: 4 · Exposición: 8**
Cambio de precios, de términos o cierre de Supabase o Railway.
**Mitigación:** PostgreSQL estándar sin funcionalidades propietarias irremplazables; respaldos propios; Next.js puede desplegarse en cualquier proveedor con Node; el worker es un contenedor Node corriente.

### R-11 · Pérdida o exposición de credenciales
**P: 2 · S: 5 · Exposición: 10**
**Mitigación:** ver [10 §2](10-seguridad-cumplimiento.md). Controles aplicados: `.gitignore`, repositorio privado, verificación del bundle en CI, `service_role` solo en Railway.

### R-12 · El catálogo crece más allá de lo previsto
**P: 2 · S: 3 · Exposición: 6**
Con más de 5.000 SKU, la réplica completa en IndexedDB y la búsqueda local se degradan.
**Mitigación:** medir en F2 con el catálogo real; si es necesario, replicar solo los productos activos con movimiento en los últimos 90 días.

---

## Riesgos bajos

| # | Riesgo | P | S | Exp. | Mitigación |
|---|---|:-:|:-:|:-:|---|
| R-13 | Alza del dólar encarece la infraestructura | 3 | 1 | 3 | Reajuste anual por IPC; revisión semestral de costos |
| R-14 | Cambio normativo (Ley 21.719) exige ajustes | 2 | 2 | 4 | Revisión legal antes de producción; datos personales minimizados por diseño |
| R-15 | El cliente abre una segunda sucursal | 2 | 2 | 4 | El modelo de datos ya contempla `store_id` |
| R-16 | Pérdida de datos por error del usuario | 2 | 2 | 4 | Nada se borra: solo se desactiva o anula. Respaldo diario |

---

## Seguimiento

| Actividad | Frecuencia |
|---|---|
| Revisión del registro de riesgos | Al cierre de cada fase |
| Actualización de probabilidad y severidad | Mensual |
| Escalamiento al cliente | Cuando un riesgo crítico se materializa o su exposición sube |

**Riesgos que deben cerrarse antes de iniciar F1:** R-01 (aclaración de alcance
contable) y R-02 (acuerdo escrito sobre la carga inicial del inventario).
