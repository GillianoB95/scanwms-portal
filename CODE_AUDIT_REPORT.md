# SCANWMS Portal — Full Codebase Audit Report

Scope: every file under `src/` (116 TS/TSX files). DB schema, FKs, RLS policies, and column defaults were verified live against project `zsjvmiyqhyzjeuyzovqx` via `mcp__supabase__execute_sql`. `npx tsc --noEmit -p tsconfig.app.json` (and with `--strict`) exits 0 — no TypeScript errors.

How to read severity:
- **CRITICAL** — query/mutation fails at runtime (PostgREST rejects unknown columns) or core workflow is silently broken.
- **MEDIUM** — feature partially broken, wrong data shown, or security exposure.
- **LOW** — cosmetic, dead code, or minor inconsistency.

---

## CRITICAL

### 1. `shipment_files` updated with non-existent columns
- **File:** `src/lib/send-email.ts` ~line 110 (`sendConvertedManifestEmail` step 7)
- **Issue:** `supabase.from('shipment_files').update({ email_sent_at, email_sent_by })`. `shipment_files` columns are `id, shipment_id, file_type, storage_path, uploaded_at` only. There is no `email_sent_at`/`email_sent_by` (those live on `inspections`). PostgREST rejects the update → the "email sent" tracking on the converted-manifest file never persists. Error is swallowed (no `await`/check).
- **Fix:** Track email-sent state on `inspections` (where the columns exist) or add the columns to `shipment_files`. Check the update result.

### 2. Customer `OutboundSection` queries non-existent columns (3 separate columns)
- **File:** `src/pages/ShipmentDetail.tsx`, `OutboundSection` queryFn (~line 360)
- **Issue:** `outbounds.select('id, outbound_number, pickup_date, truck_reference, license_plate, seal_number, status, departed_at, prepared_at')`. `seal_number`, `departed_at`, `prepared_at` do NOT exist on `outbounds` (seal_number is on `cmr_records`; outbounds has no departed_at/prepared_at). Query 400s → `obData` undefined → the customer "Outbound Shipments" table is always empty. Display also reads `ob.seal_number`, `ob.departed_at`.
- **Fix:** Drop `seal_number/departed_at/prepared_at` from the select; derive departed/prepare from `status`/`pickup_date`; get seal from `cmr_records` if needed.

### 3. `pallets.select(..., hub, ...)` — `hub` is not a column
- **Files:** `src/pages/ShipmentDetail.tsx` OutboundSection (~line 367), `src/pages/staff/StaffShipmentDetail.tsx` `usePallets` (~line 64), `src/pages/warehouse/WarehouseShipmentDetail.tsx` `usePallets` (~line 56)
- **Issue:** All three select `hub` from `pallets`. The column is `hub_code`, not `hub`. Each query 400s → "Pallet Overview" never renders in any of the three detail pages. Display also reads `p.hub`.
- **Fix:** Select `hub_code` and render `p.hub_code`.

### 4. `cmr_records.select('file_path, file_name')` — neither column exists
- **Files:** `src/pages/ShipmentDetail.tsx` `handleDownloadCmr` (~line 403), `src/pages/Outbounds.tsx` `handleDownloadCmr` (line 57)
- **Issue:** `cmr_records` columns are `id, outbound_id, shipment_id, subclient_id, hub_address_id, seal_number, loading_reference, total_colli, total_weight, generated_at, generated_by, status`. No `file_path`, no `file_name`. Query 400s → CMR download always shows "No CMR file available." The whole CMR-download feature for customers is broken.
- **Fix:** Store CMR PDFs in `shipment_files` (or a storage path column on `cmr_records`) and select that.

### 5. `shipments.select('...noa_received_at...')` — column does not exist
- **File:** `src/components/staff/ActionRequiredPanel.tsx` `useAlarmData` shipmentAlarms query (line 86)
- **Issue:** Selects `noa_received_at` from `shipments`. No such column exists. Query 400s → react-query throws → **all shipment-level alarms (NOA-not-unloaded, no-NOA-after-ETA, no-NOA-after-created) never appear** in the Action Required panel. `getShipmentAlarms` in `alarm-utils.ts` also expects this field.
- **Fix:** Derive `noa_received_at` by joining `noas(received_at)` and taking the earliest non-null, or add the column.

### 6. `shipment_status_history.select('shipment_id, new_status')` — column is `status`
- **File:** `src/pages/warehouse/StockOverview.tsx` (~line 89)
- **Issue:** Selects `new_status` and filters `.eq('new_status', 'Partial NOA')`. The column is `status`. Query 400s → `partialNoaIds` always empty → the "Partial NOA" indicator in Stock Overview never shows.
- **Fix:** Use `status` instead of `new_status`.

### 7. Staff NOA upload inserts non-existent `source` column
- **File:** `src/pages/staff/InboundShipment.tsx` `useCreateNoa` (line 29) and `NoaUploadModal.handleSave`
- **Issue:** `supabase.from('noas').insert({ shipment_id, colli, weight, source, file_path, received_at })`. `noas` has no `source` column. PostgREST rejects the insert → **the staff "Upload NOA" action always fails** (toast "Failed to upload NOA"). Note: `noa_part_id`/`noa_number` have DB defaults so those are fine; only `source` is the blocker.
- **Fix:** Remove `source` (or store it in `created_by`/a real column). `noas.file_path` exists, so keep that.

### 8. Staff NOA upload updates non-existent `colli_received` / `noa_date`
- **File:** `src/pages/staff/InboundShipment.tsx` `NoaUploadModal.handleSave` (line 70)
- **Issue:** `shipments.update({ colli_received, status, noa_date })`. Neither `colli_received` nor `noa_date` exists on `shipments`. PostgREST rejects the PATCH → the status transition to 'Partial NOA'/'NOA Complete' never happens after a NOA upload (even if the insert were fixed).
- **Fix:** Drop `colli_received`/`noa_date`; the status update alone is sufficient. Track received colli via the `noas` rows.

### 9. Open-inspection check uses wrong status string
- **File:** `src/pages/warehouse/WarehouseOutbound.tsx` `addPallet` mutation (~line 286)
- **Issue:** `.eq('status', 'Under Inspection')`. The `inspections.status` column defaults to and stores `'under_inspection'` (snake_case, confirmed via `column_default`). 'Under Inspection' never matches → **shipments with open fyco inspections are NOT blocked from being added to an outbound**.
- **Fix:** `.eq('status', 'under_inspection')`.

### 10. Fyco-unscanned outbound guard reads `data` from a `head:true` count query
- **File:** `src/pages/warehouse/WarehouseOutbound.tsx` `addPallet` (~line 300-305)
- **Issue:** `const { data: unscannedFyco } = supabase.from('inspections').select('id', { count:'exact', head:true })...; if (unscannedFyco && unscannedFyco.length > 0)`. With `head:true`, `data` is `null` — only `count` is returned. The condition is always false → **pallets whose fyco parcels haven't been individually scanned are never blocked from outbound.**
- **Fix:** Destructure `count`: `const { count } = ...; if (count && count > 0)`.

### 11. RLS — `email_accounts` readable by every authenticated user (credential leak)
- **DB:** policy "Customers can read email accounts" on `email_accounts`, `cmd=SELECT`, `qual=true`.
- **Issue:** Any authenticated user (any customer/sub-account) can `select *` from `email_accounts`, exposing `smtp_password`, `smtp_user`, `resend_api_key`, `smtp_host` for ALL warehouses/customers. The frontend itself selects `resend_api_key` client-side (`send-email.ts`, `FycoManagement.tsx`).
- **Fix:** Restrict SELECT to staff/warehouse (or to the user's own customer/warehouse). Never expose `smtp_password`/`resend_api_key` to the browser — proxy sending through an Edge Function that holds the key server-side.

### 12. RLS — `warehouses` exposes PrintNode API keys to every user
- **DB:** policy "Authenticated users can view warehouses", `cmd=SELECT`, `qual=true`.
- **Issue:** `warehouses` contains `printnode_api_key`, `printnode_key`, `cmr_printer_key`. Any authenticated user reading `select *` (used widely, e.g. `WarehouseManagement`, `WarehouseOutbound`, `PrintLabels`, `InboundScanning`) gets all printer API keys.
- **Fix:** Create a security-definer view / column-level privileges that strips the `*_key` columns for non-staff, or restrict the policy to `is_staff_user() OR is_warehouse_user()`.

### 13. RLS — multiple tables "Enable all for authenticated" (qual=true, cmd=ALL)
- **DB:** `t1_records`, `trigger_log`, `uitslagbonnen`, `oe_sheet_errors`, `active_pallet_sessions`, `pallet_counters`, `manifest_learned_hs`, `manifest_names_pool`, `manifest_product_guides`.
- **Issue:** Every authenticated user can read, insert, update, and delete all rows in these tables (e.g. any customer can delete/forge `trigger_log` or `t1_records`, manipulate `pallet_counters` to alter pallet numbering, hijack another warehouse's `active_pallet_sessions`).
- **Fix:** Scope each to `is_staff_user()`/`is_warehouse_user()` or per-shipment ownership checks; `pallet_counters` should be service-role only.

---

## MEDIUM

### 14. Manifest-validator regexes use `/g` flag with `.test()` in a loop
- **File:** `src/lib/manifest-validator.ts` (~lines 12-13, used in `validateManifestForCustoms`)
- **Issue:** `BARCODE_FORBIDDEN` / `BOX_BARCODE_FORBIDDEN` are `/.../g` regexes. `RegExp.test` with the global flag is stateful (`lastIndex` advances), so calling `.test()` once per row gives inconsistent true/false results across rows — forbidden-character validation intermittently passes/fails.
- **Fix:** Remove the `g` flag (the strings are matched once per cell, not replaced), or reset `.lastIndex = 0` before each call.

### 15. PrintNode jobs sent as `raw_base64` with HTML/XLSX content
- **Files:** `src/lib/printnode.ts` `printPalletLabel` (contentType `raw_base64`, content = base64 HTML), `src/lib/cmr-generator.ts` `printCmrViaPrintNode` (contentType `raw_base64`, content = base64 XLSX)
- **Issue:** PrintNode `raw_base64` sends bytes straight to the printer as a raw printer language (ZPL/ESC/P). HTML and XLSX are not raw printer languages → the printer prints garbage. Both label printing and CMR printing are functionally broken.
- **Fix:** Convert to PDF (`pdf_base64`) before sending, or use PrintNode's URI/HTML rendering path appropriately.

### 16. Unscanned-box sort without null guard → `Invalid Date`
- **File:** `src/pages/warehouse/InboundScanning.tsx` scannedBoxes queryFn (~line 336)
- **Issue:** `all.sort((a,b) => new Date(b.scanned_in_at).getTime() - new Date(a.scanned_in_at).getTime())`. Outerboxes fetched with no status filter; a box with null `scanned_in_at` yields `new Date(null)` → `Invalid Date`/`NaN`, destabilising the sort. Also `new Date(box.scanned_in_at).toLocaleTimeString()` in the table (line 1086).
- **Fix:** Guard nulls: `new Date(b.scanned_in_at ?? 0).getTime()` and only render time when `scanned_in_at` present.

### 17. NOA `created_at` used but never selected → `Invalid Date`
- **Files:** `src/hooks/use-shipment-data.ts` `useNoas` (does not select `created_at`); consumed in `src/pages/warehouse/WarehouseShipmentDetail.tsx` (`new Date(n.created_at).toLocaleString()`), `src/pages/ShipmentDetail.tsx` `getMilestoneStatus` (`noa?.received_at || noa?.created_at`), `src/pages/staff/StaffShipmentDetail.tsx`.
- **Issue:** `n.created_at` is undefined → `new Date(undefined)` shows "Invalid Date" in the Warehouse NOA table; milestone date silently drops to received_at only.
- **Fix:** Add `created_at` to the `useNoas` select list.

### 18. `NotificationSettingsDialog` uses `useState(() => …)` as a sync effect
- **File:** `src/pages/staff/CustomerManagement.tsx` `NotificationSettingsDialog` (~line "Sync when settings load")
- **Issue:** `useState(() => { if (ccCleared) {...} })` runs the initializer only once at mount, when `settings` are still empty. When settings load later, the toggles/emails never populate from the DB → dialog opens with stale (false/blank) defaults regardless of saved state.
- **Fix:** Use `useEffect([settings])` to sync local state when settings arrive.

### 19. Staff Outbound statuses diverge from warehouse Outbound statuses
- **File:** `src/pages/staff/OutboundShipment.tsx` (`markPickedUp` → `'Picked Up'`, `undoPickedUp` → `'Pending'`)
- **Issue:** Warehouse portal uses `'preparing'`/`'prepared'`/`'departed'`. Staff uses `'Picked Up'`/`'Pending'`. A shipment outbound marked 'Picked Up' by staff is not recognised as departed by the warehouse dashboards/filters (which check `'departed'`), and vice-versa. `StatusBadge` happens to map both but the workflow logic is inconsistent.
- **Fix:** Standardise on one status vocabulary (e.g. `'departed'`) across both portals.

### 20. Staff Outbound list shows always-zero derived columns
- **File:** `src/pages/staff/OutboundShipment.tsx` list view (`o.pallets_count`, `o.total_pieces`, `o.total_weight`)
- **Issue:** `useAllOutbounds` returns raw outbounds + hub fields only; it never computes pallet/piece/weight totals. The columns render `0`/`—` for every row.
- **Fix:** Aggregate `pallets` per outbound (as `WarehouseOutbound` does) or remove the columns.

### 21. Customer Outbounds page / MAWB Overview reference non-existent display columns
- **Files:** `src/pages/staff/MawbOverview.tsx` line 493 (`shipment.unloaded_date` — should be `unloaded_at`; "Unloaded" column always blank), line 487 (`shipment.noa_date` — falls back to `noas[0].received_at`, so functional but dead branch); `src/pages/staff/InboundShipment.tsx` lines 335-337 (`s.colli_received`, `s.outerboxes_scanned`, `s.outerboxes_total` — not columns, always 0) and `s.weight` display.
- **Fix:** Use `unloaded_at`; compute received/scanned from `noas`/`outerboxes` joins rather than phantom columns.

### 22. `WarehouseOutbound` list `cmr_uploaded` indicator is always false
- **File:** `src/pages/warehouse/WarehouseOutbound.tsx` (~line 859, 883)
- **Issue:** `o.cmr_uploaded` is not a column on `outbounds` (CMR existence is in `cmr_records`). The CMR check/X icon is always X; the "Download CMR" guard always fires its "coming soon" branch.
- **Fix:** Derive CMR presence from a `cmr_records` join or a stored flag.

### 23. InboundScanning unload counts fyco scans as colli
- **File:** `src/pages/warehouse/InboundScanning.tsx` `unloadMutation` (line 730)
- **Issue:** `scannedCount = scannedBoxes.filter(b => b.status !== 'deleted').length` includes the synthetic fyco rows (`isFyco`, status `'fyco'`). Fyco parcel scans inflate `unloaded_colli`.
- **Fix:** Exclude `isFyco` rows from the unloaded count.

### 24. `check_fyco_for_outerbox` RPC does not exist (wasted failing call)
- **File:** `src/pages/warehouse/InboundScanning.tsx` preCheckMutation (~line 548)
- **Issue:** `supabase.rpc('check_fyco_for_outerbox', …)` — this function is not in the DB. The error is ignored and the code falls back to a manual query, so functionally OK, but it logs/throws an error and adds latency on every scan.
- **Fix:** Create the RPC or remove the call and keep only the manual fallback.

### 25. `auth-context` `fetchCustomer` uses `.single()` and ignores errors
- **File:** `src/lib/auth-context.tsx` `fetchCustomer`
- **Issue:** `.eq('email', email).single()` throws if the user has no `customer_users` row (e.g. a freshly-created staff/warehouse user before linkage). The error is swallowed (`const { data } = …`), leaving `customer`/`role` null — the user appears stuck on "Loading…" because route guards wait for `role && customer` to become non-null. Staff/warehouse users with a `customer_users` row are fine, but the failure mode is a hard load hang.
- **Fix:** Use `.maybeSingle()` and handle the no-row case explicitly (set role from the row or redirect).

### 26. Customer `Shipments.tsx` relies entirely on RLS (no client filter)
- **File:** `src/pages/Shipments.tsx` `fetchShipments` (line 47)
- **Issue:** The query has no `customer_id` filter; it depends wholly on the `shipments` RLS SELECT policy. If RLS is ever weakened or bypassed (service key), a customer could see all shipments. Defense-in-depth: also filter client-side via `useAccessibleCustomerIds`.
- **Fix:** Add `.in('customer_id', accessibleIds)` like `useShipments` does.

---

## LOW

### 27. Dead fallback columns in display (`colli_count`, `weight_kg`)
- **Files:** `src/pages/warehouse/PrintLabels.tsx` (line 231-232), `src/pages/warehouse/InboundScanning.tsx` (line 1037-1038)
- **Issue:** `p.pieces ?? p.colli_count` and `p.weight ?? p.weight_kg` — `colli_count`/`weight_kg` don't exist; harmless because `pieces`/`weight` are real, but dead code.
- **Fix:** Remove the phantom fallbacks.

### 28. `noas.source` displayed but never selected
- **File:** `src/pages/staff/StaffShipmentDetail.tsx` NOA table (`n.source || 'Manual'`)
- **Issue:** `useNoas` doesn't select `source` and `noas` has no `source` column → always shows "Manual".
- **Fix:** Use `created_by` or remove the column.

### 29. Fragment without key in customer table map
- **File:** `src/pages/staff/CustomerManagement.tsx` mainCustomers `.map(... <>…</>)`
- **Issue:** The outer `<>` fragment in the map has no key → React key warning.
- **Fix:** Use `<Fragment key={customer.id}>`.

### 30. `new Date(historyEntry.changed_at)` without null guard
- **Files:** `StaffShipmentDetail.tsx`, `WarehouseShipmentDetail.tsx` timeline
- **Issue:** `changed_at` is nullable; if null, renders "Invalid Date". History rows normally set it, but no guard.
- **Fix:** `historyEntry.changed_at ? new Date(...).toLocaleString() : '—'`.

### 31. `use-toast.ts` effect re-subscribes on every state change
- **File:** `src/hooks/use-toast.ts` `useToast` (`useEffect` dep `[state]`)
- **Issue:** Standard shadcn quirk — the listener is pushed/removed on each state change. Minor perf, not a bug.
- **Fix:** Depend on `[]` (stable) — optional.

### 32. `sendConvertedManifestEmail` called with possibly-null `warehouseId`
- **Files:** `src/pages/NewShipment.tsx`, `src/pages/ShipmentDetail.tsx`
- **Issue:** `warehouseId` can be `null`; the email-account lookup `.eq('warehouse_id', warehouseId)` then matches nothing and the email silently doesn't send. Not a crash.
- **Fix:** Guard/null-check and surface a clear error.

---

## Notes / Non-issues confirmed
- `src/lib/supabase.ts` `SUPABASE_ANON_KEY` is a real JWT (the `…` seen in terminal output is the terminal masking a secret-looking string, confirmed via `od -c`). Not a placeholder.
- `noas.noa_part_id`/`noa_number` and `outbounds.outbound_number` have sequence/constant defaults, so inserts omitting them succeed (not bugs).
- `tsc --noEmit` passes clean (even under `--strict`); the project ships with `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`, so most of the null/Invalid-Date issues above are NOT caught by the compiler.
- FKs exist for all nested-relation selects used (`subklanten`, `customers`, `noas`, `hubs`, `pallets`, `outbounds`, `manifest_parcels`) — relation joins resolve correctly.
- RPCs used (`get_accessible_customer_ids`, `get_customer_outbounds`, `lookup_customer_names`, `generate_pallet_number`) all exist in the DB.
