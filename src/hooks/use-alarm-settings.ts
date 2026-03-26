import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { AlarmSettings, DEFAULT_ALARM_SETTINGS } from '@/lib/alarm-utils';

/** Which column stores the value for each setting key */
const VALUE_COLUMN: Record<string, 'value_hours' | 'value_working_days'> = {
  fyco_no_check_days: 'value_working_days',
  fyco_no_action_days: 'value_working_days',
  fyco_docs_no_release_days: 'value_working_days',
  fyco_action_no_release_days: 'value_working_days',
  shipment_noa_not_unloaded_hours: 'value_hours',
  shipment_no_noa_after_eta_days: 'value_working_days',
  shipment_created_no_noa_days: 'value_working_days',
  noa_kpi_warning_hours: 'value_hours',
  carrier_pickup_hours: 'value_hours',
  carrier_pickup_warning_hours: 'value_hours',
};

export function useAlarmSettings() {
  return useQuery({
    queryKey: ['alarm-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alarm_settings')
        .select('setting_key, value_hours, value_working_days');
      if (error) throw error;

      const settings: AlarmSettings = { ...DEFAULT_ALARM_SETTINGS };
      for (const row of data ?? []) {
        const key = (row as any).setting_key as keyof AlarmSettings;
        if (key in DEFAULT_ALARM_SETTINGS) {
          const col = VALUE_COLUMN[key];
          const val = col === 'value_hours' ? (row as any).value_hours : (row as any).value_working_days;
          if (val != null) (settings as any)[key] = val;
        }
      }
      return settings;
    },
    staleTime: 60_000,
  });
}

export function useUpdateAlarmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<AlarmSettings>) => {
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'id' || !(key in VALUE_COLUMN)) continue;
        const col = VALUE_COLUMN[key];
        const { error } = await supabase
          .from('alarm_settings')
          .update({ [col]: value })
          .eq('setting_key', key);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alarm-settings'] }),
  });
}
