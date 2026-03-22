-- ============================================
-- SCANWMS Database Setup (v2 — corrected order)
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. CREATE ALL TABLES

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  warehouse_id text,
  created_at timestamptz default now()
);

create table if not exists customer_users (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  email text not null,
  role text default 'user',
  created_at timestamptz default now()
);

create table if not exists subklanten (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists hubs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  carrier text,
  active boolean default true
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  subklant_id uuid references subklanten(id),
  mawb text not null,
  transport_type text default 'AIR',
  colli_expected integer,
  chargeable_weight numeric,
  warehouse_id text,
  status text default 'Created',
  parcels integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists noas (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  noa_number integer default 1,
  colli integer,
  weight numeric,
  received_at timestamptz default now(),
  file_path text,
  created_by text
);

create table if not exists shipment_status_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  status text,
  changed_by text,
  changed_at timestamptz default now(),
  notes text
);

create table if not exists outbounds (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  hub_id uuid references hubs(id),
  truck_reference text,
  pickup_date date,
  status text default 'planned'
);

create table if not exists pallets (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  outbound_id uuid references outbounds(id),
  pallet_number text,
  pieces integer,
  weight numeric,
  status text default 'Palletized',
  created_at timestamptz default now()
);

create table if not exists outerboxes (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  barcode text,
  status text default 'expected',
  scanned_in_at timestamptz,
  scanned_out_at timestamptz,
  pallet_id uuid references pallets(id)
);

create table if not exists shipment_files (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  file_type text,
  storage_path text,
  uploaded_at timestamptz default now()
);

create table if not exists clearances (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  colli_cleared integer default 0,
  status text default 'pending',
  cleared_at timestamptz,
  cleared_by text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists inspections (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  parcel_barcode text not null,
  status text default 'under_inspection',
  confirmed_at timestamptz,
  confirmed_by text,
  created_at timestamptz default now()
);

-- 2. ENABLE RLS

alter table customers enable row level security;
alter table customer_users enable row level security;
alter table subklanten enable row level security;
alter table hubs enable row level security;
alter table shipments enable row level security;
alter table noas enable row level security;
alter table shipment_status_history enable row level security;
alter table outbounds enable row level security;
alter table pallets enable row level security;
alter table outerboxes enable row level security;
alter table shipment_files enable row level security;
alter table clearances enable row level security;
alter table inspections enable row level security;

-- 3. SECURITY DEFINER FUNCTIONS (bypass RLS to avoid recursion)

-- Returns the customer_id for the current authenticated user
create or replace function public.get_my_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select customer_id
  from public.customer_users
  where email = (select auth.jwt()->>'email')
  limit 1
$$;

-- Returns shipment IDs belonging to the current user's customer
create or replace function public.get_my_shipment_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.shipments
  where customer_id = public.get_my_customer_id()
$$;

-- 4. RLS POLICIES (all using security definer functions, no nested RLS)

drop policy if exists "Users can view their own customer" on customers;
create policy "Users can view their own customer" on customers for select to authenticated
  using (id = public.get_my_customer_id());

drop policy if exists "Users can view their own record" on customer_users;
create policy "Users can view their own record" on customer_users for select to authenticated
  using (email = (select auth.jwt()->>'email'));

drop policy if exists "Users can view own subklanten" on subklanten;
create policy "Users can view own subklanten" on subklanten for select to authenticated
  using (customer_id = public.get_my_customer_id());

drop policy if exists "Authenticated users can view hubs" on hubs;
create policy "Authenticated users can view hubs" on hubs for select to authenticated using (true);

drop policy if exists "Users can view own shipments" on shipments;
create policy "Users can view own shipments" on shipments for select to authenticated
  using (customer_id = public.get_my_customer_id());

drop policy if exists "Users can insert own shipments" on shipments;
create policy "Users can insert own shipments" on shipments for insert to authenticated
  with check (customer_id = public.get_my_customer_id());

drop policy if exists "Users can view own noas" on noas;
create policy "Users can view own noas" on noas for select to authenticated
  using (shipment_id in (select public.get_my_shipment_ids()));

drop policy if exists "Users can view own status history" on shipment_status_history;
create policy "Users can view own status history" on shipment_status_history for select to authenticated
  using (shipment_id in (select public.get_my_shipment_ids()));

drop policy if exists "Users can view own outbounds" on outbounds;
create policy "Users can view own outbounds" on outbounds for select to authenticated
  using (shipment_id in (select public.get_my_shipment_ids()));

drop policy if exists "Users can view own pallets" on pallets;
create policy "Users can view own pallets" on pallets for select to authenticated
  using (shipment_id in (select public.get_my_shipment_ids()));

drop policy if exists "Users can view own outerboxes" on outerboxes;
create policy "Users can view own outerboxes" on outerboxes for select to authenticated
  using (shipment_id in (select public.get_my_shipment_ids()));

drop policy if exists "Users can view own files" on shipment_files;
create policy "Users can view own files" on shipment_files for select to authenticated
  using (shipment_id in (select public.get_my_shipment_ids()));

drop policy if exists "Users can view own clearances" on clearances;
create policy "Users can view own clearances" on clearances for select to authenticated
  using (shipment_id in (select public.get_my_shipment_ids()));

drop policy if exists "Users can view own inspections" on inspections;
create policy "Users can view own inspections" on inspections for select to authenticated
  using (shipment_id in (select public.get_my_shipment_ids()));

-- ============================================
-- 5. SAMPLE DATA
-- ============================================
-- First create a test user in Supabase Auth:
-- Email: demo@scanwms.com, Password: demo1234

do $$
declare
  v_customer_id uuid;
  v_sub1 uuid;
  v_sub2 uuid;
  v_hub1 uuid;
  v_hub2 uuid;
  v_hub3 uuid;
  v_ship1 uuid;
  v_ship2 uuid;
  v_ship3 uuid;
  v_ship4 uuid;
  v_ship5 uuid;
  v_ob1 uuid;
  v_ob2 uuid;
  v_ob3 uuid;
begin
  -- Customer
  insert into customers (name, warehouse_id) values ('ACME Logistics BV', 'AMS-01') returning id into v_customer_id;
  insert into customer_users (customer_id, email, role) values (v_customer_id, 'demo@scanwms.com', 'admin');

  -- Subklanten
  insert into subklanten (customer_id, name) values (v_customer_id, 'PostNL Express') returning id into v_sub1;
  insert into subklanten (customer_id, name) values (v_customer_id, 'DHL Parcel') returning id into v_sub2;

  -- Hubs
  insert into hubs (code, name, carrier) values ('UPS-NL', 'UPS Netherlands', 'UPS') returning id into v_hub1;
  insert into hubs (code, name, carrier) values ('DHL-DE', 'DHL Germany', 'DHL') returning id into v_hub2;
  insert into hubs (code, name, carrier) values ('DPD-BE', 'DPD Belgium', 'DPD') returning id into v_hub3;

  -- Shipments (using new status flow)
  insert into shipments (customer_id, subklant_id, mawb, transport_type, colli_expected, chargeable_weight, warehouse_id, status, parcels, created_at, updated_at)
  values (v_customer_id, v_sub1, '235-84729301', 'AIR', 48, 2840, 'AMS-01', 'Outbound', 312, '2025-03-18T08:00:00Z', '2025-03-20T11:30:00Z')
  returning id into v_ship1;

  insert into shipments (customer_id, subklant_id, mawb, transport_type, colli_expected, chargeable_weight, warehouse_id, status, parcels, created_at, updated_at)
  values (v_customer_id, v_sub2, '074-19283746', 'AIR', 22, 1420, 'AMS-02', 'In Transit', 156, '2025-03-19T10:00:00Z', '2025-03-21T08:00:00Z')
  returning id into v_ship2;

  insert into shipments (customer_id, subklant_id, mawb, transport_type, colli_expected, chargeable_weight, warehouse_id, status, parcels, created_at, updated_at)
  values (v_customer_id, v_sub1, '180-55738291', 'AIR', 100, 1980, 'AMS-01', 'In Stock', 244, '2025-03-20T09:00:00Z', '2025-03-20T10:00:00Z')
  returning id into v_ship3;

  insert into shipments (customer_id, subklant_id, mawb, transport_type, colli_expected, chargeable_weight, warehouse_id, status, parcels, created_at, updated_at)
  values (v_customer_id, v_sub2, '607-33847291', 'AIR', 15, 760, 'AMS-02', 'Partial NOA', 89, '2025-03-20T07:00:00Z', '2025-03-20T07:00:00Z')
  returning id into v_ship4;

  insert into shipments (customer_id, subklant_id, mawb, transport_type, colli_expected, chargeable_weight, warehouse_id, status, parcels, created_at, updated_at)
  values (v_customer_id, v_sub1, '176-92847130', 'AIR', 60, 3200, 'AMS-01', 'Awaiting NOA', 420, '2025-03-21T18:00:00Z', '2025-03-21T18:00:00Z')
  returning id into v_ship5;

  -- NOAs
  insert into noas (shipment_id, noa_number, colli, weight, received_at, created_by) values
    (v_ship1, 1, 24, 1420, '2025-03-18T09:00:00Z', 'KLM Cargo'),
    (v_ship1, 2, 24, 1420, '2025-03-18T14:30:00Z', 'KLM Cargo'),
    (v_ship3, 1, 50, 1130, '2025-03-20T09:00:00Z', 'Martinair'),
    (v_ship3, 2, 50, 850, '2025-03-20T14:30:00Z', 'Martinair');

  -- Status history
  insert into shipment_status_history (shipment_id, status, changed_by, changed_at, notes) values
    (v_ship1, 'Awaiting NOA', 'System', '2025-03-18T08:00:00Z', 'Shipment created via portal'),
    (v_ship1, 'Partial NOA', 'KLM Cargo', '2025-03-18T09:00:00Z', null),
    (v_ship1, 'NOA Complete', 'KLM Cargo', '2025-03-18T14:30:00Z', null),
    (v_ship1, 'In Transit', 'Transport Desk', '2025-03-19T06:15:00Z', null),
    (v_ship1, 'In Stock', 'Warehouse AMS-01', '2025-03-19T09:45:00Z', 'All 48 colli scanned in'),
    (v_ship1, 'Outbound', 'Transport Desk', '2025-03-20T11:30:00Z', null);

  insert into shipment_status_history (shipment_id, status, changed_by, changed_at) values
    (v_ship2, 'Awaiting NOA', 'System', '2025-03-19T10:00:00Z'),
    (v_ship2, 'Partial NOA', 'Martinair', '2025-03-19T18:00:00Z'),
    (v_ship2, 'NOA Complete', 'Martinair', '2025-03-20T07:00:00Z'),
    (v_ship2, 'In Transit', 'Transport Desk', '2025-03-21T08:00:00Z');

  -- Outbounds
  insert into outbounds (shipment_id, hub_id, truck_reference, pickup_date, status) values
    (v_ship1, v_hub1, 'XY-123-NL', '2025-03-19', 'outbound') returning id into v_ob1;
  insert into outbounds (shipment_id, hub_id, truck_reference, pickup_date, status) values
    (v_ship1, v_hub1, 'AB-456-NL', '2025-03-20', 'outbound') returning id into v_ob2;
  insert into outbounds (shipment_id, hub_id, truck_reference, pickup_date, status) values
    (v_ship1, v_hub2, 'CD-789-DE', '2025-03-19', 'outbound') returning id into v_ob3;

  -- Pallets
  insert into pallets (shipment_id, outbound_id, pallet_number, pieces, weight, status) values
    (v_ship1, v_ob1, 'PLT-001', 12, 710, 'Outbound'),
    (v_ship1, v_ob1, 'PLT-002', 12, 695, 'Outbound'),
    (v_ship1, v_ob2, 'PLT-005', 6, 310, 'Outbound'),
    (v_ship1, v_ob3, 'PLT-003', 12, 720, 'Outbound'),
    (v_ship1, v_ob3, 'PLT-004', 6, 360, 'Outbound');

  -- Clearance: shipment 3 has partial clearance (80/100 colli)
  insert into clearances (shipment_id, colli_cleared, status, cleared_at, cleared_by, notes) values
    (v_ship3, 50, 'partial', '2025-03-20T12:00:00Z', 'Customs NL', 'First batch cleared'),
    (v_ship3, 30, 'partial', '2025-03-20T15:00:00Z', 'Customs NL', 'Second batch cleared');

  -- Clearance: shipment 1 fully cleared
  insert into clearances (shipment_id, colli_cleared, status, cleared_at, cleared_by) values
    (v_ship1, 48, 'cleared', '2025-03-18T16:00:00Z', 'Customs NL');

  -- Inspections: shipment 3 has 2 parcels under inspection
  insert into inspections (shipment_id, parcel_barcode, status, created_at) values
    (v_ship3, 'AMS-0042-PKG', 'under_inspection', '2025-03-20T13:00:00Z'),
    (v_ship3, 'AMS-0078-PKG', 'removed', '2025-03-20T13:30:00Z');

end $$;
