# RutaAhorro — Sistema de Gestión de Inventario, Ventas y Caja

Plataforma web/móvil (PWA) para la gestión de inventario, ventas, caja y reportes
de comercios pequeños y medianos, diseñada para operar **desde el celular del
propio trabajador**, sin requerir hardware especializado en el local.

> **Estado del proyecto: FASE 0 — Levantamiento de requerimientos y documentación.**
> Aún **no** existe código de aplicación. Todo lo que está en `docs/` es la base
> contractual y técnica sobre la cual se construirá el sistema.

---

## Documentación

Toda la documentación vive en [`docs/`](docs/). Empieza por el
[índice de documentación](docs/README.md).

| # | Documento | Para qué sirve |
|---|-----------|----------------|
| 01 | [Visión y alcance](docs/01-vision-alcance.md) | Qué problema resuelve, qué entra y qué no en la v1.0 |
| 02 | [Stakeholders y roles](docs/02-stakeholders-roles.md) | Quiénes usan el sistema y qué puede hacer cada uno |
| 03 | [Requerimientos funcionales](docs/03-requerimientos-funcionales.md) | Qué debe hacer el sistema (RF-xxx) |
| 04 | [Requerimientos no funcionales](docs/04-requerimientos-no-funcionales.md) | Rendimiento, seguridad, disponibilidad, usabilidad |
| 05 | [Historias de usuario](docs/05-historias-usuario.md) | Backlog con criterios de aceptación |
| 06 | [Modelo de datos](docs/06-modelo-datos.md) | Esquema de base de datos, kardex, RLS |
| 07 | [Arquitectura técnica](docs/07-arquitectura.md) | Stack, componentes, flujos, offline |
| 08 | [Contratos de API](docs/08-api-contratos.md) | Endpoints y funciones transaccionales |
| 09 | [Plan de despliegue](docs/09-despliegue.md) | Vercel + Railway + Supabase, entornos, CI/CD |
| 10 | [Seguridad y cumplimiento](docs/10-seguridad-cumplimiento.md) | Secretos, RLS, Ley 21.719, SII |
| 11 | [Plan de trabajo](docs/11-plan-trabajo.md) | Fases, cronograma y entregables |
| 12 | [Costos y modelo de servicio](docs/12-costos-modelo-servicio.md) | Costo de infraestructura vs. precio del plan |
| 13 | [Riesgos](docs/13-riesgos.md) | Registro de riesgos y mitigaciones |
| 14 | [Glosario](docs/14-glosario.md) | Vocabulario común cliente ↔ equipo |
| 15 | [Preguntas abiertas](docs/15-preguntas-abiertas.md) | **Lo que hay que confirmar con el cliente antes de programar** |
| 16 | [Plan de pruebas (QA)](docs/16-plan-pruebas.md) | Casos críticos de concurrencia, permisos y modo offline |
| — | [ADRs](docs/adr/) | Decisiones de arquitectura y su justificación |

---

## Stack propuesto (ver [ADR-001](docs/adr/ADR-001-stack-tecnologico.md))

| Capa | Tecnología | Dónde vive |
|------|------------|------------|
| Frontend / PWA | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui | **Vercel** |
| Base de datos | PostgreSQL con Row Level Security | **Supabase** |
| Autenticación | Supabase Auth (email + contraseña, sesiones por usuario) | **Supabase** |
| Archivos | Supabase Storage (imágenes de productos, respaldos) | **Supabase** |
| Trabajos programados | Worker Node/TypeScript + cron (respaldos, alertas, reportes) | **Railway** |
| Escaneo de códigos | `BarcodeDetector` API nativa con fallback a ZXing | Navegador |

---

## Nota de seguridad (decisión del cliente registrada)

Las credenciales del proyecto Supabase `amlvspbmnhtvzuqiteqe` se compartieron por
chat durante el arranque. **Felipe Vera decidió mantenerlas sin rotar**, por ser
el único con acceso al proyecto en esta etapa. Queda registrado aquí como
decisión consciente, no como omisión.

Controles que **sí** se aplican para que esa decisión sea sostenible:

| Control | Estado |
|---|---|
| `.env*` ignorado por git (salvo `.env.example`) | Aplicado en [`.gitignore`](.gitignore) |
| `service_role` / `sb_secret_` jamás con prefijo `NEXT_PUBLIC_` | Regla de arquitectura, ver [ADR-002](docs/adr/ADR-002-supabase-backend.md) |
| RLS obligatorio en el 100% de las tablas | [Modelo de datos §6](docs/06-modelo-datos.md) |
| Repositorio GitHub en **privado** hasta el cierre de la v1.0 | Por confirmar — ver [preguntas abiertas](docs/15-preguntas-abiertas.md) |
| Rotación de llaves antes de entregar acceso a terceros | Procedimiento en [Seguridad §2](docs/10-seguridad-cumplimiento.md) |

> El riesgo real no es el chat: es que una llave `secret` termine comiteada en un
> repo público. Por eso el control que importa es `.gitignore` + repo privado.

Las llaves reales viven solo en `.env.local` (local), en las *Environment
Variables* de Vercel y en las *Variables* de Railway. En el repositorio solo hay
placeholders ([`.env.example`](.env.example)).

---

## Cómo se trabaja este repo

1. Nada se programa hasta que [`docs/15-preguntas-abiertas.md`](docs/15-preguntas-abiertas.md)
   esté respondido y el alcance de la v1.0 esté firmado por el cliente.
2. Todo cambio de alcance se registra como una entrada nueva en el documento
   correspondiente, con fecha y autor.
3. Las decisiones técnicas relevantes se registran como ADR en `docs/adr/`.
