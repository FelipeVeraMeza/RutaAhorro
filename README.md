# RutaAhorro — Sistema de Gestión de Inventario, Ventas y Caja

Plataforma web/móvil (PWA) para la gestión de inventario, ventas, caja y reportes
de comercios pequeños y medianos, diseñada para operar **desde el celular del
propio trabajador**, sin requerir hardware especializado en el local.

> **Estado del proyecto: FASE 2-3 — Construcción.** *(al 2026-09-16)*
> Esquema de base completo (26 tablas, 24 funciones, RLS al 100 %).
> 11 pantallas funcionando, las 11 auditadas. 206 pruebas de lógica de negocio.
> **Nada desplegado y el esquema no está aplicado en Supabase todavía**: hasta
> que eso pase, todo corre contra IndexedDB en modo demo. El detalle ítem por
> ítem está en el [inventario de alcance](docs/17-inventario-alcance.md) y los
> hallazgos abiertos en la [auditoría de pantallas](docs/21-qa-pantallas.md).

---

> **¿Continuando el proyecto en otra sesión o herramienta?**
> Parte por [`HANDOFF.md`](HANDOFF.md): es un prompt autocontenido con el
> contexto, el estado real y lo que sigue.

---

## Poner la base en marcha

Sin esto el sistema no existe para el cliente: la aplicación corre contra
IndexedDB y los datos se borran al limpiar el navegador.

```bash
npm install
npm run db:instalar     # genera supabase/instalar.sql
```

**1 · Aplicar el esquema.** Abrir `supabase/instalar.sql`, buscar la línea
`v_nombre text := 'RutaAhorro';` y poner el nombre real del local. Pegar el
archivo completo en *Supabase → SQL Editor → New query* y ejecutar.

Es un solo archivo, idempotente, que deja tablas, funciones, disparadores, RLS
con sus políticas por rol, vistas de reporte, y un tenant con una tienda.
**Sin ningún producto**: el catálogo lo carga el cliente con los suyos.

> `instalar.sql` reemplaza al par `bundle.sql` + `seed-produccion.sql`, que
> había que pegar en orden y donde equivocarse de seed metía 12 productos de
> ejemplo con códigos EAN inventados en la base del cliente. Esos códigos no se
> pueden liberar después: `unique (tenant_id, barcode)` los deja ocupados.

**2 · Crear el primer administrador.**

```bash
npm run db:admin -- --correo=dueno@almacen.cl --nombre="Ana Pérez"
```

Imprime una contraseña temporal y **verifica que el perfil se haya creado**. Ese
es el paso que más se rompe al instalar a mano: el perfil no lo crea el panel de
Supabase, lo crea el disparador `handle_new_user` leyendo el metadata del
usuario. Si ese JSON no trae `tenant_id`, el usuario se crea igual, entra al
login igual, y queda sin perfil — y la aplicación lo rechaza sin decir por qué.

Para el resto del personal, `--rol=vendedor`, `supervisor` o `bodega`. También se
pueden invitar por correo desde la pantalla Usuarios una vez dentro.

**3 · Apagar el modo demo.** En `.env.local`, `NEXT_PUBLIC_DEMO=false`, y
reiniciar `npm run dev`. Con el demo encendido el build siempre pasa: antes de
dar por bueno cualquier cambio, compilar como compila producción con
`NEXT_PUBLIC_DEMO=false npm run build:web`.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Frontend en `:3000` |
| `npm run dev:worker` | Worker en `:8080` (no se levanta con `npm run dev`) |
| `npm test` | 206 pruebas de lógica de negocio |
| `npm run typecheck` | Tipos en los tres paquetes |
| `npm run db:check` | Valida el SQL con el parser de PostgreSQL |
| `npm run db:instalar` | Genera `supabase/instalar.sql` — esquema + arranque |
| `npm run db:bundle` | Genera solo el esquema, sin el arranque |
| `npm run db:admin` | Crea un usuario contra la base real y verifica su perfil |
| `npm run build:web` | Compila core + web |

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
| 09 | [Plan de despliegue](docs/09-despliegue.md) | Railway + Supabase, entornos, CI/CD |
| 10 | [Seguridad y cumplimiento](docs/10-seguridad-cumplimiento.md) | Secretos, RLS, Ley 21.719, SII |
| 11 | [Plan de trabajo](docs/11-plan-trabajo.md) | Fases, cronograma y entregables |
| 12 | [Costos y modelo de servicio](docs/12-costos-modelo-servicio.md) | Costo de infraestructura vs. precio del plan |
| 13 | [Riesgos](docs/13-riesgos.md) | Registro de riesgos y mitigaciones |
| 14 | [Glosario](docs/14-glosario.md) | Vocabulario común cliente ↔ equipo |
| 15 | [Preguntas abiertas](docs/15-preguntas-abiertas.md) | **Lo que hay que confirmar con el cliente antes de programar** |
| 16 | [Plan de pruebas (QA)](docs/16-plan-pruebas.md) | Casos críticos de concurrencia, permisos y modo offline |
| 17 | [Inventario de alcance](docs/17-inventario-alcance.md) | **Estado real: qué está hecho y qué falta**, auditado sobre el código |
| 18 | [Documentos tributarios (SII)](docs/18-documentos-tributarios-sii.md) | Boleta y factura electrónica: alcance y ruta |
| 19 | [Cronograma](docs/19-cronograma.md) | **Qué sigue y en qué orden.** Fuente autorizada |
| 21 | [Auditoría de pantallas (QA)](docs/21-qa-pantallas.md) | **Hallazgos por pantalla**, corregidos y abiertos |
| — | [ADRs](docs/adr/) | Decisiones de arquitectura y su justificación |

---

## Stack propuesto (ver [ADR-001](docs/adr/ADR-001-stack-tecnologico.md))

| Capa | Tecnología | Dónde vive |
|------|------------|------------|
| Frontend / PWA | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui | **Railway** |
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

Las llaves reales viven solo en `.env.local` (local) y en las *Variables* del
servicio de Railway. En el repositorio solo hay
placeholders ([`.env.example`](.env.example)).

---

## Cómo se trabaja este repo

1. Nada se programa hasta que [`docs/15-preguntas-abiertas.md`](docs/15-preguntas-abiertas.md)
   esté respondido y el alcance de la v1.0 esté firmado por el cliente.
2. Todo cambio de alcance se registra como una entrada nueva en el documento
   correspondiente, con fecha y autor.
3. Las decisiones técnicas relevantes se registran como ADR en `docs/adr/`.
