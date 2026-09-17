-- ============================================================================
-- 0011 · Un vendedor no puede hacerse administrador, y el tope de descuento
--        existe en la base
--
-- Dos agujeros en el mismo lugar: los permisos estaban escritos donde no se
-- pueden hacer cumplir.
--
-- ---------------------------------------------------------------------------
-- 1. Escalada de privilegios
-- ---------------------------------------------------------------------------
-- La política de 0004 decía:
--
--   create policy profiles_update on profiles for update to authenticated
--     using (tenant_id = current_tenant_id()
--            and (current_user_role() = 'admin' or id = auth.uid()))
--     with check (tenant_id = current_tenant_id());
--
-- El `id = auth.uid()` estaba para que cada uno pudiera corregir su propio
-- nombre. Pero RLS trabaja por fila, no por columna: quien puede actualizar su
-- fila puede actualizar **cualquier columna** de su fila. Y en esa fila están
-- `role` y `max_discount_pct`. Un vendedor, desde el navegador y sin ninguna
-- herramienta especial:
--
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', miId)
--
-- El `with check` no lo impedía porque solo miraba el tenant, que no cambia. Y
-- el disparador de auditoría lo registraba, pero registrar no es impedir: para
-- cuando alguien lee el registro, el vendedor ya es administrador.
--
-- La corrección es un disparador y no una política porque lo que hay que
-- distinguir es *qué columna* cambió, y eso RLS no lo sabe.
--
-- ---------------------------------------------------------------------------
-- 2. El último administrador
-- ---------------------------------------------------------------------------
-- La pantalla no deja que uno se desactive ni se cambie el rol a sí mismo, y
-- el comentario del código lo explica bien. Pero eso es la pantalla: la misma
-- llamada hecha por fuera pasaba igual, y la regla 6 del proyecto es que
-- esconder un botón no es seguridad. Un local sin administrador activo no se
-- arregla desde el sistema: hay que entrar al panel de Supabase.
--
-- ---------------------------------------------------------------------------
-- 3. El tope de descuento no se aplicaba en ninguna parte
-- ---------------------------------------------------------------------------
-- `DESCUENTO_EXCEDE_LIMITE` estaba en la tabla de errores desde el primer día.
-- `profiles.max_discount_pct` estaba en el esquema. `discountWithinLimit`
-- estaba en core, probado. Y `fn_register_sale` **nunca leía el tope**: el
-- `discount_amount` de cada línea entraba tal como lo mandara el cliente.
-- Los tres pedazos existían y ninguno estaba conectado con otro.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 y 2 · Guardia de privilegios en el perfil
-- ---------------------------------------------------------------------------
create or replace function public.fn_guard_profile_privileges()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_rol    text := coalesce(current_user_role()::text, '');
  v_actor  uuid := auth.uid();
  v_admins integer;
begin
  -- Sin sesión de usuario no hay a quién vigilar: es `service_role`, o sea el
  -- worker o un script de mantención, que por definición ya tiene todo. `anon`
  -- no llega acá porque la política de UPDATE es solo para `authenticated`.
  if v_actor is null then
    return new;
  end if;

  -- Cambiar de local es cambiar de dueño: no se hace editando una fila.
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  if new.role            is distinct from old.role
  or new.is_active       is distinct from old.is_active
  or new.max_discount_pct is distinct from old.max_discount_pct
  or new.store_id        is distinct from old.store_id then

    if v_rol <> 'admin' then
      raise exception 'SIN_PERMISO' using errcode = '42501';
    end if;

    -- Un administrador tampoco se cambia el rol ni se desactiva a sí mismo.
    -- Con un solo administrador en el local, hacerlo deja a todos afuera de
    -- la pantalla de usuarios y no hay forma de volver desde el sistema.
    if new.id = v_actor
       and (new.role is distinct from old.role
            or new.is_active is distinct from old.is_active) then
      raise exception 'NO_TE_PUEDES_QUITAR_EL_ROL' using errcode = 'P0001';
    end if;

    -- Y no se puede dejar el local sin ningún administrador activo, aunque la
    -- operación sea sobre otra persona.
    if (old.role = 'admin' and old.is_active)
       and (new.role <> 'admin' or not new.is_active) then
      select count(*) into v_admins
        from profiles
       where tenant_id = old.tenant_id and role = 'admin' and is_active
         and id <> old.id;
      if v_admins = 0 then
        raise exception 'ULTIMO_ADMIN' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end $$;

comment on function public.fn_guard_profile_privileges is
  'Impide que alguien se cambie su propio rol o tope de descuento, y que el local quede sin administrador. Ver docs/21 U-1 y U-3.';

-- BEFORE y no AFTER: tiene que poder cancelar la escritura, no comentarla.
-- Va antes que trg_audit_profile por orden alfabético del nombre, que es como
-- PostgreSQL desempata: así no se audita un cambio que no ocurrió.
drop trigger if exists trg_guard_profile on profiles;
create trigger trg_guard_profile
  before update on profiles
  for each row execute function public.fn_guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- 3 · El tope de descuento
-- ---------------------------------------------------------------------------
-- `fn_discount_within_limit` y la comprobación viven en 0006, junto a
-- `fn_register_sale`, que es quien la llama: una función tiene que existir
-- antes que quien la usa, y el instalador aplica las migraciones en orden.
