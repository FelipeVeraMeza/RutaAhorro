# 10 — Seguridad y cumplimiento

---

## 1. Modelo de amenazas

Quién puede hacer daño y cómo se lo impide:

| Amenaza | Actor | Impacto | Control |
|---|---|---|---|
| Un cliente lee los datos de otro | Usuario autenticado de otro local | **Crítico** — fin del negocio SaaS | RLS por `tenant_id` en todas las tablas + prueba automatizada |
| Un vendedor ve los costos y márgenes del dueño | Empleado | Alto — conflicto laboral | Vista sin columnas de costo + política RLS por rol |
| Un empleado borra ventas para ocultar un faltante | Empleado | Alto | Kardex y bitácora inmutables; anular deja rastro doble |
| Se filtra la llave `service_role` | Error de configuración | **Crítico** — acceso total | Solo en Railway; verificación del bundle en CI |
| Robo de contraseña | Externo | Alto | Supabase Auth, límite de intentos, TOTP para `admin` (RF-M1-10) |
| Pérdida del celular con sesión abierta | Accidente | Medio | Cierre de sesión remoto (RF-M1-09); sin datos de costo en el dispositivo del vendedor |
| Pérdida de datos | Fallo del proveedor | **Crítico** | Respaldo diario + restauración probada |
| Manipulación de peticiones para vender con descuento total | Empleado con conocimientos | Medio | Validación del descuento **en la base de datos**, no en la interfaz |
| Ventas offline inventadas | Empleado | Medio | `sold_at` del dispositivo contrastado con `synced_at`; desviaciones anómalas quedan en el reporte |

> La amenaza más probable en un comercio pequeño no es un hacker: es una persona
> del propio local intentando tapar un faltante. Por eso la inmutabilidad del
> kardex y de la bitácora no es un lujo técnico — es el control de negocio central.

---

## 2. Gestión de credenciales

### 2.1 Estado actual

Las credenciales del proyecto `amlvspbmnhtvzuqiteqe` se compartieron por chat
durante el arranque del proyecto.

**Decisión registrada (2026-09-14):** Felipe Vera, único con acceso al proyecto,
determinó **no rotar** las llaves en esta etapa. Queda documentado como decisión
consciente y acotada al período previo a producción.

| Llave | Naturaleza | Riesgo si se expone |
|---|---|---|
| `anon` / `sb_publishable_…` | **Pública por diseño** | Ninguno adicional — siempre que RLS esté activo |
| `service_role` / `sb_secret_…` | **Secreta** | **Total**: lectura y escritura de toda la base, ignorando RLS |

### 2.2 Controles vigentes

| Control | Estado |
|---|---|
| `.env*` excluido de git (salvo `.env.example`) | ✅ Aplicado |
| Llaves reales solo en `.env.local` y en las Variables de Railway | ✅ Aplicado |
| `service_role` ausente del bundle del cliente; en Railway, solo variable de servidor | ✅ Por diseño |
| Verificación automática del bundle en CI | Pendiente (F1) |
| RLS en el 100 % de las tablas | Pendiente (F1) |
| Repositorio GitHub **privado** | 🔶 Por confirmar — P-13 |

> **Lo que realmente hay que cuidar:** que una llave secreta termine comiteada en
> un repositorio público. Los rastreadores automáticos de GitHub detectan un
> `service_role` expuesto en minutos. El control que importa es `.gitignore` +
> repositorio privado, y ambos están en su lugar.

### 2.3 Cuándo sí hay que rotar

La decisión de no rotar deja de ser válida si ocurre cualquiera de estos eventos:

- El repositorio se hace **público**.
- Una llave secreta aparece en un commit (aunque se revierta: queda en el historial).
- Ingresa **otra persona** al equipo o se entrega acceso a un tercero.
- Antes de la **puesta en producción con datos reales del cliente**.
- Ante cualquier sospecha de acceso no autorizado.

### 2.4 Procedimiento de rotación

```
1. Supabase → Project Settings → API Keys → Roll / Generate new
2. Actualizar la variable en Railway  (el worker se redespliega solo)
3. Actualizar .env.local en el equipo de desarrollo
4. Verificar: POST /jobs/backup responde correctamente
5. Revocar la llave anterior
6. Registrar la rotación en la bitácora de operación
```

Duración estimada: 15 minutos. El frontend no se ve afectado, porque nunca usó
la llave secreta.

---

## 3. Seguridad de la aplicación

### 3.1 Autenticación
- Delegada íntegramente en **Supabase Auth**. El proyecto no implementa
  criptografía propia ni almacena contraseñas.
- Sesiones en cookies `httpOnly`, `Secure`, `SameSite=Lax` vía `@supabase/ssr`.
- Tokens de acceso de corta vida con refresco automático.
- Límite de 5 intentos fallidos por minuto (RF-M1-11).
- TOTP para `admin` (RF-M1-10, prioridad Could).

### 3.2 Autorización
- **Toda** regla de permiso existe como política RLS en PostgreSQL.
- La interfaz esconde lo que el rol no puede usar, pero eso es comodidad visual:
  aunque alguien reconstruya la petición a mano, la base la rechaza.
- El `tenant_id` se deriva siempre del token, nunca de un parámetro del cliente.

### 3.3 Validación de entrada
- Esquemas Zod compartidos: el mismo esquema valida el formulario y el endpoint.
- Restricciones `CHECK` en la base para las invariantes que nunca deben romperse
  (cantidades positivas, montos no negativos, totales coherentes).
- Consultas siempre parametrizadas — sin concatenación de SQL.

### 3.4 Cabeceras y transporte
- HTTPS obligatorio con HSTS.
- Content Security Policy restrictiva.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- CORS del worker limitado al dominio de la aplicación.

### 3.5 Dependencias
- Dependabot activo.
- `npm audit` en CI: ninguna vulnerabilidad crítica llega a producción.
- Actualización de versiones menores mensual; de versiones mayores, planificada.

---

## 4. Auditoría

Toda acción sensible queda en `audit_log` con usuario, fecha, IP, valor anterior
y valor nuevo (RF-M9-05 a RF-M9-07).

**Se audita:** cambio de precio · ajuste de stock · anulación de venta ·
anulación de recepción · cierre forzado de caja · alta/baja de usuario ·
cambio de rol · cambio de configuración · exportación de datos.

**Inmutable de verdad:** un *trigger* rechaza `UPDATE` y `DELETE` sobre
`audit_log` e `inventory_movements` para **todos** los roles, incluido `admin`.
Un administrador que puede borrar la bitácora convierte la bitácora en decoración.

---

## 5. Acceso del equipo de soporte

| Regla | Detalle |
|---|---|
| Acceso mínimo | El equipo **no** tiene usuario permanente en el tenant del cliente |
| Acceso puntual | Para diagnosticar se crea un usuario `soporte` temporal, autorizado por el cliente |
| Vigencia | Máximo 72 h, se desactiva automáticamente |
| Trazabilidad | Todas sus acciones quedan en la bitácora, visibles para el cliente |
| Base de datos | El acceso directo a producción se limita a incidentes, y toda consulta ejecutada se registra |

---

## 6. Cumplimiento normativo (Chile)

> 🔶 Esta sección refleja el entendimiento del equipo a septiembre de 2026 y
> **no constituye asesoría legal**. Antes de la puesta en producción conviene una
> revisión por un abogado o contador. Ver P-16 en [15](15-preguntas-abiertas.md).

### 6.1 Protección de datos personales

| Norma | Qué implica para este sistema |
|---|---|
| **Ley 19.628** | Marco vigente sobre protección de la vida privada y tratamiento de datos personales |
| **Ley 21.719** | Nueva ley de protección de datos, publicada en diciembre de 2024, con entrada en vigencia programada para **diciembre de 2026** y creación de la Agencia de Protección de Datos. Endurece deberes y sanciones. **Debe verificarse la fecha y alcance exactos con asesoría legal antes de operar** |

Datos personales que trata el sistema:

| Dato | Titular | Base de tratamiento | Necesidad |
|---|---|---|---|
| Nombre y correo | Trabajadores del local | Relación laboral / contrato de servicio | Identificación y sesión |
| Nombre, RUT, contacto | Proveedores | Relación comercial | Gestión de compras |
| — | Clientes finales | — | **El sistema no registra datos de clientes en la v1.0**, lo que reduce sustancialmente la exposición |

Medidas comprometidas: minimización (no se pide lo que no se usa), cifrado en
tránsito y en reposo, control de acceso por rol, retención definida, capacidad de
exportación y eliminación a solicitud del cliente.

### 6.2 Transferencia internacional de datos

Los datos residen en **`ca-central-1` (Canadá)**. Esto debe:
1. Informarse explícitamente al cliente.
2. Quedar por escrito en el contrato de servicio.
3. Revisarse a la luz de la Ley 21.719, que regula la transferencia internacional.

> Canadá cuenta con legislación de protección de datos reconocida
> internacionalmente, lo que juega a favor. Aun así, **si la asesoría legal lo
> recomienda, migrar a `sa-east-1` (São Paulo) es viable y conviene decidirlo
> antes de cargar datos reales**: mover un proyecto Supabase con producción activa
> es mucho más caro que elegir bien la región ahora. Ver P-15.

### 6.3 Obligaciones tributarias (SII)

| Tema | Situación |
|---|---|
| Emisión de boleta electrónica | **Fuera del alcance v1.0** (FA-1). El local sigue emitiendo por su medio actual |
| Registro de ventas del sistema | Es un **control de gestión interno**, no un libro tributario |
| Riesgo de expectativa | El cliente podría entender que el sistema "reemplaza" su boleteo. **Debe aclararse por escrito antes de firmar** |
| Camino futuro | Integración vía proveedor DTE certificado en v2.0 |

> **Esta es la ambigüedad más cara del proyecto.** La propuesta comercial dice
> "control contable"; el sistema entrega control de caja, márgenes y existencias.
> Si el cliente esperaba emitir boletas, la diferencia entre lo entendido y lo
> entregado se descubre el día de la puesta en marcha. Ver P-03.

---

## 7. Respuesta a incidentes de seguridad

| Paso | Plazo | Acción |
|---|---|---|
| 1. Detección | — | Alerta de Sentry, monitor o reporte del cliente |
| 2. Contención | < 1 h | Rotar llaves comprometidas, revocar sesiones, suspender el acceso afectado |
| 3. Evaluación | < 4 h | Determinar alcance con la bitácora de auditoría y los registros de Supabase |
| 4. Notificación | < 24 h | Informar al cliente por escrito: qué pasó, qué datos, qué se hizo |
| 5. Remediación | < 72 h | Corregir la causa raíz |
| 6. Informe | < 7 días | Informe post-incidente con medidas preventivas |

> Si el incidente involucra datos personales, la Ley 21.719 puede exigir
> notificación a la autoridad en plazos determinados. Verificar con asesoría legal.

---

## 8. Revisiones periódicas

| Actividad | Frecuencia |
|---|---|
| Revisión de usuarios activos y sus roles | Trimestral |
| Verificación de RLS en todas las tablas | En cada despliegue (automática) |
| Prueba de restauración de respaldo | Trimestral |
| Auditoría de dependencias | Semanal (automática) |
| Revisión de la bitácora en busca de patrones anómalos | Mensual |
| Revisión de esta documentación | Semestral o ante cambio normativo |
