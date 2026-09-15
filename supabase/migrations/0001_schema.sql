-- ============================================================================
-- RutaAhorro · 0001 · Esquema base
-- Tablas, tipos e índices. Ver docs/06-modelo-datos.md
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin','supervisor','vendedor','bodega');
exception when duplicate_object then null; end $$;

do $$ begin
  create type movement_type as enum (
    'inventario_inicial','venta','anulacion_venta','recepcion',
    'anulacion_recepcion','ajuste_positivo','ajuste_negativo','merma',
    'toma_inventario');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('efectivo','debito','credito','transferencia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_status as enum ('completada','anulada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_status as enum ('abierta','cerrada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_movement_type as enum ('ingreso','egreso');
exception when duplicate_object then null; end $$;

do $$ begin
  create type receipt_status as enum ('confirmada','anulada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type count_status as enum ('en_progreso','aplicada','anulada');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Núcleo multi-tenant
-- ---------------------------------------------------------------------------
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  rut         text,
  plan        text not null default 'completo',
  status      text not null default 'activo'
              check (status in ('activo','suspendido','cancelado')),
  settings    jsonb not null default jsonb_build_object(
                'iva_pct', 19,
                'timezone', 'America/Santiago',
                'currency', 'CLP',
                'max_discount_pct', jsonb_build_object(
                  'admin', 100, 'supervisor', 10, 'vendedor', 0, 'bodega', 0),
                'cash_alert_hours', 12,
                'cost_variation_alert_pct', 20
              ),
  created_at  timestamptz not null default now()
);

create table if not exists stores (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  address     text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_stores_tenant on stores(tenant_id);

create table if not exists profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  tenant_id         uuid not null references tenants(id) on delete cascade,
  store_id          uuid references stores(id) on delete set null,
  full_name         text not null default '',
  email             text,
  role              user_role not null default 'vendedor',
  is_active         boolean not null default true,
  max_discount_pct  numeric(5,2) not null default 0,
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists idx_profiles_tenant on profiles(tenant_id);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  sku          text,
  name         text not null,
  description  text,
  category_id  uuid references categories(id) on delete set null,
  unit         text not null default 'unidad',
  sale_price   integer not null default 0 check (sale_price >= 0),
  avg_cost     integer not null default 0 check (avg_cost >= 0),
  last_cost    integer not null default 0 check (last_cost >= 0),
  min_stock    numeric(14,3) not null default 0 check (min_stock >= 0),
  image_url    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, sku)
);
create index if not exists idx_products_tenant_active
  on products(tenant_id, is_active) where is_active;
create index if not exists idx_products_name_trgm
  on products using gin (to_tsvector('spanish', name));
create index if not exists idx_products_category on products(category_id);

create table if not exists product_barcodes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  barcode     text not null,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (tenant_id, barcode)   -- RF-M2-03
);
create index if not exists idx_barcodes_product on product_barcodes(product_id);

create table if not exists price_history (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  old_price   integer not null,
  new_price   integer not null,
  reason      text,
  changed_by  uuid references profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index if not exists idx_price_history_product
  on price_history(product_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Proveedores y compras
-- ---------------------------------------------------------------------------
create table if not exists suppliers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  name          text not null,
  rut           text,
  contact_name  text,
  phone         text,
  email         text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_suppliers_tenant on suppliers(tenant_id);

create table if not exists product_suppliers (
  product_id   uuid not null references products(id) on delete cascade,
  supplier_id  uuid not null references suppliers(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  supplier_sku text,
  last_cost    integer,
  primary key (product_id, supplier_id)
);

create table if not exists purchase_receipts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  store_id         uuid not null references stores(id) on delete cascade,
  supplier_id      uuid references suppliers(id) on delete set null,
  document_type    text not null default 'guia'
                   check (document_type in ('guia','factura','boleta','sin_documento')),
  document_number  text,
  received_at      timestamptz not null default now(),
  total_amount     integer not null default 0,
  status           receipt_status not null default 'confirmada',
  notes            text,
  created_by       uuid references profiles(id) on delete set null,
  voided_by        uuid references profiles(id) on delete set null,
  voided_at        timestamptz,
  void_reason      text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_receipts_tenant_date
  on purchase_receipts(tenant_id, received_at desc);

create table if not exists purchase_receipt_items (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references purchase_receipts(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  product_id  uuid not null references products(id) on delete restrict,
  quantity    numeric(14,3) not null check (quantity > 0),
  unit_cost   integer not null check (unit_cost >= 0),
  subtotal    integer not null default 0
);
create index if not exists idx_receipt_items_receipt on purchase_receipt_items(receipt_id);

-- ---------------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------------
create table if not exists stock_levels (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  store_id    uuid not null references stores(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  quantity    numeric(14,3) not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, store_id, product_id)
);
create index if not exists idx_stock_levels_product on stock_levels(product_id);

-- Kardex: INMUTABLE. Ver ADR-006.
create table if not exists inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  store_id        uuid not null references stores(id) on delete cascade,
  product_id      uuid not null references products(id) on delete restrict,
  movement_type   movement_type not null,
  quantity        numeric(14,3) not null,   -- con signo: + entra, - sale
  balance_after   numeric(14,3) not null,
  unit_cost       integer not null default 0,
  reference_type  text,
  reference_id    uuid,
  reason          text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_movements_product_date
  on inventory_movements(tenant_id, product_id, created_at desc);
create index if not exists idx_movements_reference
  on inventory_movements(reference_type, reference_id);
create index if not exists idx_movements_tenant_date
  on inventory_movements(tenant_id, created_at desc);

create table if not exists stock_counts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  category_id  uuid references categories(id) on delete set null,
  status       count_status not null default 'en_progreso',
  notes        text,
  started_by   uuid references profiles(id) on delete set null,
  started_at   timestamptz not null default now(),
  applied_at   timestamptz
);

create table if not exists stock_count_items (
  id          uuid primary key default gen_random_uuid(),
  count_id    uuid not null references stock_counts(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  system_qty  numeric(14,3) not null default 0,
  counted_qty numeric(14,3) not null default 0,
  difference  numeric(14,3) generated always as (counted_qty - system_qty) stored,
  counted_at  timestamptz not null default now(),
  unique (count_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------------
create table if not exists cash_sessions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  store_id         uuid not null references stores(id) on delete cascade,
  user_id          uuid not null references profiles(id) on delete restrict,
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  opening_amount   integer not null default 0 check (opening_amount >= 0),
  expected_amount  integer,
  counted_amount   integer,
  difference       integer generated always as (counted_amount - expected_amount) stored,
  status           cash_status not null default 'abierta',
  closing_notes    text,
  closed_by        uuid references profiles(id) on delete set null
);
-- RF-M6-09: una sola caja abierta por usuario
create unique index if not exists one_open_session_per_user
  on cash_sessions(user_id) where status = 'abierta';
create index if not exists idx_cash_sessions_tenant
  on cash_sessions(tenant_id, opened_at desc);

create table if not exists cash_movements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  cash_session_id   uuid not null references cash_sessions(id) on delete cascade,
  type              cash_movement_type not null,
  amount            integer not null check (amount > 0),
  reason            text not null,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_cash_movements_session on cash_movements(cash_session_id);

-- ---------------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------------
create table if not exists sales (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  store_id         uuid not null references stores(id) on delete cascade,
  folio            bigint not null,
  cash_session_id  uuid references cash_sessions(id) on delete set null,
  sold_by          uuid references profiles(id) on delete set null,
  sold_at          timestamptz not null default now(),   -- hora REAL de la venta
  synced_at        timestamptz not null default now(),   -- llegada al servidor
  subtotal         integer not null default 0,
  discount_total   integer not null default 0,
  total            integer not null default 0,
  tax_amount       integer not null default 0,
  status           sale_status not null default 'completada',
  notes            text,
  client_uuid      uuid not null,                        -- idempotencia offline
  voided_by        uuid references profiles(id) on delete set null,
  voided_at        timestamptz,
  void_reason      text,
  unique (tenant_id, folio),
  unique (tenant_id, client_uuid)                        -- US-15
);
create index if not exists idx_sales_tenant_date on sales(tenant_id, sold_at desc);
create index if not exists idx_sales_session on sales(cash_session_id);
create index if not exists idx_sales_user on sales(sold_by, sold_at desc);

create table if not exists sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references sales(id) on delete cascade,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  product_id       uuid not null references products(id) on delete restrict,
  product_name     text not null,               -- copia congelada
  quantity         numeric(14,3) not null check (quantity > 0),
  unit_price       integer not null,            -- copia congelada
  unit_cost        integer not null default 0,  -- copia congelada
  discount_amount  integer not null default 0,
  subtotal         integer not null
);
create index if not exists idx_sale_items_sale on sale_items(sale_id);
create index if not exists idx_sale_items_product on sale_items(product_id, sale_id);

create table if not exists sale_payments (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references sales(id) on delete cascade,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  method           payment_method not null,
  amount           integer not null check (amount > 0),
  received_amount  integer,
  change_amount    integer not null default 0
);
create index if not exists idx_sale_payments_sale on sale_payments(sale_id);

-- Correlativo de folio por tenant
create table if not exists folio_counters (
  tenant_id   uuid primary key references tenants(id) on delete cascade,
  last_folio  bigint not null default 0
);

-- ---------------------------------------------------------------------------
-- Transversales
-- ---------------------------------------------------------------------------
-- Bitácora: INMUTABLE
create table if not exists audit_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  user_id      uuid references profiles(id) on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  old_values   jsonb,
  new_values   jsonb,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_tenant_date on audit_log(tenant_id, created_at desc);
create index if not exists idx_audit_user on audit_log(user_id, created_at desc);

create table if not exists alerts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  type        text not null,
  severity    text not null default 'info' check (severity in ('info','warning','critical')),
  payload     jsonb not null default '{}'::jsonb,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  read_by     uuid references profiles(id) on delete set null
);
create index if not exists idx_alerts_tenant_unread
  on alerts(tenant_id, created_at desc) where not is_read;

-- Registro de ejecución de trabajos programados (worker Railway)
create table if not exists job_runs (
  id            uuid primary key default gen_random_uuid(),
  job_name      text not null,
  status        text not null check (status in ('ok','error','running')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  details       jsonb,
  error_message text
);
create index if not exists idx_job_runs_name on job_runs(job_name, started_at desc);
