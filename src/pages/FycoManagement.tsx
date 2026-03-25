import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Loader2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface FycoRow {
  id: string;
  barcode: string;
  created_at: string;
  shipment_id: string;
  mawb: string;
  hub_code: string | null;
  warehouse: string | null;
  subklant: string | null;
  location: string | null;
  checked: boolean;
  released: boolean;
  delivered: boolean;
}

function useFycoData() {
  return useQuery({
    queryKey: ['fyco-management'],
    queryFn: async () => {
      // Get all inspections with shipment data
      const { data: inspections, error } = await supabase
        .from('inspections')
        .select('id, barcode, parcel_barcode, created_at, shipment_id')
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!inspections || inspections.length === 0) return [];

      // Get unique shipment IDs
      const shipmentIds = [...new Set(inspections.map(i => i.shipment_id))];

      // Fetch shipment details
      const { data: shipments, error: shipErr } = await supabase
        .from('shipments')
        .select('id, mawb, warehouse, subklanten(name), customers(name)')
        .in('id', shipmentIds);
      if (shipErr) throw shipErr;

      const shipmentMap = new Map((shipments ?? []).map(s => [s.id, s]));

      return inspections.map(insp => {
        const ship = shipmentMap.get(insp.shipment_id);
        return {
          id: insp.id,
          barcode: insp.barcode ?? insp.parcel_barcode ?? '—',
          created_at: insp.created_at,
          shipment_id: insp.shipment_id,
          mawb: ship?.mawb ?? '—',
          hub_code: ship?.hub_code ?? null,
          warehouse: ship?.warehouse ?? null,
          subklant: (ship as any)?.subklanten?.name ?? null,
          // These fields are placeholders for future logic
          location: null,
          checked: false,
          released: false,
          delivered: false,
        } as FycoRow;
      });
    },
  });
}

export default function FycoManagement() {
  const { data: rows = [], isLoading } = useFycoData();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fyco Management</h1>
          <p className="text-sm text-muted-foreground">Customs inspection parcels overview</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          No inspection parcels found.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>MAWB</TableHead>
                <TableHead>HUB</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Parcel</TableHead>
                <TableHead>Sub Client</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Release</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Scan Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-sm font-medium">{row.mawb}</TableCell>
                  <TableCell>{row.hub_code ?? '—'}</TableCell>
                  <TableCell>{row.warehouse ?? '—'}</TableCell>
                  <TableCell className="font-mono text-sm">{row.barcode}</TableCell>
                  <TableCell>{row.subklant ?? '—'}</TableCell>
                  <TableCell>{row.location ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={row.checked ? 'default' : 'secondary'} className="text-xs">
                      {row.checked ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.released ? 'default' : 'secondary'} className="text-xs">
                      {row.released ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.delivered ? 'default' : 'secondary'} className="text-xs">
                      {row.delivered ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {row.created_at ? format(new Date(row.created_at), 'dd/MM/yyyy HH:mm') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
