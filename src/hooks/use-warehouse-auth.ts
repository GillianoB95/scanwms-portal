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
        .select('role, customers(warehouse_id)')
        .eq('email', user.email)
        .in('role', ['warehouse', 'staff', 'admin'])
        .maybeSingle();

      if (error || !data) return { isWarehouse: false, role: null, warehouseId: null };
      const warehouseId = (data.customers as any)?.warehouse_id ?? null;
      return { isWarehouse: true, role: data.role as string, warehouseId };
    },
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });
}
