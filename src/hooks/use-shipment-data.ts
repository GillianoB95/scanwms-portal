import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

export function useShipments() {
  const { customer } = useAuth();
  return useQuery({
    queryKey: ['shipments', customer?.id],
    queryFn: async () => {
      if (!customer) return [];
      const { data, error } = await supabase
        .from('shipments')
        .select('*, subklanten(name)')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Shipments query failed:', {
          customerId: customer.id,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        throw error;
      }

      return data ?? [];
    },
    enabled: !!customer,
    retry: false,
  });
}

export function useShipment(id: string | undefined) {
  const { customer } = useAuth();
  return useQuery({
    queryKey: ['shipment', id],
    queryFn: async () => {
      if (!id || !customer) return null;
      const { data, error } = await supabase
        .from('shipments')
        .select('*, subklanten(name)')
        .eq('id', id)
        .eq('customer_id', customer.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!customer,
  });
}

export function useStatusHistory(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['status-history', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data, error } = await supabase
        .from('shipment_status_history')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('changed_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!shipmentId,
  });
}

export function useNoas(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['noas', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data, error } = await supabase
        .from('noas')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('noa_number', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!shipmentId,
  });
}

export function useOutbounds(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['outbounds', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data, error } = await supabase
        .from('outbounds')
        .select('*, hubs(code, name), pallets(*)')
        .eq('shipment_id', shipmentId)
        .order('pickup_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!shipmentId,
  });
}

export function useOuterboxes(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['outerboxes', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data, error } = await supabase
        .from('outerboxes')
        .select('*')
        .eq('shipment_id', shipmentId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!shipmentId,
  });
}

export function useSubklanten() {
  const { customer } = useAuth();
  return useQuery({
    queryKey: ['subklanten', customer?.id],
    queryFn: async () => {
      if (!customer) return [];
      const { data, error } = await supabase
        .from('subklanten')
        .select('*')
        .eq('customer_id', customer.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!customer,
  });
}

export function useClearances(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['clearances', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data, error } = await supabase
        .from('clearances')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('created_at', { ascending: true });
      if (error) {
        console.warn('Clearances query failed:', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: !!shipmentId,
    retry: false,
  });
}

export function useInspections(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['inspections', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('created_at', { ascending: true });
      if (error) {
        console.warn('Inspections query failed:', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: !!shipmentId,
    retry: false,
  });
}

// Batch fetch clearances & inspections for current shipments only (for list view badges)
export function useAllClearances(shipmentIds: string[]) {
  return useQuery({
    queryKey: ['all-clearances', shipmentIds],
    queryFn: async () => {
      if (shipmentIds.length === 0) return [];
      const { data, error } = await supabase
        .from('clearances')
        .select('shipment_id, status, colli_cleared')
        .in('shipment_id', shipmentIds);
      if (error) {
        console.warn('Clearances query failed (table may not exist yet):', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: shipmentIds.length > 0,
    retry: false,
  });
}

export function useAllInspections(shipmentIds: string[]) {
  return useQuery({
    queryKey: ['all-inspections', shipmentIds],
    queryFn: async () => {
      if (shipmentIds.length === 0) return [];
      const { data, error } = await supabase
        .from('inspections')
        .select('shipment_id, status')
        .in('shipment_id', shipmentIds);
      if (error) {
        console.warn('Inspections query failed (table may not exist yet):', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: shipmentIds.length > 0,
    retry: false,
  });
}
