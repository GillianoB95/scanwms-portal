import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

export function useWarehouseAuth() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['warehouse-role', user?.email],
    queryFn: async () => {
      if (!user?.email) return { isWarehouse: false, role: null, warehouseId: null, warehouseCode: null };
      const { data, error } = await supabase
        .from('customer_users')
        .select('role, warehouse_id, customers(warehouse_id)')
        .eq('email', user.email)
        .in('role', ['warehouse', 'staff', 'admin'])
        .maybeSingle();

      if (error || !data) return { isWarehouse: false, role: null, warehouseId: null, warehouseCode: null };

      // Priority: direct warehouse_id on customer_users, then via customer
      const directWarehouseId = (data as any).warehouse_id ?? null;
      const customerWarehouseId = (data.customers as any)?.warehouse_id ?? null;
      const rawWarehouseId = directWarehouseId || customerWarehouseId;

      // The warehouse_id on customer_users may be a code (e.g. 'AMS-01') or a UUID.
      // Resolve to actual UUID by looking up the warehouses table.
      let warehouseId: string | null = null;
      let warehouseCode: string | null = null;

      if (rawWarehouseId) {
        // Check if it's a UUID (contains hyphens and is 36 chars)
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawWarehouseId);
        if (isUuid) {
          warehouseId = rawWarehouseId;
          // Look up the code
          const { data: wh } = await supabase.from('warehouses').select('code').eq('id', rawWarehouseId).maybeSingle();
          warehouseCode = wh?.code ?? null;
        } else {
          // It's a code — look up the UUID
          warehouseCode = rawWarehouseId;
          const { data: wh } = await supabase.from('warehouses').select('id').eq('code', rawWarehouseId).maybeSingle();
          warehouseId = wh?.id ?? null;
        }
      }

      return { isWarehouse: true, role: data.role as string, warehouseId, warehouseCode };
    },
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });
}
