import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// All shipments across all customers (staff only)
export function useAllShipments() {
  return useQuery({
    queryKey: ['staff-all-shipments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('*, customers(name), subklanten(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// All customers
export function useAllCustomers() {
  return useQuery({
    queryKey: ['staff-all-customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*, customer_users(id, email, role)')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

// All hubs
export function useAllHubs() {
  return useQuery({
    queryKey: ['staff-all-hubs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hubs')
        .select('*')
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Hub mutations
export function useCreateHub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hub: { code: string; name: string; carrier: string; active: boolean }) => {
      const { data, error } = await supabase.from('hubs').insert(hub).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-all-hubs'] }),
  });
}

export function useUpdateHub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; code?: string; name?: string; carrier?: string; active?: boolean }) => {
      const { error } = await supabase.from('hubs').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-all-hubs'] }),
  });
}

export function useDeleteHub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('hubs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-all-hubs'] }),
  });
}

// Delete shipment
export function useDeleteShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('shipments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-all-shipments'] }),
  });
}

// Update shipment (for staff inline edits)
export function useUpdateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase.from('shipments').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-all-shipments'] }),
  });
}

// Shipment blocks
export function useShipmentBlocks() {
  return useQuery({
    queryKey: ['shipment-blocks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipment_blocks')
        .select('*')
        .is('removed_at', null);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (block: { shipment_id: string; block_type: string; reason: string; created_by?: string }) => {
      const { error } = await supabase.from('shipment_blocks').insert(block);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipment-blocks'] });
    },
  });
}

export function useRemoveBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blockId: string) => {
      const { error } = await supabase
        .from('shipment_blocks')
        .update({ removed_at: new Date().toISOString() })
        .eq('id', blockId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipment-blocks'] });
    },
  });
}

// Inspections
export function useShipmentInspections() {
  return useQuery({
    queryKey: ['all-inspections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateInspections() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inspections: { shipment_id: string; barcode: string }[]) => {
      const { error } = await supabase.from('inspections').insert(inspections);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-inspections'] });
      qc.invalidateQueries({ queryKey: ['staff-all-shipments'] });
    },
  });
}

// All warehouses
export function useAllWarehouses() {
  return useQuery({
    queryKey: ['staff-warehouses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });
}
