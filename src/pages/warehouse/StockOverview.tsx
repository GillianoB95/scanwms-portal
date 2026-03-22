import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function StockOverview() {
  const { data: auth } = useWarehouseAuth();
  const warehouseId = auth?.warehouseId;
  const [selectedShipment, setSelectedShipment] = useState<string | null>(null);

  const { data: shipments = [] } = useQuery({
    queryKey: ['stock-shipments', warehouseId],
    queryFn: async () => {
      if (!warehouseId) return [];
      const { data } = await supabase
        .from('shipments')
        .select('id, mawb, colli_expected, status, customers(name, short_name)')
        .eq('warehouse_id', warehouseId)
        .eq('status', 'In Stock')
        .order('unloaded_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!warehouseId,
  });

  const { data: boxCounts = {} } = useQuery({
    queryKey: ['stock-box-counts', shipments.map((s: any) => s.id)],
    queryFn: async () => {
      const ids = shipments.map((s: any) => s.id);
      if (ids.length === 0) return {};
      const { data } = await supabase
        .from('outerboxes')
        .select('shipment_id, status')
        .in('shipment_id', ids);
      const counts: Record<string, { scanned: number; outbound: number }> = {};
      (data ?? []).forEach((b: any) => {
        if (!counts[b.shipment_id]) counts[b.shipment_id] = { scanned: 0, outbound: 0 };
        counts[b.shipment_id].scanned++;
        if (b.status === 'scanned_out') counts[b.shipment_id].outbound++;
      });
      return counts;
    },
    enabled: shipments.length > 0,
  });

  const { data: boxes = [] } = useQuery({
    queryKey: ['stock-boxes-detail', selectedShipment],
    queryFn: async () => {
      if (!selectedShipment) return [];
      const { data } = await supabase
        .from('outerboxes')
        .select('id, barcode, status, scanned_in_at')
        .eq('shipment_id', selectedShipment)
        .order('scanned_in_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!selectedShipment,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Stock Overview</h1>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>MAWB</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Subklant</TableHead>
                <TableHead className="text-right">Colli Total</TableHead>
                <TableHead className="text-right">Scanned In</TableHead>
                <TableHead className="text-right">Not Scanned</TableHead>
                <TableHead className="text-right">In Stock</TableHead>
                <TableHead className="text-right">Outbound</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No shipments in stock</TableCell></TableRow>
              ) : shipments.map((s: any) => {
                const c = boxCounts[s.id] ?? { scanned: 0, outbound: 0 };
                const notScanned = Math.max((s.colli_expected ?? 0) - c.scanned, 0);
                const inStock = c.scanned - c.outbound;
                return (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedShipment(s.id)}
                  >
                    <TableCell className="font-mono font-medium">{s.mawb}</TableCell>
                    <TableCell>{(s.customers as any)?.name ?? '—'}</TableCell>
                    <TableCell>{(s.customers as any)?.short_name ?? '—'}</TableCell>
                    <TableCell className="text-right">{s.colli_expected ?? 0}</TableCell>
                    <TableCell className="text-right">{c.scanned}</TableCell>
                    <TableCell className="text-right">{notScanned}</TableCell>
                    <TableCell className="text-right font-medium">{inStock}</TableCell>
                    <TableCell className="text-right">{c.outbound}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedShipment} onOpenChange={(open) => !open && setSelectedShipment(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Boxes — {shipments.find((s: any) => s.id === selectedShipment)?.mawb}</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scanned At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boxes.map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono">{b.barcode}</TableCell>
                    <TableCell className="capitalize">{b.status?.replace('_', ' ')}</TableCell>
                    <TableCell>{b.scanned_in_at ? new Date(b.scanned_in_at).toLocaleString() : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
