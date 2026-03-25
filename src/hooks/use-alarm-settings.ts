import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { AlarmSettings, DEFAULT_ALARM_SETTINGS } from '@/lib/alarm-utils';

export function useAlarmSettings() {
  return useQuery({
    queryKey: ['alarm-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alarm_settings')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as AlarmSettings | null) ?? DEFAULT_ALARM_SETTINGS;
    },
    staleTime: 60_000,
  });
}

export function useUpdateAlarmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<AlarmSettings> & { id?: string }) => {
      const { id, ...updates } = settings;
      if (id) {
        const { error } = await supabase.from('alarm_settings').update(updates).eq('id', id);
        if (error) throw error;
      } else {
        // Check if row exists
        const { data: existing } = await supabase.from('alarm_settings').select('id').limit(1).maybeSingle();
        if (existing) {
          const { error } = await supabase.from('alarm_settings').update(updates).eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('alarm_settings').insert(updates);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alarm-settings'] }),
  });
}
