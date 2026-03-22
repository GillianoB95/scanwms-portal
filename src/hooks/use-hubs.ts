import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useHubs() {
  return useQuery({
    queryKey: ['hubs-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hubs')
        .select('code')
        .eq('active', true);
      if (error) {
        console.warn('Hubs query failed:', error.message);
        return [];
      }
      return (data ?? []).map((h: any) => h.code as string);
    },
    staleTime: 5 * 60 * 1000,
  });
}
