# Registros de decisiones de arquitectura (ADR)

Cada ADR documenta **una** decisión técnica relevante: el contexto en que se tomó,
las alternativas que se evaluaron, qué se decidió y qué consecuencias trae.

**Un ADR no se edita.** Si una decisión cambia, se escribe un ADR nuevo que declara
superado al anterior. Así queda el rastro de por qué se pensaba distinto antes:
sin eso, seis meses después nadie recuerda qué se descartó ni por qué.

| # | Decisión | Estado | Fecha |
|---|---|---|---|
| [ADR-001](ADR-001-stack-tecnologico.md) | Next.js + TypeScript + Tailwind como stack de frontend | Aceptada | 2026-09-14 |
| [ADR-002](ADR-002-supabase-backend.md) | Supabase como backend, con la seguridad en la base de datos | Aceptada | 2026-09-14 |
| [ADR-003](ADR-003-vercel-railway.md) | Separar frontend (Vercel) y trabajos programados (Railway) | Superada por ADR-008 | 2026-09-14 |
| [ADR-004](ADR-004-multi-tenant.md) | Multi-tenant desde el primer día | Aceptada | 2026-09-14 |
| [ADR-005](ADR-005-offline-first.md) | POS con modo offline como requisito, no como mejora | Aceptada | 2026-09-14 |
| [ADR-006](ADR-006-kardex-inmutable.md) | Kardex inmutable como fuente de verdad del inventario | Aceptada | 2026-09-14 |
| [ADR-007](ADR-007-lotes-vencimiento.md) | Control de vencimientos por lote con consumo FEFO | Aceptada | 2026-09-14 |
| [ADR-008](ADR-008-railway-servicio-unico.md) | Despliegue unificado en Railway con un solo servicio | Aceptada | 2026-09-15 |

## Plantilla

```markdown
# ADR-nnn · Título

**Estado:** Propuesta | Aceptada | Superada por ADR-xxx
**Fecha:** AAAA-MM-DD

## Contexto
Qué problema hay que resolver y bajo qué restricciones.

## Alternativas evaluadas
Cada opción con sus pros y contras.

## Decisión
Qué se decidió y por qué.

## Consecuencias
Positivas, negativas y lo que queda condicionado hacia adelante.
```
