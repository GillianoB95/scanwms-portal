import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

export function useWarehouseAuth() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['warehouse-role', user?.email],
    queryFn: async () => {
      if (!user?.email) return { isWarehouse: false, role: null, warehouseId: null };
      const { data, error } = await supabase
        .from('customer_users')
        .select('role, warehouse_id, customers(warehouse_id)')
        .eq('email', user.email)
        .in('role', ['warehouse', 'staff', 'admin'])
        .maybeSingle();

      if (error || !data) return { isWarehouse: false, role: null, warehouseId: null };

      // Priority: direct warehouse_id on customer_users, then via customer
      const directWarehouseId = (data as any).warehouse_id ?? null;
      const customerWarehouseId = (data.customers as any)?.warehouse_id ?? null;
      const warehouseId = directWarehouseId || customerWarehouseId;

      return { isWarehouse: true, role: data.role as string, warehouseId };
    },
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });
}
