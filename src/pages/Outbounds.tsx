import { useEffect, useState } from 'react';
import { Loader2, Download, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { StatusBadge } from '@/components/StatusBadge';

interface OutboundRow {
  id: string;
  outbound_number: string;
  pickup_date: string | null;
  truck_reference: string | null;
  license_plate: string | null;
  seal_number: string | null;
  status: string;
  departed_at: string | null;
  prepared_at: string | null;
  hub: string | null;
}

export default function Outbounds() {
  const { customer } = useAuth();
  const [outbounds, setOutbounds] = useState<OutboundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!customer?.id) return;

    const fetch = async () => {
      setLoading(true);
      setError(null);

      try {
        // Get all shipment IDs belonging to this customer (including sub-accounts)
        const customerIds = [customer.id];
        
        // If this is a parent customer, also include sub-accounts
        if (!customer.parent_customer_id) {
          const { data: subAccounts } = await supabase
            .from('customers')
            .select('id')
            .eq('parent_customer_id', customer.id);
          if (subAccounts) {
            customerIds.push(...subAccounts.map(s => s.id));
          }
        }

        // Get shipment IDs for this customer
        const { data: shipments } = await supabase
          .from('shipments')
          .select('id')
          .in('customer_id', customerIds);

        if (!shipments || shipments.length === 0) {
          setOutbounds([]);
          setLoading(false);
          return;
        }

        const shipmentIds = shipments.map(s => s.id);

        // Get pallets linked to these shipments' outerboxes
        const { data: outerboxes } = await supabase
          .from('outerboxes')
          .select('pallet_id')
          .in('shipment_id', shipmentIds)
          .not('pallet_id', 'is', null);

        if (!outerboxes || outerboxes.length === 0) {
          setOutbounds([]);
          setLoading(false);
          return;
        }

        const palletIds = [...new Set(outerboxes.map(o => o.pallet_id))];

        // Get pallets with outbound_id
        const { data: pallets } = await supabase
          .from('pallets')
          .select('id, outbound_id, hub')
          .in('id', palletIds)
          .not('outbound_id', 'is', null);

        if (!pallets || pallets.length === 0) {
          setOutbounds([]);
          setLoading(false);
          return;
        }

        const outboundIds = [...new Set(pallets.map(p => p.outbound_id))];

        // Build hub lookup per outbound
        const hubsByOutbound: Record<string, Set<string>> = {};
        for (const p of pallets) {
          if (!hubsByOutbound[p.outbound_id]) hubsByOutbound[p.outbound_id] = new Set();
          if (p.hub) hubsByOutbound[p.outbound_id].add(p.hub);
        }

        // Fetch outbound records
        const { data: outboundData, error: obError } = await supabase
          .from('outbounds')
          .select('id, outbound_number, pickup_date, truck_reference, license_plate, seal_number, status, departed_at, prepared_at')
          .in('id', outboundIds)
          .in('status', ['prepared', 'departed'])
          .order('pickup_date', { ascending: false });

        if (obError) throw obError;

        const rows: OutboundRow[] = (outboundData || []).map(ob => ({
          ...ob,
          hub: hubsByOutbound[ob.id] ? [...hubsByOutbound[ob.id]].join(', ') : null,
        }));

        setOutbounds(rows);
      } catch (err) {
        console.error('Outbounds fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load outbounds');
      } finally {
        setLoading(false);
      }
    };

    fetch();
  }, [customer?.id]);

  const handleDownloadCmr = async (outboundId: string) => {
    if (!customer?.id) return;
    setDownloadingId(outboundId);

    try {
      // Look up CMR record for this outbound + customer's subklant
      const customerIds = [customer.id];
      if (!customer.parent_customer_id) {
        const { data: subs } = await supabase
          .from('customers')
          .select('id')
          .eq('parent_customer_id', customer.id);
        if (subs) customerIds.push(...subs.map(s => s.id));
      }

      const { data: cmrRecords } = await supabase
        .from('cmr_records')
        .select('file_path, file_name')
        .eq('outbound_id', outboundId)
        .in('subclient_id', customerIds);

      if (!cmrRecords || cmrRecords.length === 0) {
        alert('No CMR file available for this outbound.');
        return;
      }

      for (const cmr of cmrRecords) {
        const { data: fileData, error: dlError } = await supabase.storage
          .from('cmr-files')
          .download(cmr.file_path);

        if (dlError || !fileData) {
          console.error('CMR download error:', dlError);
          alert('Failed to download CMR file.');
          continue;
        }

        const url = URL.createObjectURL(fileData);
        const a = document.createElement('a');
        a.href = url;
        a.download = cmr.file_name || 'CMR.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('CMR download failed:', err);
      alert('Failed to download CMR.');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border bg-card p-6 text-sm text-destructive">Failed to load outbounds: {error}</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Outbounds</h1>
        <p className="text-muted-foreground text-sm mt-1">Outbound shipments containing your colli</p>
      </div>

      <div className="bg-card rounded-xl border animate-fade-in">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">Date</th>
                <th className="text-left px-5 py-3 font-medium">Hub</th>
                <th className="text-left px-5 py-3 font-medium">Truck Ref</th>
                <th className="text-left px-5 py-3 font-medium">License Plate</th>
                <th className="text-left px-5 py-3 font-medium">Seal Nr</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-center px-5 py-3 font-medium">CMR</th>
              </tr>
            </thead>
            <tbody>
              {outbounds.map(ob => {
                const displayDate = ob.status === 'departed' && ob.departed_at
                  ? new Date(ob.departed_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : ob.pickup_date
                    ? new Date(ob.pickup_date).toLocaleDateString('en-GB')
                    : '—';

                return (
                  <tr key={ob.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-3 tabular-nums">{displayDate}</td>
                    <td className="px-5 py-3 font-medium">{ob.hub || '—'}</td>
                    <td className="px-5 py-3 font-mono">{ob.truck_reference || '—'}</td>
                    <td className="px-5 py-3 font-mono">{ob.license_plate || '—'}</td>
                    <td className="px-5 py-3 font-mono">{ob.seal_number || '—'}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={ob.status === 'departed' ? 'Departed' : 'Prepared'} />
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() => handleDownloadCmr(ob.id)}
                        disabled={downloadingId === ob.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors"
                      >
                        {downloadingId === ob.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        CMR
                      </button>
                    </td>
                  </tr>
                );
              })}
              {outbounds.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">
                    <Truck className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    No outbounds found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
