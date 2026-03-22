-- ============================================
-- SCANWMS Database Setup
-- Run this in your Supabase SQL Editor
-- ============================================

-- Customers
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  warehouse_id text,
  created_at timestamptz default now()
);
alter table customers enable row level security;
create policy "Users can view their own customer" on customers for select to authenticated
  using (id in (select customer_id from customer_users where email = auth.jwt()->>'email'));

-- Customer Users (linked to customers)
create table if not exists customer_users (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  email text not null,
  role text default 'user',
  created_at timestamptz default now()
);
alter table customer_users enable row level security;
create policy "Users can view their own record" on customer_users for select to authenticated
  using (email = auth.jwt()->>'email');

-- Subklanten
create table if not exists subklanten (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);
alter table subklanten enable row level security;
create policy "Users can view own subklanten" on subklanten for select to authenticated
  using (customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email'));

-- Hubs
create table if not exists hubs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  carrier text,
  active boolean default true
);
alter table hubs enable row level security;
create policy "Authenticated users can view hubs" on hubs for select to authenticated using (true);

-- Shipments
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
alter table shipments enable row level security;
create policy "Users can view own shipments" on shipments for select to authenticated
  using (customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email'));
create policy "Users can insert own shipments" on shipments for insert to authenticated
  with check (customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email'));

-- NOAs
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
alter table noas enable row level security;
create policy "Users can view own noas" on noas for select to authenticated
  using (shipment_id in (select id from shipments where customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email')));

-- Status history
create table if not exists shipment_status_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  status text,
  changed_by text,
  changed_at timestamptz default now(),
  notes text
);
alter table shipment_status_history enable row level security;
create policy "Users can view own status history" on shipment_status_history for select to authenticated
  using (shipment_id in (select id from shipments where customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email')));

-- Outbounds
create table if not exists outbounds (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  hub_id uuid references hubs(id),
  truck_reference text,
  pickup_date date,
  status text default 'planned'
);
alter table outbounds enable row level security;
create policy "Users can view own outbounds" on outbounds for select to authenticated
  using (shipment_id in (select id from shipments where customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email')));

-- Pallets
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
alter table pallets enable row level security;
create policy "Users can view own pallets" on pallets for select to authenticated
  using (shipment_id in (select id from shipments where customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email')));

-- Outerboxes
create table if not exists outerboxes (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  barcode text,
  status text default 'expected',
  scanned_in_at timestamptz,
  scanned_out_at timestamptz,
  pallet_id uuid references pallets(id)
);
alter table outerboxes enable row level security;
create policy "Users can view own outerboxes" on outerboxes for select to authenticated
  using (shipment_id in (select id from shipments where customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email')));

-- Shipment files
create table if not exists shipment_files (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  file_type text,
  storage_path text,
  uploaded_at timestamptz default now()
);
alter table shipment_files enable row level security;
create policy "Users can view own files" on shipment_files for select to authenticated
  using (shipment_id in (select id from shipments where customer_id in (select customer_id from customer_users where email = auth.jwt()->>'email')));

-- ============================================
-- SAMPLE DATA
-- ============================================
-- First create a test user in Supabase Auth (dashboard → Authentication → Users → Add User)
-- Email: demo@scanwms.com, Password: demo1234

-- Customer
insert into customers (id, name, warehouse_id) values
  ('c0000000-0000-0000-0000-000000000001', 'ACME Logistics BV', 'AMS-01');

-- Link demo user to customer
insert into customer_users (customer_id, email, role) values
  ('c0000000-0000-0000-0000-000000000001', 'demo@scanwms.com', 'admin');

-- Subklanten
insert into subklanten (id, customer_id, name) values
  ('s0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'PostNL Express'),
  ('s0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'DHL Parcel');

-- Hubs
insert into hubs (id, code, name, carrier) values
  ('h0000000-0000-0000-0000-000000000001', 'UPS-NL', 'UPS Netherlands', 'UPS'),
  ('h0000000-0000-0000-0000-000000000002', 'DHL-DE', 'DHL Germany', 'DHL'),
  ('h0000000-0000-0000-0000-000000000003', 'DPD-BE', 'DPD Belgium', 'DPD');

-- Shipments (5 with various statuses)
insert into shipments (id, customer_id, subklant_id, mawb, transport_type, colli_expected, chargeable_weight, warehouse_id, status, parcels, created_at, updated_at) values
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 's0000000-0000-0000-0000-000000000001', '235-84729301', 'AIR', 48, 2840, 'AMS-01', 'Delivered', 312, '2025-03-18T08:00:00Z', '2025-03-20T11:30:00Z'),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 's0000000-0000-0000-0000-000000000002', '074-19283746', 'AIR', 22, 1420, 'AMS-02', 'In Transit', 156, '2025-03-19T10:00:00Z', '2025-03-21T08:00:00Z'),
  ('a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 's0000000-0000-0000-0000-000000000001', '180-55738291', 'AIR', 35, 1980, 'AMS-01', 'In Stock', 244, '2025-03-20T09:00:00Z', '2025-03-20T10:00:00Z'),
  ('a0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 's0000000-0000-0000-0000-000000000002', '607-33847291', 'AIR', 15, 760, 'AMS-02', 'NOA Received', 89, '2025-03-20T07:00:00Z', '2025-03-20T07:00:00Z'),
  ('a0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 's0000000-0000-0000-0000-000000000001', '176-92847130', 'AIR', 60, 3200, 'AMS-01', 'Created', 420, '2025-03-21T18:00:00Z', '2025-03-21T18:00:00Z');

-- NOAs for shipment 1 (delivered, complete)
insert into noas (shipment_id, noa_number, colli, weight, received_at, created_by) values
  ('a0000000-0000-0000-0000-000000000001', 1, 24, 1420, '2025-03-18T09:00:00Z', 'KLM Cargo'),
  ('a0000000-0000-0000-0000-000000000001', 2, 24, 1420, '2025-03-18T14:30:00Z', 'KLM Cargo');

-- NOAs for shipment 3 (in stock, partial)
insert into noas (shipment_id, noa_number, colli, weight, received_at, created_by) values
  ('a0000000-0000-0000-0000-000000000003', 1, 20, 1130, '2025-03-20T09:00:00Z', 'Martinair'),
  ('a0000000-0000-0000-0000-000000000003', 2, 13, 850, '2025-03-20T14:30:00Z', 'Martinair');

-- Status history for shipment 1
insert into shipment_status_history (shipment_id, status, changed_by, changed_at, notes) values
  ('a0000000-0000-0000-0000-000000000001', 'Created', 'System', '2025-03-18T08:00:00Z', 'Shipment created via portal'),
  ('a0000000-0000-0000-0000-000000000001', 'NOA Received', 'KLM Cargo', '2025-03-18T14:30:00Z', null),
  ('a0000000-0000-0000-0000-000000000001', 'Arrived', 'Warehouse AMS-01', '2025-03-19T06:15:00Z', null),
  ('a0000000-0000-0000-0000-000000000001', 'In Stock', 'Warehouse AMS-01', '2025-03-19T09:45:00Z', 'All 48 colli scanned in'),
  ('a0000000-0000-0000-0000-000000000001', 'In Transit', 'Transport Desk', '2025-03-19T16:00:00Z', null),
  ('a0000000-0000-0000-0000-000000000001', 'Delivered', 'Driver M. de Vries', '2025-03-20T11:30:00Z', null);

-- Status history for shipment 2
insert into shipment_status_history (shipment_id, status, changed_by, changed_at) values
  ('a0000000-0000-0000-0000-000000000002', 'Created', 'System', '2025-03-19T10:00:00Z'),
  ('a0000000-0000-0000-0000-000000000002', 'NOA Received', 'Martinair', '2025-03-19T18:00:00Z'),
  ('a0000000-0000-0000-0000-000000000002', 'Arrived', 'Warehouse AMS-02', '2025-03-20T07:00:00Z'),
  ('a0000000-0000-0000-0000-000000000002', 'In Stock', 'Warehouse AMS-02', '2025-03-20T10:00:00Z'),
  ('a0000000-0000-0000-0000-000000000002', 'In Transit', 'Transport Desk', '2025-03-21T08:00:00Z');

-- Outbounds for shipment 1
insert into outbounds (id, shipment_id, hub_id, truck_reference, pickup_date, status) values
  ('o0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'h0000000-0000-0000-0000-000000000001', 'XY-123-NL', '2025-03-19', 'delivered'),
  ('o0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'h0000000-0000-0000-0000-000000000001', 'AB-456-NL', '2025-03-20', 'delivered'),
  ('o0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'h0000000-0000-0000-0000-000000000002', 'CD-789-DE', '2025-03-19', 'delivered');

-- Pallets
insert into pallets (shipment_id, outbound_id, pallet_number, pieces, weight, status) values
  ('a0000000-0000-0000-0000-000000000001', 'o0000000-0000-0000-0000-000000000001', 'PLT-001', 12, 710, 'Delivered'),
  ('a0000000-0000-0000-0000-000000000001', 'o0000000-0000-0000-0000-000000000001', 'PLT-002', 12, 695, 'Delivered'),
  ('a0000000-0000-0000-0000-000000000001', 'o0000000-0000-0000-0000-000000000002', 'PLT-005', 6, 310, 'Delivered'),
  ('a0000000-0000-0000-0000-000000000001', 'o0000000-0000-0000-0000-000000000003', 'PLT-003', 12, 720, 'Delivered'),
  ('a0000000-0000-0000-0000-000000000001', 'o0000000-0000-0000-0000-000000000003', 'PLT-004', 6, 360, 'Delivered');
