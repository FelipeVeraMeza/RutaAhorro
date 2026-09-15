# Documentación — RutaAhorro

Versión del documento maestro: **1.0 (borrador)**
Fecha: **2026-09-14**
Autor: **Felipe Vera Meza**
Estado: **Fase 0 — Levantamiento. Pendiente de validación con el cliente.**

---

## Cómo leer esta documentación

La documentación está ordenada de "negocio" a "técnico". Si eres el **cliente**,
lee los documentos 01, 02, 03, 11, 12 y 15: ahí está todo lo que necesitas para
saber qué recibirás, cuándo y bajo qué condiciones. Si eres **desarrollador**,
todo lo demás es tu contrato de implementación.

### Bloque 1 — Negocio y alcance
| Doc | Contenido |
|---|---|
| [01 — Visión y alcance](01-vision-alcance.md) | Problema, objetivos, qué entra y qué NO en la v1.0, supuestos |
| [02 — Stakeholders y roles](02-stakeholders-roles.md) | Perfiles de usuario y matriz de permisos |

### Bloque 2 — Requerimientos
| Doc | Contenido |
|---|---|
| [03 — Requerimientos funcionales](03-requerimientos-funcionales.md) | 9 módulos, RF numerados, prioridad MoSCoW |
| [04 — Requerimientos no funcionales](04-requerimientos-no-funcionales.md) | Rendimiento, seguridad, disponibilidad, usabilidad |
| [05 — Historias de usuario](05-historias-usuario.md) | Backlog con criterios de aceptación en Gherkin |

### Bloque 3 — Diseño técnico
| Doc | Contenido |
|---|---|
| [06 — Modelo de datos](06-modelo-datos.md) | ERD, diccionario de tablas, kardex, lotes/vencimiento, políticas RLS |
| [07 — Arquitectura técnica](07-arquitectura.md) | Componentes, flujos, PWA/offline, escaneo |
| [08 — Contratos de API](08-api-contratos.md) | RPC transaccionales, endpoints del worker, errores |
| [ADRs](adr/) | Decisiones de arquitectura con su justificación |

### Bloque 4 — Operación
| Doc | Contenido |
|---|---|
| [09 — Plan de despliegue](09-despliegue.md) | Localhost, Vercel, Railway, Supabase, CI/CD, runbook |
| [10 — Seguridad y cumplimiento](10-seguridad-cumplimiento.md) | Secretos, RLS, auditoría, Ley 21.719, SII |

### Bloque 5 — Gestión del proyecto
| Doc | Contenido |
|---|---|
| [11 — Plan de trabajo](11-plan-trabajo.md) | Fases, cronograma, entregables, DoR/DoD |
| [12 — Costos y modelo de servicio](12-costos-modelo-servicio.md) | Infraestructura vs. precio, SLA, soporte |
| [13 — Riesgos](13-riesgos.md) | Registro de riesgos, probabilidad, impacto, mitigación |
| [14 — Glosario](14-glosario.md) | Vocabulario común |
| [15 — Preguntas abiertas](15-preguntas-abiertas.md) | **Bloqueantes para iniciar el desarrollo** |
| [16 — Plan de pruebas (QA)](16-plan-pruebas.md) | Casos de concurrencia, seguridad, offline y negocio |

---

## Convenciones

- **Identificadores**: `RF-Mx-nn` (requerimiento funcional), `RNF-nn` (no funcional),
  `US-nn` (historia de usuario), `R-nn` (riesgo), `ADR-nnn` (decisión de arquitectura).
- **Prioridad (MoSCoW)**: `M` = Must (v1.0), `S` = Should (v1.0 si alcanza el tiempo),
  `C` = Could (v1.1+), `W` = Won't (fuera de alcance, registrado para no perderlo).
- **Moneda**: pesos chilenos (CLP), enteros, sin decimales.
- **Zona horaria**: `America/Santiago`. Toda fecha se almacena en UTC y se
  presenta en hora local.
- **Idioma de la interfaz**: español de Chile (`es-CL`).

## Control de cambios

| Versión | Fecha | Autor | Cambio |
|---|---|---|---|
| 1.0 | 2026-09-14 | Felipe Vera | Versión inicial de levantamiento |
| 1.1 | 2026-09-14 | Felipe Vera | P-07 respondida: se incorpora control de vencimiento por lote con FEFO (ADR-007, RF-M4-14 a RF-M4-20) |
| 1.2 | 2026-09-14 | Felipe Vera | Trabajo simultáneo: +4 RF de gestión de empleados, +11 RF del módulo M10, +7 RNF de concurrencia, y nuevo [plan de pruebas QA](16-plan-pruebas.md) |
