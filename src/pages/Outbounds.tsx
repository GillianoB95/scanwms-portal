import { useEffect, useState } from 'react';
import { Loader2, Download, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAccessibleCustomerIds } from '@/hooks/use-accessible-customers';
import { StatusBadge } from '@/components/StatusBadge';

interface OutboundRow {
  id: string;
  outbound_number: string;
  pickup_date: string | null;
  truck_reference: string | null;
  license_plate: string | null;
  
  status: string;
  hub: string | null;
}

export default function Outbounds() {
  const { customer } = useAuth();
  const { data: accessibleIds = [] } = useAccessibleCustomerIds();
  const [outbounds, setOutbounds] = useState<OutboundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!customer?.id || accessibleIds.length === 0) return;

    const fetch = async () => {
      setLoading(true);
      setError(null);

      try {
        // Get shipment IDs for accessible customers
        const { data: shipments, error: shipErr } = await supabase
          .from('shipments')
          .select('id')
          .in('customer_id', accessibleIds);

        console.log('[OUTBOUNDS] Step 1 - shipments for accessibleIds', { accessibleIds, shipments: shipments?.length, shipErr });

        if (!shipments || shipments.length === 0) {
          setOutbounds([]);
          setLoading(false);
          return;
        }

        const shipmentIds = shipments.map(s => s.id);

        // Get outerboxes linked to these shipments that have a pallet
        const { data: outerboxes, error: obErr } = await supabase
          .from('outerboxes')
          .select('pallet_id')
          .in('shipment_id', shipmentIds)
          .not('pallet_id', 'is', null);

        console.log('[OUTBOUNDS] Step 2 - outerboxes with pallet_id', { shipmentIds, outerboxes: outerboxes?.length, obErr });

        if (!outerboxes || outerboxes.length === 0) {
          setOutbounds([]);
          setLoading(false);
          return;
        }

        const palletIds = [...new Set(outerboxes.map(o => o.pallet_id))];

        // Get pallets with outbound_id via RPC (bypasses RLS on pallets)
        const { data: rpcData, error: palErr } = await supabase
          .rpc('get_outbound_ids_for_pallets', { pallet_ids: palletIds });

        const pallets = rpcData?.get_outbound_ids_for_pallets || rpcData || [];

        console.log('[OUTBOUNDS] Step 3 - pallets via RPC', { palletIds, pallets: pallets?.length, palErr });

        if (!pallets || pallets.length === 0) {
          setOutbounds([]);
          setLoading(false);
          return;
        }

        const outboundIds = [...new Set(pallets.map(p => p.outbound_id))];

        // Build hub lookup per outbound from outerboxes using palletIds from step 2
        const hubsByOutbound: Record<string, Set<string>> = {};
        const { data: obsWithHub } = await supabase
          .from('outerboxes')
          .select('pallet_id, hub')
          .in('pallet_id', palletIds)
          .not('hub', 'is', null);

        if (obsWithHub) {
          // Map pallet_id → outbound_id using RPC results
          const palletToOutbound: Record<string, string> = {};
          for (const p of pallets) palletToOutbound[p.id] = p.outbound_id;

          for (const ob of obsWithHub) {
            const obId = palletToOutbound[ob.pallet_id];
            if (!obId) continue;
            if (!hubsByOutbound[obId]) hubsByOutbound[obId] = new Set();
            if (ob.hub) hubsByOutbound[obId].add(ob.hub);
          }
        }

        // Fetch outbound records (no departed_at/prepared_at columns)
        const { data: outboundData, error: obError } = await supabase
          .from('outbounds')
          .select('id, outbound_number, pickup_date, truck_reference, license_plate, status')
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
  }, [customer?.id, accessibleIds]);

  const handleDownloadCmr = async (outboundId: string) => {
    if (!customer?.id) return;
    setDownloadingId(outboundId);

    try {
      // Look up CMR record for this outbound + accessible customers
      const { data: cmrRecords } = await supabase
        .from('cmr_records')
        .select('file_path, file_name')
        .eq('outbound_id', outboundId)
        .in('subclient_id', accessibleIds);

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
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-center px-5 py-3 font-medium">CMR</th>
              </tr>
            </thead>
            <tbody>
              {outbounds.map(ob => {
                const displayDate = ob.pickup_date
                    ? new Date(ob.pickup_date).toLocaleDateString('en-GB')
                    : '—';

                return (
                  <tr key={ob.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-3 tabular-nums">{displayDate}</td>
                    <td className="px-5 py-3 font-medium">{ob.hub || '—'}</td>
                    <td className="px-5 py-3 font-mono">{ob.truck_reference || '—'}</td>
                    <td className="px-5 py-3 font-mono">{ob.license_plate || '—'}</td>
                    
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
                  <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">
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
