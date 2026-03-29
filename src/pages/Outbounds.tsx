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
  status: string;
  hub_code: string | null;
}

export default function Outbounds() {
  const { customer } = useAuth();
  const [outbounds, setOutbounds] = useState<OutboundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!customer?.id) {
      setLoading(false);
      return;
    }

    const fetchOutbounds = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: rpcErr } = await supabase.rpc('get_customer_outbounds');
        if (rpcErr) throw rpcErr;
        setOutbounds(data || []);
      } catch (err: any) {
        console.error('Outbounds fetch error:', JSON.stringify(err));
        const msg = err?.message || err?.msg || (typeof err === 'string' ? err : 'Failed to load outbounds');
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchOutbounds();
  }, [customer?.id]);

  const handleDownloadCmr = async (outboundId: string) => {
    if (!customer?.id) return;
    setDownloadingId(outboundId);

    try {
      const { data: cmrRecords } = await supabase
        .from('cmr_records')
        .select('file_path, file_name')
        .eq('outbound_id', outboundId);

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
                    <td className="px-5 py-3 font-medium">{ob.hub_code || '—'}</td>
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
