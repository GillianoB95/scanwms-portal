import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAccessibleCustomerIds } from './use-accessible-customers';

export function useShipments() {
  const { data: accessibleIds = [] } = useAccessibleCustomerIds();
  return useQuery({
    queryKey: ['shipments', accessibleIds],
    queryFn: async () => {
      if (accessibleIds.length === 0) return [];
      const { data, error } = await supabase
        .from('shipments')
        .select('*, subklanten(name)')
        .in('customer_id', accessibleIds)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Shipments query failed:', error.message);
        throw error;
      }
      return data ?? [];
    },
    enabled: accessibleIds.length > 0,
    retry: false,
  });
}

export function useShipment(id: string | undefined) {
  const { data: accessibleIds = [] } = useAccessibleCustomerIds();
  return useQuery({
    queryKey: ['shipment', id, accessibleIds],
    queryFn: async () => {
      if (!id || accessibleIds.length === 0) return null;
      const { data, error } = await supabase
        .from('shipments')
        .select('*, subklanten(name)')
        .eq('id', id)
        .in('customer_id', accessibleIds)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id && accessibleIds.length > 0,
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
    queryKey: ['subklanten', customer?.id, customer?.parent_id],
    queryFn: async () => {
      if (!customer) return [];
      const ownerId = customer.parent_id ?? customer.id;
      const { data: subs, error } = await supabase
        .from('subklanten')
        .select('*')
        .eq('customer_id', ownerId);
      if (error) throw error;
      return subs ?? [];
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
        .select('*, manifest_parcels(outerbox_barcode, hub)')
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
        console.warn('Clearances query failed:', error.message);
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
        console.warn('Inspections query failed:', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: shipmentIds.length > 0,
    retry: false,
  });
}
