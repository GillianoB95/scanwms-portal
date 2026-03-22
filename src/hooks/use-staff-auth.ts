import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

export function useStaffAuth() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['staff-role', user?.email],
    queryFn: async () => {
      if (!user?.email) return { isStaff: false, role: null };
      const { data, error } = await supabase
        .from('customer_users')
        .select('role')
        .eq('email', user.email)
        .in('role', ['staff', 'admin'])
        .maybeSingle();

      if (error || !data) return { isStaff: false, role: null };
      return { isStaff: true, role: data.role as string };
    },
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });
}
