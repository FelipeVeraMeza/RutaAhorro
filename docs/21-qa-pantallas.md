# 21 — Auditoría de pantallas (QA)

**Primera pasada:** 2026-09-15 · **Segunda:** 2026-09-16 · **Tercera:** 2026-09-17 · **Cuarta (esquema ejecutado):** 2026-09-18 · **Quinta (primera venta y fechas):** 2026-09-19 · **Sexta (navegador, por requerimiento):** 2026-09-19
**Método:** lectura del código de cada pantalla, contrastada contra
[17](17-inventario-alcance.md) y [03](03-requerimientos-funcionales.md).

## Alcance

| Pantalla | Revisión |
|---|---|
| Caja | Completa |
| Productos (listado) | Completa |
| Inventario | Completa |
| Recepción de mercadería | Completa |
| Vender (POS) | Completa |
| **Proveedores** | **Completa** · 2026-09-16 |
| **Importar** | **Completa** · 2026-09-16 |
| **Formulario de producto** | **Completa** · 2026-09-16 |
| **Ingreso (login)** | **Completa** · 2026-09-16 |
| **Inicio** | **Completa** · 2026-09-17 |
| **Usuarios** | **Completa** · 2026-09-17 |

Con la tercera pasada, **las 11 pantallas están auditadas línea por línea**. No
queda ninguna parcial.

> La tercera pasada encontró **dos agujeros de seguridad explotables** que las
> dos anteriores no vieron, porque las dos revisaron pantallas y estos estaban
> en la capa de permisos de la base. Están en la sección 0, antes que todo lo
> demás, porque son de otra categoría que el resto de este documento.

---

## 0. Seguridad — lo que no es un problema de pantalla

Dos hallazgos de la tercera pasada. No los encontró revisar pantallas: los
encontró revisar quién puede llamar a qué. Los dos estaban en producción desde
que existe el esquema, los dos son explotables desde el navegador por un
usuario con sesión, y ninguno deja rastro que permita notarlo a tiempo.

### S-1 · Las funciones internas nunca estuvieron cerradas — **crítica** · ✅ corregido

La migración 0004 tenía esto, con un comentario al lado que afirmaba que esas
funciones no se exponían:

```sql
revoke execute on function public.fn_post_movement from authenticated, anon;
```

**No cerraba nada.** Cuando PostgreSQL crea una función le concede EXECUTE a
`public` —el pseudo-rol al que pertenecen todos— y ese permiso no se quita
revocándoselo a `authenticated`: hay que revocárselo a `public`. Los tres
`revoke` no quitaban ningún permiso, porque esos permisos directos nunca se
habían concedido.

Lo que quedaba abierto vía PostgREST:

```
POST /rest/v1/rpc/fn_post_movement
  { p_tenant, p_store, p_product, p_type, p_quantity, ..., p_user }
```

`fn_post_movement` es `security definer`, **recibe el tenant como parámetro** y
no comprueba ni rol ni tenant, porque se escribió para llamarse solo desde
otras funciones que ya comprobaron las dos cosas. Con EXECUTE abierto,
cualquier usuario con sesión —un vendedor, el rol más bajo— podía:

- escribir stock de cualquier producto de **otro local**, que es exactamente lo
  que el RLS existe para impedir;
- escribir movimientos en el kardex, que es inmutable por diseño (ADR-006),
  **atribuidos a cualquier usuario**, porque `p_user` también es parámetro.

Lo mismo `fn_consume_lots` y `fn_next_folio`, esta última para quemarle folios
a otro local y dejarle la numeración de ventas con huecos.

Corregido en la migración 0009, que revoca de `public` y concede de forma
explícita. Es idempotente y se puede aplicar sobre una base ya instalada.

### S-2 · Un vendedor podía hacerse administrador — **crítica** · ✅ corregido

La política de 0004:

```sql
create policy profiles_update on profiles for update to authenticated
  using (tenant_id = current_tenant_id()
         and (current_user_role() = 'admin' or id = auth.uid()))
  with check (tenant_id = current_tenant_id());
```

El `id = auth.uid()` estaba para que cada uno pudiera corregirse el nombre.
Pero **RLS trabaja por fila, no por columna**: quien puede actualizar su fila
puede actualizar cualquier columna de su fila, y en esa fila están `role` y
`max_discount_pct`. Desde el navegador, sin ninguna herramienta:

```js
supabase.from('profiles').update({ role: 'admin' }).eq('id', miId)
```

El `with check` no lo impedía porque solo miraba el tenant, que no cambia. El
disparador de auditoría lo registraba, pero **registrar no es impedir**: cuando
alguien lea el registro, el vendedor ya es administrador.

Corregido en 0011 con un disparador `BEFORE UPDATE`, y no con una política,
porque lo que hay que distinguir es *qué columna* cambió y eso RLS no lo sabe.
El mismo disparador impide que el local quede sin ningún administrador activo.

### S-3 · Ocho guardias de rol que no guardaban nada — **media** · ✅ corregido

Repartido por trece funciones:

```sql
if current_user_role() not in ('admin','supervisor','bodega') then
  raise exception 'SIN_PERMISO';
end if;
```

`current_user_role()` devuelve NULL cuando el usuario no tiene perfil —el caso
que produce `handle_new_user` si la invitación llegó sin `tenant_id`, que no es
raro—. Y `NULL not in (...)` no vale verdadero ni falso: **vale NULL**, y un
`if` con NULL no entra. El guardia dejaba pasar justo a quien no tiene rol.

Hoy no era explotable porque `current_tenant_id()` también es NULL y todo
falla más adelante, contra una restricción de no-nulo o una fila que no
aparece. Pero fallaba por accidente, no por diseño, y el guardia se leía como
si protegiera. Son trece en total: ocho escritas con `current_user_role()`
directo y cinco con el rol en una variable, que la primera corrección no
alcanzó. Dos de esas cinco son el control de stock insuficiente en la venta:
con rol nulo, la venta pasaba igual sin stock.

### S-4 · El tope de descuento no se aplicaba en ninguna parte — **alta** · ✅ corregido

`DESCUENTO_EXCEDE_LIMITE` estaba en la tabla de errores desde el primer día.
`profiles.max_discount_pct` estaba en el esquema. `discountWithinLimit` estaba
en core, probado. Y `fn_register_sale` no leía ninguno de los tres: el
`discount_amount` de cada línea entraba tal como lo mandara el cliente. Tres
piezas correctas y ninguna conectada con otra.

Corregido: se valida en la base, con la misma tolerancia de redondeo que core.

> **Queda abierto y relacionado:** `fn_register_sale` acepta `unit_price` del
> cliente sin compararlo con el precio del catálogo. Es deliberado —una venta
> hecha sin conexión se sincroniza con el precio que tenía al momento de
> venderse, no con el de ahora—, pero significa que el tope de descuento se
> puede rodear vendiendo a precio 1 en vez de aplicando un descuento. Cerrarlo
> bien pide comparar contra `price_history` con la fecha de la venta. Es T-14.

---

## 0b. Cuarta pasada · el esquema ejecutado — 2026-09-18

S-1 a S-4 salieron de **leer** el SQL. Esta pasada lo **ejecutó**: un
PostgreSQL real con lo mínimo de Supabase encima (`auth.uid()`, roles y los
privilegios por omisión que Supabase concede), las migraciones aplicadas en
orden, y cada ataque escrito como lo escribiría alguien con la consola del
navegador y la sesión de un empleado. Está en `tools/pg-test/` y corre con
`npm run db:test`.

Primera consecuencia: **S-1 y S-2 quedan verificados**, no solo leídos. Las
dos correcciones resisten el ataque.

### S-5 · Las tablas que se escriben con funciones también se podían escribir a mano — **crítica** · ✅ corregido

Supabase le concede ALL sobre cada tabla de `public` a `authenticated`. Una
política de INSERT o UPDATE no es un detalle: es la puerta. Y 0004 dejó puertas
que solo comprobaban el tenant, en tablas que el diseño dice que solo se
escriben desde funciones. Con la sesión de un **cajero**:

```sql
update cash_sessions
   set status = 'cerrada', expected_amount = 5000, counted_amount = 5000
 where id = '<mi caja>';
```

**El cajero escribía su propio arqueo.** El control contra el faltante de caja
lo llenaba la persona a la que controla. Y había más, todos confirmados
ejecutándolos:

| Quién | Qué podía hacer |
|---|---|
| Cajero | Insertar un **egreso** en su caja **firmado por el supervisor** (`created_by` es libre): baja el esperado y esconde un faltante |
| Cajero | Insertar ventas, pagos o líneas en la caja de **otro** cajero |
| Cajero | Escribir en `audit_log` a nombre de cualquiera. La bitácora es inmutable: lo inventado no se puede borrar |
| Cajero | Escribir en `price_history`, que es justo contra lo que T-14 iba a comparar |
| Supervisor | `update sales set total = 1`, o `status = 'anulada'` sin devolver stock y saltándose la regla de "solo ventas del día" |
| Bodega | Cambiar la cantidad de un lote sin kardex; **reabrir una toma aplicada** para aplicarla otra vez; crear recepciones sin mercadería; cambiar `avg_cost` a mano |

Ninguna de esas escrituras la hace la aplicación (verificado en `apps/web` y
`apps/worker`): todas pasan por funciones `security definer`, que no necesitan
esas políticas. Corregido en **0012**: se quitan las políticas y además se
revoca el privilegio (dos candados, no uno), y un disparador impide cambiar el
costo fuera de una función.

### S-6 · `anon` podía ejecutar las funciones de negocio — **baja** · ✅ corregido

0009 les quitó `public`, pero Supabase además concede EXECUTE directo a `anon`
sobre toda función nueva. No era explotable —todas fallan con `NO_AUTENTICADO`—
pero eso es depender de que cada función lo compruebe bien. 0012 lo revoca, y
una prueba compara la lista de lo que `authenticated` puede ejecutar contra una
lista escrita a mano: si alguien crea una función `security definer` y olvida
cerrarla, la prueba falla.

### S-7 · Cualquier rol lee costos — **media** · ⬜ abierto (T-45)

`repoSupabase.ts` pide `avg_cost` solo cuando el usuario puede ver costos, y el
comentario dice que así "el costo no viaja por la red hacia un dispositivo que
no debe tenerlo". Es cierto mientras el cliente coopere: la base se lo entrega a
cualquiera que lo pida.

```js
supabase.from('products').select('name, avg_cost')        // un vendedor
supabase.from('sale_items').select('unit_cost')           // también
```

Es CP-10 del plan de pruebas, que nunca se había ejecutado. No se corrigió en
esta tanda porque arreglarlo bien cambia cómo leen costos Reportes, el
formulario de producto y `v_inventory_valued` (que es `security_invoker` y
heredaría la restricción). La prueba existe y está marcada como pendiente.

### El instalador no era idempotente

`instalar.sql` decía "se puede ejecutar más de una vez sin romper nada", y
HANDOFF recomendaba **reinstalar** para llevarle los arreglos de seguridad a una
base con una versión anterior. La segunda ejecución fallaba en la primera
política (`policy "tenant_read" already exists`) y, como va en una transacción,
**no aplicaba nada**. Quien siguiera el consejo recibía un error y la base
quedaba igual, con las puertas abiertas. Corregido (`drop policy if exists`
antes de cada política, y de las dos vistas que 0010 amplía) y probado.

---

## 0c. Concurrencia (T-40) — 2026-09-18

CP-01 a CP-08 nunca se habían ejecutado. Siete requerimientos figuraban hechos
**por diseño**. Cada carrera se fuerza ahora en su peor intercalado: la sesión 1
hace su operación en una transacción abierta, la sesión 2 lanza la suya, se
espera a que quede bloqueada, y recién entonces se confirma la 1.

**Ocho defectos confirmados**, todos con la misma forma: leer un estado sin
bloquearlo, decidir con lo leído y escribir. Entre la lectura y la escritura
otra transacción cambia el estado y la decisión ya no vale.

| # | Caso | Qué pasaba |
|---|---|---|
| C-1 | **CP-05** · aplicar la misma toma dos veces | El ajuste se aplicaba dos veces. La toma decía 7; el sistema quedaba en **4** |
| C-2 | Dos ajustes "dejar en 7" a la vez | Quedaba en **4** |
| C-3 | Anular la misma venta desde dos pantallas | El stock volvía dos veces |
| C-4 | Anular la misma recepción dos veces | El stock se descontaba dos veces |
| C-5 | Dar de baja el mismo lote dos veces | Se descontaba dos veces |
| C-6 | Dos recepciones del mismo producto | La segunda promediaba contra el costo de antes de la primera y lo pisaba (250 en vez de 233) |
| C-7 | **CP-07** · cierre forzado mientras el cajero cobra | La venta quedaba dentro de la caja cerrada y **fuera del arqueo**: $5.000 en el cajón que el esperado no incluye |
| C-8 | **CP-08** y **CP-03b** · abrir caja en dos dispositivos; reintento offline con el primer envío en curso | La regla se cumplía, pero llegaba `duplicate key value violates unique constraint`. En el reintento es peor: la cola lo marcaba fallido y alguien volvía a cobrar |

Corregido en 0012 con `for update` / `for share` en el punto exacto, y con
todos los bloqueos de stock tomados de una vez y ordenados por producto, para
que dos operaciones no se traben entre sí.

Y una que no era de concurrencia pero apareció al probar CP-01: **ADR-005 dice
que vender sin stock "se permite y se alerta"**, y el disparador solo alertaba
si el producto tenía `min_stock > 0`. Un producto sin mínimo —la mayoría, con el
catálogo recién cargado— podía quedar en −5 sin que nadie se enterara.

> **CP-01 no se comporta como dice el plan, y está bien.** El plan esperaba que
> las dos ventas de la última unidad quedaran registradas y el stock en −1. Lo
> que pasa es que las ventas de un mismo local quedan **en fila** por el
> contador de folios, así que la segunda ve stock 0: si la hace un vendedor,
> recibe `STOCK_INSUFICIENTE`; si la hace un supervisor, pasa, queda en −1 y
> ahora sí alerta. Ninguna venta se pierde en ningún caso.

---

## 0d. Quinta pasada · la primera venta y las fechas — 2026-09-19

Salió de preparar la primera venta real y de lo que Felipe vio probando el POS
en la maqueta: una venta en efectivo que no quedó registrada en ninguna parte,
y la cámara que se pegaba hasta apagarla y prenderla.

| # | Hallazgo | Daño | Estado |
|---|---|---|---|
| **F-1** | **Ventas filtraba "hoy" en UTC.** Mandaba `sold_at >= '2026-09-18T00:00:00'` sin zona, que la base lee en UTC: el día iba de las 20:00 o 21:00 de ayer a la misma hora de hoy | Lo vendido en la tarde-noche —la hora punta de un almacén— aparecía en el día siguiente. Era el mismo error que ya se había corregido en Inicio, repetido en otra pantalla | ✅ `rangoDeDias` en core |
| **F-2** | **Un supervisor no podía anular en la noche una venta de esa noche.** `fn_void_sale` comparaba `sold_at::date` (zona de la sesión, UTC en Supabase) con la fecha de Chile | Después de las 20:00–21:00 respondía `SIN_PERMISO_ANULAR` a una venta del mismo día | ✅ 0013, probado |
| **F-3** | **`America/Santiago` escrito a mano** en 8 lugares de la web y 4 vistas de reportes, aunque `tenants.settings.timezone` existe desde 0001 | Un local en otra zona (Isla de Pascua, u otro cliente) vería sus ventas en el día equivocado sin dónde corregirlo | ✅ Todo lee la configuración. Queda un solo valor por omisión |
| **F-4** | **Los productos de la maqueta sobrevivían en producción.** La maqueta y producción comparten la base del navegador, y la sincronización real solo agrega | Los 14 productos de ejemplo seguían en el POS después de apagar el demo, con códigos de barra escaneables. Y un celular donde entraba alguien de otro local le mostraba el catálogo del anterior | ✅ El navegador sabe de quién es su catálogo y lo rehace si cambia |
| **F-5** | **Una venta sin conexión se registraba a nombre de quien sincronizara**, no de quien la hizo | Cajero A vende sin red, cierra sesión, entra B: la venta queda en la caja de B, y el arqueo de B tiene plata que no cobró | ✅ La venta guarda su usuario y solo él la envía |
| **F-6** | **La cámara se pegaba.** Si se cerraba mientras el navegador todavía la estaba entregando, la cámara que llegaba tarde quedaba encendida sin control; con el lector ZXing (iPhone, Firefox) cada apagar/prender sumaba un lector más; al bloquear la pantalla la imagen quedaba congelada sin aviso | Lo que Felipe vio: había que apagar y prender la cámara | ✅ En código. **Falta probarlo en un celular real** |
| **F-7** | **La maqueta descartaba las ventas.** Al "sincronizar", borraba la venta de la cola sin guardarla; "Vendido hoy" era un número fijo ($187.450) | Se cobraba en el POS y no aparecía ni en Ventas ni en Inicio. Mostraba algo que no es cierto (T-15) | ✅ La venta queda en el historial local, el stock baja, Inicio suma lo real |
| **F-8** | **El stock del POS quedaba viejo después de vender**, hasta la sincronización periódica 10 minutos después | El cajero veía unidades que ya se habían vendido | ✅ Se resincroniza al confirmar |
| **F-9** | **El banco de pruebas corría en la hora de esta máquina**, no en UTC como Supabase | Tapaba F-2: un `::date` sin zona daba el mismo día en los dos lados | ✅ Corre en UTC |

> **Lo que no está probado automáticamente:** F-4 a F-8 viven en el navegador
> (IndexedDB, cámara), y la web no tiene pruebas de ese tipo. Pasan typecheck y
> el build de producción, pero no hay una prueba que falle si se rompen. Es
> T-48.

## 0e. Sexta pasada · cada requerimiento en el navegador — 2026-09-19

Con la base real instalada, cada módulo se recorre en Edge como lo usaría la
persona (vendedor en pantalla de celular, administrador en escritorio), contra
Supabase, en un local aparte "QA · pruebas internas". Los recorridos quedan en
`tools/ui/` y se vuelven a correr con `node tools/ui/<modulo>.mjs`.

| Recorrido | Resultado |
|---|---|
| `m1-usuarios.mjs` | 20/20 |
| `bodega-sala.mjs` | 7/7 |
| `m5-vender.mjs` | 17/17 |
| `m6-caja.mjs` | 13/13 |

Lo que encontró. **Todo figuraba ✅ en la documentación**, salvo lo marcado:

| # | Hallazgo | Daño | Estado |
|---|---|---|---|
| **G-1** | **La búsqueda por nombre del POS nunca funcionó.** Filtraba con `where('isActive').equals(1)`; `isActive` se guarda como `true` e IndexedDB no indexa booleanos. Devolvía vacío sin error | Solo se podía vender escaneando | ✅ |
| **G-2** | **Un empleado invitado nunca podía crear su contraseña.** La invitación llevaba a `/login` y no existía pantalla para crearla | Nadie invitado podía entrar | ✅ `/recuperar` |
| **G-3** | **Cerrar sesión sacaba a todos los dispositivos** del usuario (`signOut()` es global por omisión) | El dueño salía en el computador y el celular de la caja quedaba fuera | ✅ `scope: 'local'` |
| **G-4** | **Recuperar contraseña no existía** (M1-05 figuraba ⬜) | El dueño tenía que entrar a Supabase | ✅ |
| **G-5** | **Se cobraba y la venta no quedaba registrada.** El POS entregaba el comprobante antes de que la base respondiera; si la rechazaba (vendedor sin stock), la venta quedaba como error en el celular | Plata en el cajón sin venta que la explique | ✅ Con conexión se espera a la base; el vendedor se entera antes de cobrar |
| **G-6** | **Un administrador sin caja propia no podía cerrar la caja de otro.** El diálogo solo existía en la vista de caja abierta; "Cerrarla" no hacía nada | T-08 figuraba hecho | ✅ |
| **G-7** | **"Vaciar" borraba la venta armada sin preguntar** (RNF-19) | Un toque de más | ✅ |
| **G-8** | **El cobro era un diálogo hecho a mano**: sin Escape, sin foco atrapado (regla 10) | | ✅ `<Modal>` |
| **G-9** | **El catálogo del POS se actualizaba cada 10 minutos**: un producto recién creado, una recepción o una reposición no se veían al vender | | ✅ Se sincroniza al entrar a Vender y tras cada cambio |
| **G-10** | **Stock por ubicación (M4-13, figuraba ⬜)**: no había forma de saber cuánto quedaba en la sala | | ✅ Bodega y sala, migración 0014 |

> **Pendiente de confirmar en un celular real:** la cámara (F-6). Todo lo demás
> se probó en Edge con pantalla de celular y modo táctil.
>
> **Correos de invitación y recuperación:** el servicio de correo gratuito de
> Supabase solo envía a los miembros del equipo del proyecto y pocas veces por
> hora. Para empleados reales hay que conectar un SMTP (hay llave de Resend en
> `.env.local`). Es configuración del panel de Supabase.

## 0f. Séptima pasada · la lista del cliente — reunión 2026-09-19

El cliente entregó diez puntos en una reunión. No son defectos de una pantalla:
son **alcance nuevo**, y tres de ellos cambian cómo se cobra. Acá quedan
traducidos a requerimiento, con lo que se hizo y lo que falta, en sus mismas
palabras entre comillas.

| # | Lo que pidió | Qué es en realidad | Estado |
|---|---|---|---|
| 1 | «Al ingresar producto a sala de ventas sale producto inicial, no sale específico» | Felipe lo aclaró: **no se dice a dónde va cada unidad** cuando se ingresa, y hay que decirlo más simple | ✅ **0016** |
| 2 | «Agregar [el] bien que se agrega cuando se crea un producto» | Lo mismo por el otro lado: que se entienda **cuánto queda a la vista y cuánto en bodega** al crearlo | ✅ **0016** |
| 3 | «Agregar productos llegados de una factura» | Crear el producto desde la recepción, sin salir a Productos y volver | ⬜ **T-55** |
| 4 | «Boletas solo con transferencia y efectivo; con tarjeta es con máquina» | Qué documento corresponde según el medio de pago | ✅ **0015** |
| 5 | «Consultador de precio» | Pantalla de solo lectura para responder "¿cuánto vale esto?" sin tocar la venta en curso | ✅ `/precio` |
| 6 | «Con tarjeta se entrega voucher; con transferencia o efectivo, boleta y ticket» | Lo mismo que el 4, visto desde el papel | ✅ **0015** |
| 7 | «Notas de crédito para ventas» | El documento que respalda una anulación o devolución | ⬜ **T-56** |
| 8 | «Descuentos por unidades: 1 a 1.000 y desde 3 a 700» | Precio por volumen, por tramos de cantidad | ⬜ **T-57** |
| 9 | «Por predeterminado boleta, pero puedo hacer factura; con RUT, clave y firma» | Dos cosas distintas: elegir el documento con los datos del receptor (hecho), y el **certificado digital** con su clave para firmar el DTE (trámite, B-04) | 🟡 mitad ✅, mitad bloqueada |
| 10 | «Prioridad boletas y facturas» · «en el celu veo solo hasta inventario» | Prioridad, y un defecto real de navegación | ✅ los dos |

### Lo que se hizo

**Migración 0015 · el documento de cada venta.** `sales` guarda qué documento
corresponde y, si es factura, los datos del receptor. La regla la aplica
`fn_register_sale`, no la pantalla: una venta también llega desde la cola sin
conexión, y esconder un botón no es seguridad (regla 6).

- Efectivo o transferencia → **boleta**. Tarjeta → **voucher**, porque el
  documento lo emite la máquina. Factura → siempre elección explícita del
  cajero, con cualquier medio de pago, y exige RUT válido y razón social.
- Que la tarjeta emita el documento **no es una ley, es su terminal**. Un local
  con máquina no integrada sí tiene que emitir la boleta, así que es
  `tenants.settings.tarjeta_emite_documento` y no una constante (regla 13).
- El RUT se valida en la base (`fn_rut_formateado`, módulo 11) además de en
  `core`. Está repetido a propósito: un RUT inválido en una factura lo rechaza
  el SII, no nosotros.
- 13 pruebas nuevas contra PostgreSQL real y 18 en `core`.

**`/precio` · el consultador.** Lee el mismo catálogo replicado del POS, así que
responde **sin internet**. No tiene carrito: hasta ahora, para ver un precio
había que agregar el producto a la venta en curso y después vaciarla.

**La barra inferior del celular.** `navMovil` cortaba la lista en 5 y lo que
sobraba **no existía en el celular**: Proveedores, Ventas, Reportes y Usuarios
no tenían ningún camino, porque la barra lateral que los lista está oculta bajo
1024 px. Ahora el quinto lugar es "Más" y abre el resto.

**Un defecto que salió de paso.** `instalar.sql` dejaba de ser idempotente al
agregarle un parámetro a `fn_register_sale`: al reinstalar quedaban las dos
firmas y los `grant` sin lista de argumentos de 0004 fallaban con *function name
is not unique*. Lo encontró `db:test`, no la revisión. Corregido con el mismo
recurso que 0014 usó para `fn_adjust_stock`: 0002 borra antes la firma nueva.

### Lo que hay que decir, aunque no guste

**Esto no emite boletas ni facturas ante el SII, y 0015 no cambia eso.** Emitir
necesita el certificado digital del contribuyente y folios CAF autorizados
(B-04 y B-05), que son trámites con plazos ajenos. Lo que hay ahora es el
sistema sabiendo **qué documento corresponde** por cada venta, con el receptor
validado y guardado. Cuando lleguen los trámites, el timbre se le agrega encima
y ninguna de estas reglas cambia.

Mientras tanto el papel sigue diciendo `COMPROBANTE INTERNO` y
`NO ES DOCUMENTO TRIBUTARIO`, y ahora además en qué se convertirá. Un ticket que
se parece a una boleta sin serlo es un problema del contribuyente ante el SII, y
se lo habríamos causado nosotros.

**El punto 9 es dos pedidos en uno.** «RUT, clave y firma» no es la firma del
cliente en un papel: es el **certificado digital** (un archivo `.pfx` con su
clave) con el que se firma el DTE. Eso es B-04, y hoy no está.

**La app y la base se actualizan juntas.** 0015 le cambia la firma a
`fn_register_sale`. Si se despliega el código sin aplicar la migración,
**ninguna venta se registra**. Y al revés, una base con 0015 y el código viejo
manda la llamada antigua, que ya no existe.


### Puntos 1 y 2 · a dónde va cada unidad — 2026-09-20

Eran el mismo problema por dos lados. Desde 0014 el local tiene bodega y sala,
el sistema los lleva bien, y **en ninguna parte se decía a cuál entra lo que se
ingresa**: el formulario pedía "Stock inicial" a secas y todo caía en la
bodega, porque así lo decide `fn_ubicacion_por_tipo`. Quien cargaba el catálogo
creía dejarlo listo para vender, iba al POS y la sala estaba en cero.

| # | Hallazgo | Estado |
|---|---|---|
| **H-1** | **Crear un producto no preguntaba dónde queda el stock** y lo dejaba todo en bodega en silencio | ✅ 0016 · dos casillas, un movimiento por lugar |
| **H-2** | **El kardex no decía a qué lugar entró un movimiento.** Un traspaso son dos filas y las dos decían "Traspaso" | ✅ "sale de la bodega" / "entra a la sala de ventas" |
| **H-3** | **La lista de stock hablaba en jerga:** "Sala 4 · Bodega 6 · reponer" | ✅ "A la vista 4 · guardado en bodega 6 · hay que reponer" |
| **H-4** | **La maqueta repartía al revés que producción:** en demo el stock inicial quedaba todo en la **sala**, en producción todo en la **bodega**. Enseñaba lo contrario de lo que pasa | ✅ Es exactamente la pregunta de **T-15**, y confirma que `last_seen_at` no era el único |

## 1. Hallazgos transversales

Antes de las pantallas, dos problemas que aparecieron en casi todas y que se
arreglaron una sola vez, en componentes compartidos.

### X-1 · Ningún diálogo era accesible — **media** · ✅ corregido

La aplicación tenía **nueve diálogos escritos a mano**, cada uno con su propio
`<div role="dialog">`. Los nueve compartían los mismos defectos:

| Defecto | Consecuencia |
|---|---|
| No cerraban con Escape | En el mostrador se opera con prisa; un diálogo que solo se cierra apuntando a "Cancelar" se queda abierto |
| No atrapaban el foco | Tabular desde el diálogo llevaba a los botones de la pantalla de atrás —visibles, porque el fondo es semitransparente— y se podía disparar una acción sin verla |
| No devolvían el foco | Quien navega con teclado quedaba al principio de la página cada vez que cerraba algo |
| Siete de nueve, sin nombre accesible | Un lector de pantalla anunciaba "diálogo" y nada más |
| El fondo se desplazaba | En el celular, arrastrar movía la página de atrás y el diálogo quedaba flotando sobre otra cosa |

**Corregido** con `apps/web/src/components/Modal.tsx`, que resuelve los cinco y
exige el título como propiedad obligatoria. Los nueve diálogos lo usan.

Incorpora `bloqueado`: mientras una operación ya salió hacia la base —confirmar
una recepción, cerrar una caja— el diálogo no se cierra ni con Escape ni tocando
el fondo. Cancelar a medias no cancela nada en el servidor: solo le esconde el
resultado al usuario.

### X-2 · Trece etiquetas que no eran etiquetas — **media** · ✅ corregido

Había trece `<label>` dibujados encima de su campo pero **sin `htmlFor`**: se
ven como etiquetas y no lo son. Consecuencias:

- El lector de pantalla anuncia "cuadro de texto, en blanco". El usuario no sabe
  si está escribiendo el precio o el costo.
- Tocar la etiqueta no enfoca el campo. En un celular, esa es la mitad del área
  útil del campo.

El caso más engañoso estaba en el formulario de producto: tenía un componente
`Campo` propio que *parecía* resolverlo y dibujaba la etiqueta y el control como
hermanos, sin enlazarlos.

**Corregido** con `apps/web/src/components/Campo.tsx`, que genera el `id` con
`useId` y se lo entrega al control, así que el enlace no depende de que alguien
se acuerde de escribirlo. Además conecta el mensaje de error por
`aria-describedby` y marca `aria-invalid`: el error se anuncia al llegar al
campo, no solo al intentar guardar.

---

## 2. Proveedores

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| P-1 | **No se puede desactivar un proveedor.** El modelo de datos lo soporta; la pantalla no ofrece la acción | Media | ⬜ Pendiente |
| P-2 | Anular una recepción no tenía candado contra el doble toque. Anular devuelve stock: dos toques en un celular lento mandaban dos anulaciones | Media | ✅ |
| P-3 | Los cinco campos del formulario de proveedor solo tenían `placeholder` | Baja | ✅ |
| P-4 | El correo no se validaba de ninguna forma | Baja | ✅ |
| P-5 | Sin buscador ni paginación, ni en proveedores ni en recepciones. Mismo caso que M-5 | Media | ⬜ Pendiente |
| P-6 | El título de la pantalla dice "Compras" y la navegación dice "Proveedores" | Baja | ⬜ Pendiente |

**Sobre P-1:** el documento del cliente afirmaba que se podía desactivar un
proveedor. No es cierto y ya se corrigió el documento (commit `f1930b1`). Esa
frase estaba escrita mirando el modelo de datos, no la interfaz — el mismo error
que produjo el hallazgo 1.1 de la primera pasada.

---

## 3. Importar (carga masiva)

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| I-1 | **El contrato mentía.** `importarLote` estaba documentada como "Carga masiva. Todo o nada" y ninguna de las dos implementaciones es atómica: aplica fila por fila. Si la fila 300 falla, las 299 anteriores ya están en el catálogo | Alta | ✅ |
| I-2 | Los errores por fila mostraban el mensaje técnico crudo. El almacenero que sube su planilla leía *"duplicate key value violates unique constraint product_barcodes_tenant_id_barcode_key"* | Media | ✅ |
| I-3 | Sin tope de tamaño de archivo. `file.text()` carga todo en memoria y el parseo corre en el hilo principal: un archivo grande congela el celular sin ningún mensaje | Media | ✅ |
| I-4 | Sin ningún avance durante la carga. 600 productos por 4G son minutos de pantalla quieta; el usuario cierra creyendo que se colgó, y lo que ya entró queda entrado | Media | ✅ |
| I-5 | `URL.revokeObjectURL` se llamaba en la misma vuelta que el clic. Es una carrera: en Safari de iPhone la descarga de la plantilla se cancela antes de empezar | Baja | ✅ |
| I-6 | La plantilla CSV salía sin BOM: Excel la abría en ANSI y los acentos de "Categoría" salían rotos | Baja | ✅ |

**Sobre I-1:** el comentario ahora dice lo que el código hace, la pantalla avisa
que *"los productos ya cargados se quedan cargados"*, y hay una barra de avance.
Hacer la carga atómica de verdad pide una función transaccional en la base, como
`fn_create_product`. Queda anotado en el cronograma, no resuelto.

---

## 4. Formulario de producto

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| F-1 | `parseCLP` se usaba para leer **cantidades**, y borra todo lo que no sea dígito: un stock mínimo de "1,5" kg se guardaba como 15 | Alta | ✅ |
| F-2 | Al editar con el campo costo en blanco se enviaba 0, y `actualizar` lo escribe tal cual. Cambiar el nombre de un producto le dejaba el costo promedio en cero, y con él el margen y el inventario valorizado | Alta | ✅ |
| F-3 | **`actualizar` no es atómica.** Borra todos los códigos de barra y los reinserta. Si la inserción falla —porque otro producto tomó ese código— el producto queda **sin ningún código**, que es justo el que no aparecerá al escanear. Es A-4 en la edición, y `fn_create_product` no lo cubre | Alta | ⬜ Pendiente |
| F-4 | Las etiquetas del formulario no estaban asociadas a sus campos (ver X-2) | Media | ✅ |
| F-5 | Los campos de cantidad usaban `inputMode="numeric"`, que en el teclado del celular no ofrece coma decimal — el mismo producto no se podía escribir a mano | Baja | ✅ |

**Sobre F-3:** es el hallazgo abierto más grave de esta pasada. El modo de falla
es idéntico al de A-4 y deja al producto invisible al escáner, que es la forma
principal de venderlo. Corresponde una `fn_update_product` transaccional.

---

## 5. Ingreso (login)

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| L-1 | **Redirección abierta.** El parámetro `next` viajaba sin filtrar desde la URL al router. Un enlace con `?next=https://sitio-falso.cl` sacaba al usuario del sitio justo después de autenticarse de verdad, que es cuando menos sospecha | Alta | ✅ |
| L-2 | El primer filtro seguía dejando pasar tres variantes: la barra invertida (`/\sitio.cl`), que el navegador normaliza a barra; y el tabulador o el salto de línea entre las dos barras, que desaparecen al normalizar la URL | Alta | ✅ |
| L-3 | El texto prometía que el administrador podía restablecer la contraseña. No puede: RF-M1-05 no existe, no hay pantalla, y reinvitar a alguien con cuenta falla en Supabase Auth | Media | ✅ |
| L-4 | El botón Ver/Ocultar contraseña no tenía nombre accesible ni estado | Baja | ✅ |
| L-5 | **RF-M1-05 (recuperar contraseña) no existe.** Hoy un vendedor que olvida su clave depende de que el dueño la resetee a mano en el panel de Supabase | Media | ⬜ Pendiente |

**Sobre L-1 y L-2:** la función vive ahora en `packages/core/src/destino.ts` con
**17 pruebas**, y no en la pantalla. Un arreglo de seguridad sin prueba es un
arreglo que vuelve en el próximo refactor.

---

## 5b. Inicio

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| I-1 | **Los tres errores de consulta se ignoraban en silencio.** `const { data }` sin mirar `error`: si la consulta fallaba, el panel mostraba ceros. Un problema de red se veía exactamente igual que un día sin ventas, y el dueño leía "Vendido hoy $0" y concluía que no se había vendido nada | Alta | ✅ |
| I-2 | **El día se calculaba con el desfase `-03:00` escrito fijo**, y Chile está en `-04:00` medio año. En invierno el "día de hoy" empezaba a las 23:00 de ayer y terminaba a las 22:59: lo vendido después de las 23:00 aparecía al día siguiente. La fecha sí se calculaba bien, con `timeZone: 'America/Santiago'`, y el desfase iba a mano al lado. `v_sales_daily` ya agrupaba correctamente desde 0005 y nadie la usaba | Media | ✅ |
| I-3 | **Los dos paneles hacían `.limit(8)` sin `order by`.** Sin orden, PostgreSQL devuelve las ocho filas que quiera: el dueño veía ocho productos bajo mínimo que no eran los ocho más urgentes, y que cambiaban de una recarga a otra sin que nada hubiera pasado. `v_low_stock` ya traía la columna `shortfall`, tampoco usada. Tampoco decía cuántos más había | Media | ✅ |
| I-4 | **La unidad estaba escrita a mano como "u".** El queso, el pan y la fruta se venden por kilo y son justo los perecibles que llevan lote: "2.5 u" de queso no significa nada. Y "vence en 1 días" | Baja | ✅ |

---

## 5c. Usuarios

Además de S-2, que salió de acá y está en la sección 0.

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| U-2 | **"Conectado ahora" no funcionaba en producción.** `last_seen_at` está en la tabla desde el primer día y **nadie la escribía**. La pantalla la lee para decir quién está conectado y cuándo entró por última vez, así que todos aparecían como "Nunca ha entrado · Desconectado", para siempre. Se veía bien **solo en modo demo**, porque los datos de ejemplo traen la hora ya puesta: RF-M1-14 figuraba cumplido y lo único que funcionaba era la maqueta | Alta | ✅ |
| U-3 | **El último administrador podía quedarse afuera.** La pantalla no deja cambiarse el rol ni desactivarse a uno mismo, y lo explica bien en un comentario. Pero eso es la pantalla, y la regla del proyecto es que esconder un botón no es seguridad: la misma llamada por fuera pasaba igual. Un local sin administrador activo no se arregla desde el sistema | Media | ✅ (en 0011, con S-2) |
| U-4 | **El tope de descuento por rol estaba escrito en el navegador.** RF-M9-08 pide que sea configurable por local, y `tenants.settings.max_discount_pct` lo guarda desde el primer día —con los mismos números que estaban a mano— sin que nadie lo leyera | Media | ✅ |
| U-5 | La invitación no valida que el correo no esté ya en el local antes de llamar al servidor; el error vuelve traducido, pero después del viaje | Baja | ⬜ |

---

## 6. Hallazgos nuevos en pantallas ya auditadas

Aparecieron revisando otra cosa. Se anotan igual.

| # | Pantalla | Hallazgo | Severidad | Estado |
|---|---|---|---|---|
| R-1 | Recepción | **La cantidad se guardaba como número y `Number("1,")` es `NaN`.** Escribir una cantidad con coma decimal —lo normal en Chile— hacía saltar el campo a 0 en mitad del tecleo: no había forma de recibir media unidad | Alta | ✅ |
| R-2 | Recepción | M-6 de la primera pasada: se podía confirmar con costo unitario 0 sin ningún aviso | Media | ✅ |
| R-3 | Recepción | Las cuatro etiquetas por línea se repetían idénticas en cada fila. Tabulando por veinte productos, "Cantidad" veinte veces no dice dónde está uno parado | Baja | ✅ |
| Q-1 | Productos | B-4 era peor de lo anotado: `puedeBorrarDef` conservaba el valor del producto **anterior**, así que el diálogo ofrecía "Eliminar definitivamente" para un producto que sí tenía ventas. La base lo rechazaba, pero la pantalla ya había mentido | Media | ✅ |
| Q-2 | Productos | Ninguna acción del diálogo tenía candado contra el doble toque | Baja | ✅ |
| U-0 | Usuarios | El grupo de radios del rol usaba un `<span>` en vez de `fieldset`/`legend`: el lector leía las cuatro opciones sueltas, sin decir de qué eran | Baja | ✅ |

---

## 7. Estado de los hallazgos de la primera pasada

| # | Hallazgo | Estado |
|---|---|---|
| A-1 | La toma no pedía confirmación | ✅ Diálogo de revisión previa |
| A-2 | La toma aplicaba conteos de productos ocultos por el filtro | ✅ La revisión los lista todos |
| A-3 | `parseCLP` aceptaba negativos en campos de dinero | ✅ `validarMonto` |
| A-4 | El alta de producto no era atómica | ✅ `fn_create_product` (migración 0007) |
| M-1 | No se puede corregir un movimiento de caja mal ingresado | ⬜ Pendiente · se advierte antes de registrar |
| M-2 | "Cerrar caja" no advertía que el cierre es irreversible | ✅ Aviso explícito en la pantalla de cierre |
| M-3 | El ajuste aceptaba cantidades negativas | ✅ `validarCantidad` |
| M-4 | El kardex trae 80 movimientos fijos, sin filtros ni paginación | ⬜ Pendiente |
| M-5 | Productos sin paginación | ⬜ Pendiente · depende de P-02 |
| M-6 | Recepción con costo 0 sin aviso | ✅ (ver R-2) |
| M-7 | M4-16 (stock por lote) figura ✅ y el listado no muestra lotes | ✅ **Verificado el 2026-09-17: no existía.** La base sí mantiene el stock por lote y las dos vistas estaban escritas; ninguna pantalla las leía. Hoy hay pestaña Lotes en Inventario |
| B-1 | "Reactivar" usaba el color de alerta | ✅ |
| B-2 | Los campos de movimiento de caja sin `<label>` | ✅ |
| B-3 | El diálogo de ajuste sin nombre accesible | ✅ (ver X-1) |
| B-4 | Sin estado de carga al abrir la confirmación de baja | ✅ (ver Q-1) |

---

## 8. Funciones de base sin pantalla

Las tres se cerraron el 2026-09-17, y con ellas las siete vistas de reportes,
que eran el caso más caro: existían desde la migración 0005 sin que ninguna
pantalla las consultara.

| Función o vista | Requerimiento | Estado |
|---|---|---|
| `fn_void_sale` | M5-15 · Anular venta | ✅ Pantalla `/ventas` |
| `fn_write_off_lot` | M4-19 · Dar de baja lote vencido | ✅ Pestaña Lotes en Inventario |
| `fn_close_cash_session` de otro | M6-10 · Cierre forzado | ✅ En Caja |
| `v_sales_daily` | M7-02 | ✅ `/reportes` |
| `v_sales_by_user` | M7-03 | ✅ `/reportes` |
| `v_sales_by_product` | M7-04, M7-06 | ✅ `/reportes` |
| `v_inventory_valued` | M7-05 | ✅ `/reportes` |
| `v_stale_products` | M7-07 | ✅ `/reportes` |
| `v_adjustments` | M7-08 | ✅ `/reportes` |
| `v_stock_by_lot`, `v_expiring_lots` | M4-16 | ✅ Pestaña Lotes |

Queda una sola: `fn_next_folio` y `fn_post_movement` no tienen pantalla **a
propósito**, y desde 0009 tampoco tienen permiso para tenerla.

---

## 9. Lo que quedó bien

No todo son hallazgos. Estas decisiones resistieron las dos revisiones:

- **El enlace producto ↔ código de barra está correcto en la base:** FK con
  borrado en cascada, `unique (tenant_id, barcode)` haciendo cumplir RF-M2-03,
  índice por producto y RLS activa.
- **Importar valida antes de tocar nada.** El paso de revisión muestra el error
  con su número de fila y su columna, y no carga ni un producto si hay errores.
  La validación de dígito EAN y la detección de repetidos dentro del archivo
  funcionan.
- **Recepción** exige la fecha de vencimiento en perecibles y bloquea la
  confirmación mientras falte, con el conteo de cuántos faltan a la vista.
- **Productos** distingue desactivar de eliminar, y solo ofrece eliminar cuando
  el producto no tiene historial.
- **El login no revela si un correo existe.** El mensaje es el mismo para
  usuario inexistente y contraseña equivocada: sin eso se pueden enumerar los
  usuarios del sistema.
- **Inventario** explica en pantalla por qué el kardex no se edita.
- **Caja** exige comentario cuando hay diferencia y no deja cerrar sin él.
- Los estados de stock usan color **y** texto, no solo color (RNF-46).

---

## 10. Cómo seguir

Tras la tercera pasada, por severidad:

1. **T-14 — `unit_price` sin comparar con el catálogo.** Es lo que queda
   abierto de S-4: el tope de descuento se puede rodear vendiendo a precio 1.
2. **T-40 — los casos CP-01 a CP-08 de concurrencia siguen sin ejecutarse.**
   Siete requerimientos marcados como hechos que descansan en diseño y no en
   pruebas. Dos cajeros vendiendo el último producto al mismo tiempo no se ha
   probado nunca. Pesa más que todo lo demás de esta lista.
3. **M-1 — corregir un movimiento de caja** mal ingresado.
4. **L-5 — recuperar contraseña (RF-M1-05).** Hoy el dueño entra al panel de
   Supabase cada vez que un vendedor olvida su clave.
5. **M-4, M-5, P-1, P-5, P-6, I-1 de importar** — pantalla por pantalla, sin
   urgencia.

### Lo que esta pasada enseña sobre el método

Los tres hallazgos más graves de hoy —S-1, S-2 y U-2— tienen la misma forma:
**la pieza existía, estaba bien escrita, y no estaba conectada con nada.** Un
`revoke` que no revocaba, una política que protegía la fila equivocada, una
columna que nadie escribía. Ninguno se ve leyendo el código de una pantalla, y
ninguno se ve leyendo el código de la base: se ven siguiendo un dato de punta a
punta y preguntando quién lo escribe y quién puede escribirlo.

Y U-2 agrega algo peor: **el modo demo lo tapaba.** Los datos de ejemplo traen
`last_seen_at` con la hora puesta, así que la pantalla se veía perfecta y el
requerimiento figuraba cumplido. Cada vez que el modo demo rellena un dato que
en producción nadie escribe, esconde exactamente el defecto que debería
mostrar. Vale la pena revisar el resto de los datos de ejemplo con esa
pregunta.
