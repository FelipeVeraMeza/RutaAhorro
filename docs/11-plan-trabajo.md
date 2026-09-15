# 11 — Plan de trabajo

---

## 1. Enfoque

Desarrollo iterativo en fases, cada una con **entregable demostrable**. El cliente
ve algo funcionando al final de cada fase; no se trabaja tres meses a puerta
cerrada para mostrar todo junto.

**Metodología:** iteraciones de 1 semana, demostración al cierre de cada fase.
**Equipo:** 1 desarrollador (Felipe Vera) a dedicación parcial.
**Capacidad estimada:** ~14 puntos de historia por semana.

---

## 2. Fases

### F0 · Descubrimiento y documentación — *1 semana*
**Estado: en curso.**

| Entregable | Estado |
|---|---|
| Documentación completa en `docs/` | ✅ Este conjunto de documentos |
| Requerimientos funcionales y no funcionales | ✅ |
| Modelo de datos y arquitectura | ✅ |
| Plan de despliegue y de costos | ✅ |
| **Validación del cliente y firma del alcance** | ⏳ **Bloqueante** |
| Respuestas a [15 — Preguntas abiertas](15-preguntas-abiertas.md) | ⏳ **Bloqueante** |

> **Puerta de salida:** no se escribe código de aplicación hasta que el cliente
> valide el alcance y se respondan las preguntas bloqueantes (P-01 a P-08).
> Programar sobre supuestos sin confirmar es la forma más cara de equivocarse.

---

### F1 · Fundaciones — *1,5 semanas*
Lo que no se ve, pero sostiene todo lo demás.

| Entregable | Detalle |
|---|---|
| Repositorio y estructura | Monorepo, TypeScript estricto, ESLint, Prettier |
| Esquema de base de datos | Todas las migraciones de [06](06-modelo-datos.md) |
| Políticas RLS | El 100 % de las tablas, con pruebas automatizadas |
| Autenticación | Login, recuperación de clave, middleware de sesión |
| Gestión de usuarios | CRUD + roles (E1 completa) |
| Diseño base | Tema, componentes, navegación móvil |
| CI/CD | GitHub Actions, despliegue a Vercel y Railway |
| Entornos | Local + preview + producción funcionando |

**Historias:** US-01, US-02, US-03 — 10 pts
**Demostración:** dos usuarios con roles distintos entran desde dos celulares y
ven interfaces diferentes.

---

### F2 · Catálogo e inventario — *2,5 semanas*
El corazón de los datos. Sin esto no hay nada que vender.

| Entregable | Detalle |
|---|---|
| CRUD de productos | Con categorías, códigos múltiples, imágenes |
| Búsqueda | Por nombre, código y SKU, con resultados incrementales |
| Escaneo para alta de producto | Primer uso de la cámara |
| Carga masiva | Plantilla Excel, validación previa, informe de errores |
| Proveedores | CRUD con validación de RUT |
| Recepción de mercadería | Con recálculo de costo promedio |
| Kardex | Movimientos inmutables + `stock_levels` |
| Ajustes y toma de inventario | Con motivo obligatorio |
| Alertas de stock mínimo | En la aplicación |

**Historias:** US-04 a US-13 — 53 pts
**Demostración:** cargar el catálogo real del cliente, recibir mercadería
escaneando y ver el inventario valorizado.

---

### F3 · Punto de venta y caja — *2,5 semanas*
La fase de mayor riesgo técnico y la que define si el sistema se usa o no.

| Entregable | Detalle |
|---|---|
| POS con escaneo continuo | Retroalimentación sonora y háptica |
| Carrito | Cantidades, descuentos, eliminación de líneas |
| Cobro | Medios de pago, vuelto, pago mixto |
| Registro transaccional | `fn_register_sale` atómica |
| **Modo offline** | Service worker, IndexedDB, cola de sincronización |
| **Sincronización idempotente** | Sin duplicados, en orden |
| Anulación de ventas | Con permisos por rol |
| Ciclo de caja | Apertura, movimientos, cierre con arqueo |

**Historias:** US-14 a US-19 — 45 pts
**Demostración:** venta completa en celular real, **con modo avión activado
durante la demostración** y sincronización en vivo al reconectar.

> El modo offline se construye **junto con** el POS, no después. Agregarlo a
> posteriori obliga a reescribir el flujo completo de venta.

---

### F4 · Reportes, alertas y respaldos — *1,5 semanas*

| Entregable | Detalle |
|---|---|
| Dashboard | Ventas del día, transacciones, ticket promedio, stock bajo |
| Reportes | Ventas, inventario valorizado, márgenes, mermas, sin movimiento |
| Exportación | CSV/Excel de todo reporte |
| Worker en Railway | Trabajos programados operativos |
| Correo de resumen diario | Ventas, cajas, stock bajo |
| Respaldo automático | Y **restauración probada** |
| Bitácora de auditoría | Consultable por el administrador |

**Historias:** US-20 a US-26 — 31 pts
**Demostración:** reporte de márgenes real y restauración de un respaldo en vivo.

---

### F5 · Piloto en el local — *1 semana*

| Actividad | Detalle |
|---|---|
| Carga real del inventario | Acompañada. **La actividad más subestimada del proyecto** |
| Configuración del local | Usuarios, roles, parámetros |
| Capacitación | 2 sesiones de 1 h: una para el dueño, otra para el personal |
| Manual de usuario | Breve, con capturas reales, pensado para el celular |
| Operación en paralelo | El local usa el sistema **y** su método actual simultáneamente |
| Ajustes de usabilidad | Con retroalimentación de los usuarios reales |

**Puerta de salida:** el personal opera sin ayuda durante un día completo.

---

### F6 · Marcha blanca y puesta en producción — *1 semana*

| Actividad | Detalle |
|---|---|
| Operación exclusiva en el sistema | 5 días hábiles, 100 % de las ventas |
| Verificación diaria de caja | Los 5 cierres cuadrados o explicados |
| Toma de inventario de control | Desviación < 3 % |
| Corrección de incidencias | Prioridad máxima |
| Acta de aceptación | Firma del cliente |
| **Actualización final de la documentación** | `docs/` reflejando el sistema realmente entregado |

**Puerta de salida:** criterios de aceptación de [01 §8](01-vision-alcance.md)
cumplidos y acta firmada.

---

## 3. Cronograma

| Fase | Duración | Semanas |
|---|:--:|---|
| F0 · Documentación | 1 sem | 1 |
| F1 · Fundaciones | 1,5 sem | 2 – 3 |
| F2 · Catálogo e inventario | 2,5 sem | 3 – 5 |
| F3 · POS y caja | 2,5 sem | 6 – 8 |
| F4 · Reportes y respaldos | 1,5 sem | 9 – 10 |
| F5 · Piloto | 1 sem | 11 |
| F6 · Marcha blanca | 1 sem | 12 |
| **Total** | **11 semanas** | |

```
Sem  1  2  3  4  5  6  7  8  9 10 11 12
F0  ██
F1     ███
F2        ██████
F3              ██████
F4                    ████
F5                         ██
F6                            ██
```

**Holgura:** el plan no incluye colchón. Un atraso en la carga inicial del
inventario (riesgo R-02) o en las pruebas de escaneo en distintos modelos de
celular (R-05) desplaza todo lo que viene después. Asumir **2 semanas de holgura
realista** al comprometer una fecha con el cliente: **13 a 14 semanas.**

---

## 4. Definición de Listo (DoR)

Una historia entra a desarrollo solo si:
- [ ] Tiene criterios de aceptación en Gherkin
- [ ] Sus dependencias están resueltas
- [ ] Las dudas de negocio están respondidas
- [ ] El diseño de pantalla está definido si introduce una vista nueva
- [ ] Está estimada

## 5. Definición de Terminado (DoD)

Una historia está terminada solo si:
- [ ] Cumple **todos** sus criterios de aceptación
- [ ] Tiene pruebas unitarias de su lógica de negocio
- [ ] Tiene prueba E2E si es un flujo crítico
- [ ] Pasa lint y verificación de tipos
- [ ] Tiene políticas RLS si toca datos nuevos
- [ ] **Probada en un celular real**, no solo en el emulador del navegador
- [ ] Funciona sin conexión si es parte del POS
- [ ] Los textos están en español de Chile
- [ ] **La documentación de `docs/` está actualizada** si cambió una regla de negocio, el modelo de datos o un contrato de API
- [ ] Desplegada en preview y revisada

---

## 6. Política de documentación viva

> **Compromiso del proyecto: la documentación no termina con la v1.0.**

La documentación de `docs/` es el estado declarado del sistema. Si el sistema
cambia y el documento no, el documento pasa de ser un activo a ser una trampa:
alguien tomará una decisión basándose en información falsa.

### 6.1 Reglas

| Regla | Detalle |
|---|---|
| **Mismo PR** | Un cambio de comportamiento y la actualización de su documento viajan en el mismo Pull Request. No se acepta "lo documento después" |
| **Sin aprobación sin documentación** | Un PR que cambia una regla de negocio, el esquema de datos o un contrato de API y no toca `docs/` no se aprueba (RNF-39) |
| **Versión en cada release** | Cada versión actualiza el changelog y la tabla de control de cambios de [docs/README.md](README.md) |
| **Revisión semestral** | Lectura completa de `docs/` contrastada con el sistema real; lo que ya no sea cierto se corrige o se marca como obsoleto |
| **Decisiones como ADR** | Toda decisión técnica relevante se registra en `docs/adr/`. Un ADR no se edita: se reemplaza por otro que lo supersede |

### 6.2 Qué se actualiza al cerrar la v1.0

Al firmar el acta de aceptación, estos documentos deben reflejar el sistema
**realmente construido**, no el planificado:

- [ ] [03 — Requerimientos](03-requerimientos-funcionales.md): marcar cada RF como implementado, diferido o descartado
- [ ] [06 — Modelo de datos](06-modelo-datos.md): esquema final, incluidas las tablas que se agregaron durante el desarrollo
- [ ] [07 — Arquitectura](07-arquitectura.md): stack y versiones efectivamente usados
- [ ] [08 — API](08-api-contratos.md): contratos tal como quedaron
- [ ] [09 — Despliegue](09-despliegue.md): URLs, dominios y variables reales de producción
- [ ] [12 — Costos](12-costos-modelo-servicio.md): costo real de infraestructura medido, no estimado
- [ ] [15 — Preguntas abiertas](15-preguntas-abiertas.md): cada pregunta con su respuesta y fecha
- [ ] Nuevo: `docs/16-manual-usuario.md` — manual para el personal del local
- [ ] Nuevo: `docs/17-manual-operacion.md` — runbook de operación del servicio
- [ ] Nuevo: `CHANGELOG.md` — historial de versiones

### 6.3 Documentación posterior a la v1.0

| Documento | Cuándo |
|---|---|
| `CHANGELOG.md` | En cada versión publicada |
| ADR nuevo | En cada decisión técnica relevante |
| Actualización de manuales | Con cada cambio visible para el usuario |
| Informe de incidentes | Dentro de 7 días de cada incidente mayor |
| Revisión completa | Cada 6 meses |

---

## 7. Comunicación con el cliente

| Instancia | Frecuencia | Medio |
|---|---|---|
| Avance semanal | Semanal | WhatsApp, mensaje breve |
| Demostración de fase | Al cierre de cada fase | Videollamada o presencial |
| Consultas | Continua | WhatsApp |
| Cambios de alcance | Cuando ocurran | **Por escrito**, con impacto en plazo y costo |

> Todo cambio de alcance se documenta por escrito antes de implementarse. Los
> "favores rápidos" acumulados son la causa más común de que un proyecto de precio
> fijo termine en pérdida.

---

## 8. Hitos de pago sugeridos 🔶

A acordar con el cliente. Propuesta:

| Hito | Momento | % |
|---|---|:--:|
| Inicio | Firma del alcance (fin de F0) | 20 % |
| Avance | Fin de F2 — catálogo e inventario operativos | 30 % |
| Entrega | Fin de F4 — sistema completo en preview | 30 % |
| Aceptación | Fin de F6 — acta firmada | 20 % |

A partir de ahí comienza la suscripción mensual de $59.990 CLP.

> La propuesta comercial actual **no distingue** entre el desarrollo inicial y la
> suscripción mensual. Ver el análisis en [12 §5](12-costos-modelo-servicio.md) y
> la pregunta P-17.
