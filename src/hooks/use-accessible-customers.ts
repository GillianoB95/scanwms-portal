import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

/**
 * Fetches the list of customer IDs accessible to the current user
 * via the get_accessible_customer_ids() database function.
 * For parent accounts this includes own + all sub-customer IDs.
 * For sub-accounts this returns only their own ID.
 */
export function useAccessibleCustomerIds() {
  const { customer } = useAuth();
  return useQuery({
    queryKey: ['accessible-customer-ids', customer?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_accessible_customer_ids');
      if (error) {
        console.error('get_accessible_customer_ids failed:', error.message);
        // Fallback to just own ID
        return customer ? [customer.id] : [];
      }
      return (data as string[]) ?? (customer ? [customer.id] : []);
    },
    enabled: !!customer,
    staleTime: 5 * 60 * 1000, // cache for 5 min
  });
}
