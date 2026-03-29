-- RPC to get outbound IDs for a list of pallet IDs, bypassing RLS
-- Used by customer portal to resolve outbounds from pallets
CREATE OR REPLACE FUNCTION get_outbound_ids_for_pallets(pallet_ids uuid[])
RETURNS TABLE(pallet_id uuid, outbound_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id AS pallet_id, outbound_id
  FROM pallets
  WHERE id = ANY(pallet_ids)
    AND outbound_id IS NOT NULL;
$$;
