import { useState, useRef, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/StatusBadge';
import { useHubs } from '@/hooks/use-hubs';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import {
  Plus, ScanBarcode, FileText, Download, Printer, Upload, ArrowLeft,
  Search, ChevronDown, ChevronRight, Loader2, Truck, Undo2, Check, X, Trash2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { generateCmrWorkbook, downloadCmrWorkbook, printCmrViaPrintNode, type CmrData } from '@/lib/cmr-generator';
import JSZip from 'jszip';

export default function WarehouseOutbound() {
  const { data: auth } = useWarehouseAuth();
  const warehouseId = auth?.warehouseId;
  const { data: hubs = [] } = useHubs();
  const { toast } = useToast();
  const qc = useQueryClient();
  const palletRef = useRef<HTMLInputElement>(null);

  // List state
  const [search, setSearch] = useState('');
  const [hubFilter, setHubFilter] = useState('all');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [hub, setHub] = useState('');
  const [truckRef, setTruckRef] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [pickupTime, setPickupTime] = useState('');

  // Active outbound (scan view)
  const [activeOutbound, setActiveOutbound] = useState<string | null>(null);
  const [palletBarcode, setPalletBarcode] = useState('');
  const [boxDetailPalletId, setBoxDetailPalletId] = useState<string | null>(null);

  // CMR state
  const [cmrOutbound, setCmrOutbound] = useState<any>(null);
  const [cmrAddressId, setCmrAddressId] = useState('');
  const [cmrSealNumber, setCmrSealNumber] = useState('');
  const [cmrGenerating, setCmrGenerating] = useState(false);

  // ─── Queries ───
  const { data: outbounds = [], isLoading } = useQuery({
    queryKey: ['warehouse-outbounds', auth?.isWarehouse],
    queryFn: async () => {
      const { data } = await supabase
        .from('outbounds')
        .select('*, hubs(name, code, carrier)')
        .order('pickup_date', { ascending: false });
      const outboundList = (data ?? []).map((o: any) => ({
        ...o,
        hub_name: o.hubs?.name ?? o.hub_code ?? '—',
        hub_code_display: o.hubs?.code ?? o.hub_code ?? '—',
        carrier: o.hubs?.carrier ?? '—',
      }));

      // Fetch pallet totals per outbound
      const outboundIds = outboundList.map((o: any) => o.id);
      if (outboundIds.length > 0) {
        const { data: allPallets } = await supabase
          .from('pallets')
          .select('outbound_id, pieces, weight')
          .in('outbound_id', outboundIds);
        const palletMap = new Map<string, { colli: number; weight: number; palletCount: number }>();
        for (const p of (allPallets ?? [])) {
          const entry = palletMap.get(p.outbound_id) || { colli: 0, weight: 0, palletCount: 0 };
          entry.colli += p.pieces || 0;
          entry.weight += parseFloat(p.weight) || 0;
          entry.palletCount += 1;
          palletMap.set(p.outbound_id, entry);
        }
        for (const o of outboundList) {
          const totals = palletMap.get(o.id);
          o.total_colli = totals?.colli ?? 0;
          o.total_weight = totals?.weight ?? 0;
          o.pallet_count = totals?.palletCount ?? 0;
        }
      }

      return outboundList;
    },
    enabled: !!auth?.isWarehouse,
  });

  const activeOutboundRecord = outbounds.find((o: any) => o.id === activeOutbound);

  const { data: pallets = [] } = useQuery({
    queryKey: ['outbound-pallets', activeOutbound],
    queryFn: async () => {
      if (!activeOutbound) return [];
      const { data } = await supabase
        .from('pallets')
        .select('*, shipments(mawb, customs_cleared, customers(short_name))')
        .eq('outbound_id', activeOutbound);
      // Fetch outerboxes for each pallet to get scanned_in_at
      const palletData = data ?? [];
      if (palletData.length > 0) {
        const palletIds = palletData.map((p: any) => p.id);
        const { data: boxes } = await supabase
          .from('outerboxes')
          .select('id, barcode, pallet_id, scanned_in_at')
          .in('pallet_id', palletIds)
          .neq('status', 'deleted');
        const boxMap = new Map<string, any[]>();
        for (const b of (boxes ?? [])) {
          if (!boxMap.has(b.pallet_id)) boxMap.set(b.pallet_id, []);
          boxMap.get(b.pallet_id)!.push(b);
        }
        for (const p of palletData) {
          p._boxes = boxMap.get(p.id) ?? [];
          // Use earliest box scan time as pallet scan time
          const scanTimes = p._boxes.filter((b: any) => b.scanned_in_at).map((b: any) => new Date(b.scanned_in_at).getTime());
          p._scannedAt = scanTimes.length > 0 ? new Date(Math.min(...scanTimes)).toISOString() : null;
        }
      }
      return palletData;
    },
    enabled: !!activeOutbound,
  });

  const { data: cmrHubData } = useQuery({
    queryKey: ['hub-data-for-cmr', cmrOutbound?.hub_code],
    queryFn: async () => {
      if (!cmrOutbound?.hub_code) return null;
      const { data } = await supabase.from('hubs').select('id, code, name').eq('code', cmrOutbound.hub_code).maybeSingle();
      return data;
    },
    enabled: !!cmrOutbound?.hub_code,
  });

  const { data: hubAddresses = [] } = useQuery({
    queryKey: ['hub-addresses-for-cmr', cmrHubData?.id],
    queryFn: async () => {
      if (!cmrHubData?.id) return [];
      const { data } = await supabase.from('hub_addresses').select('*').eq('hub_id', cmrHubData.id).order('name');
      return data ?? [];
    },
    enabled: !!cmrHubData?.id,
  });

  const { data: warehouseData } = useQuery({
    queryKey: ['warehouse-cmr-data', warehouseId],
    queryFn: async () => {
      if (warehouseId) {
        const { data } = await supabase.from('warehouses').select('*').eq('id', warehouseId).maybeSingle();
        if (data) return data;
      }
      // Fallback: fetch first warehouse if no warehouse_id assigned
      const { data } = await supabase.from('warehouses').select('*').order('code').limit(1).maybeSingle();
      return data;
    },
    enabled: !!auth?.isWarehouse,
  });

  const { data: cmrPallets = [] } = useQuery({
    queryKey: ['cmr-pallets', cmrOutbound?.id],
    queryFn: async () => {
      if (!cmrOutbound?.id) return [];
      const { data } = await supabase
        .from('pallets')
        .select('*, shipments(mawb, customers(short_name))')
        .eq('outbound_id', cmrOutbound.id);
      return data ?? [];
    },
    enabled: !!cmrOutbound?.id,
  });

  // ─── Filtering & grouping (staff portal style) ───
  const hubOptions = useMemo(() => {
    const set = new Set(outbounds.map((o: any) => o.hub_name).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [outbounds]);

  const filtered = useMemo(() => {
    return outbounds.filter((o: any) => {
      if (search && !o.truck_reference?.toLowerCase().includes(search.toLowerCase()) && !String(o.outbound_number ?? '').toLowerCase().includes(search.toLowerCase()) && !o.license_plate?.toLowerCase().includes(search.toLowerCase())) return false;
      if (hubFilter !== 'all' && o.hub_name !== hubFilter) return false;
      return true;
    });
  }, [outbounds, search, hubFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach((o: any) => {
      const dateKey = o.pickup_date ? format(new Date(o.pickup_date), 'yyyy-MM-dd') : 'No Date';
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(o);
    });
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  // Auto-expand most recent date
  const hasAutoExpanded = useRef(false);
  useEffect(() => {
    if (grouped.length > 0 && !hasAutoExpanded.current) {
      setExpandedDates(new Set([grouped[0][0]]));
      hasAutoExpanded.current = true;
    }
  }, [grouped]);

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  // ─── Mutations ───
  const createOutbound = useMutation({
    mutationFn: async () => {
      const insertData: any = {
        hub_code: hub,
        truck_reference: truckRef,
        license_plate: licensePlate || null,
        pickup_date: pickupDate,
        pickup_time: pickupTime || null,
        status: 'preparing',
      };
      if (warehouseId) insertData.warehouse_id = warehouseId;
      const { data, error } = await supabase.from('outbounds').insert(insertData).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setShowCreate(false);
      setActiveOutbound(data.id);
      setHub(''); setTruckRef(''); setPickupDate(''); setLicensePlate(''); setPickupTime('');
      qc.invalidateQueries({ queryKey: ['warehouse-outbounds'] });
      toast({ title: 'Outbound created' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const addPallet = useMutation({
    mutationFn: async (code: string) => {
      const { data: pallet, error: findErr } = await supabase
        .from('pallets')
        .select('id, shipment_id, hub_code, shipments(customs_cleared)')
        .eq('pallet_number', code)
        .maybeSingle();
      if (findErr || !pallet) throw new Error('Pallet not found');

      const outboundHub = activeOutboundRecord?.hub_code;
      if (outboundHub && pallet.hub_code && pallet.hub_code !== outboundHub) {
        throw new Error(`This pallet belongs to hub ${pallet.hub_code}. This outbound is for hub ${outboundHub}. Hubs cannot be mixed in one outbound.`);
      }

      const { data: blocks } = await supabase
        .from('shipment_blocks')
        .select('reason')
        .eq('shipment_id', pallet.shipment_id)
        .eq('block_type', 'outbound')
        .is('removed_at', null);
      if (blocks && blocks.length > 0) {
        throw new Error(`Outbound blocked: ${blocks[0].reason || 'No reason provided'}`);
      }

      if (!(pallet.shipments as any)?.customs_cleared) {
        throw new Error('Shipment not customs cleared — cannot add to outbound');
      }

      const { count } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .eq('shipment_id', pallet.shipment_id)
        .eq('status', 'Under Inspection');
      if (count && count > 0) {
        throw new Error('Shipment has open inspections — cannot add to outbound');
      }

      // Fyco check: ensure all inspection parcels on this pallet's boxes have been scanned
      const { data: palletBoxes } = await supabase
        .from('outerboxes')
        .select('barcode')
        .eq('pallet_id', pallet.id)
        .neq('status', 'deleted');
      if (palletBoxes && palletBoxes.length > 0) {
        const boxBarcodes = palletBoxes.map(b => b.barcode);
        const { data: unscannedFyco } = await supabase
          .from('inspections')
          .select('id', { count: 'exact', head: true })
          .eq('shipment_id', pallet.shipment_id)
          .in('parcel_barcode', boxBarcodes)
          .is('scan_time', null);
        if (unscannedFyco && unscannedFyco.length > 0) {
          throw new Error('Fyco parcels on this pallet have not been scanned yet.');
        }
      }

      const { error } = await supabase
        .from('pallets')
        .update({ outbound_id: activeOutbound })
        .eq('id', pallet.id);
      if (error) throw error;

      // If outbound was already prepared, reset to preparing
      if (activeOutboundRecord?.status === 'prepared') {
        await supabase.from('outbounds').update({ status: 'preparing' }).eq('id', activeOutbound);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound-pallets', activeOutbound] });
      qc.invalidateQueries({ queryKey: ['warehouse-outbounds'] });
      toast({ title: 'Pallet added to outbound' });
      setPalletBarcode('');
      palletRef.current?.focus();
    },
    onError: (err: any) => toast({ title: 'Cannot add pallet', description: err.message, variant: 'destructive' }),
  });

  const confirmOutbound = useMutation({
    mutationFn: async () => {
      if (!activeOutbound) return;
      const { error } = await supabase
        .from('outbounds')
        .update({ status: 'prepared' })
        .eq('id', activeOutbound);
      if (error) throw error;

      const palletIds = pallets.map((p: any) => p.id);
      if (palletIds.length > 0) {
        const shipmentIds = [...new Set(pallets.map((p: any) => p.shipment_id))];
        for (const sid of shipmentIds) {
          await supabase
            .from('outerboxes')
            .update({ status: 'scanned_out' })
            .eq('shipment_id', sid)
            .eq('status', 'scanned_in');
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse-outbounds'] });
      toast({ title: 'Scan finished — outbound prepared' });
    },
  });

  const markDeparted = useMutation({
    mutationFn: async () => {
      if (!activeOutbound) return;
      const { error } = await supabase.from('outbounds').update({ status: 'departed' }).eq('id', activeOutbound);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse-outbounds'] });
      toast({ title: 'Truck departed' });
      setActiveOutbound(null);
    },
  });

  const markPickup = async (id: string) => {
    const { error } = await supabase.from('outbounds').update({ status: 'departed' }).eq('id', id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    qc.invalidateQueries({ queryKey: ['warehouse-outbounds'] });
    toast({ title: 'Outbound marked as departed' });
  };

  const undoPickup = async (id: string) => {
    const { error } = await supabase.from('outbounds').update({ status: 'preparing' }).eq('id', id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    qc.invalidateQueries({ queryKey: ['warehouse-outbounds'] });
    toast({ title: 'Pickup status reverted' });
  };

  const handlePalletScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!palletBarcode.trim() || !activeOutbound) return;
    addPallet.mutate(palletBarcode.trim());
  };

  const totalColli = pallets.reduce((sum: number, p: any) => sum + (p.pieces || 0), 0);
  const totalWeight = pallets.reduce((sum: number, p: any) => sum + (p.weight || 0), 0);

  // ─── CMR logic ───
  const buildCmrDataPerSubClient = (): { cmrMap: Map<string, CmrData>; error?: string } => {
    const selectedAddress = hubAddresses.find((a: any) => a.id === cmrAddressId);
    if (!selectedAddress) {
      return { cmrMap: new Map(), error: 'Select a hub address first' };
    }

    if (cmrPallets.length === 0) {
      return { cmrMap: new Map(), error: 'No pallets found for this outbound' };
    }

    const warehouseConfig = warehouseData ?? {
      name: auth?.warehouseId ? '' : 'Warehouse',
      cmr_name: '',
      cmr_street: '',
      cmr_postal_city: '',
      cmr_country: '',
      cmr_city: '',
    };

    const subClientGroups = new Map<string, typeof cmrPallets>();
    for (const p of cmrPallets) {
      const subClient = (p.shipments as any)?.customers?.short_name || 'Unknown';
      if (!subClientGroups.has(subClient)) subClientGroups.set(subClient, []);
      subClientGroups.get(subClient)!.push(p);
    }

    const result = new Map<string, CmrData>();
    for (const [subClient, scPallets] of subClientGroups) {
      const mawbMap = new Map<string, { colli: number; weight: number }>();
      for (const p of scPallets) {
        const mawb = (p.shipments as any)?.mawb || 'Unknown';
        const existing = mawbMap.get(mawb) || { colli: 0, weight: 0 };
        existing.colli += p.pieces || 0;
        existing.weight += parseFloat(p.weight) || 0;
        mawbMap.set(mawb, existing);
      }

      const lines = Array.from(mawbMap.entries()).map(([mawb, data]) => ({
        mawb,
        colli: data.colli,
        weightKg: Math.round(data.weight * 100) / 100,
      }));

      result.set(subClient, {
        warehouseName: warehouseConfig.cmr_name || warehouseConfig.name || '',
        warehouseStreet: warehouseConfig.cmr_street || '',
        warehousePostalCity: warehouseConfig.cmr_postal_city || '',
        warehouseCountry: warehouseConfig.cmr_country || '',
        warehouseCity: warehouseConfig.cmr_city || '',
        hubName: selectedAddress.hub_name || selectedAddress.name,
        hubStreet: selectedAddress.street || '',
        hubHouseNumber: selectedAddress.house_number || '',
        hubPostalCode: selectedAddress.postal_code || '',
        hubCity: selectedAddress.city || '',
        hubCountry: selectedAddress.country || '',
        truckReference: cmrOutbound?.truck_reference || '',
        outboundNumber: cmrOutbound?.outbound_number || '',
        sealNumber: cmrSealNumber,
        lines,
      });
    }

    return { cmrMap: result };
  };

  const handleDownloadCmr = async () => {
    setCmrGenerating(true);
    try {
      const { cmrMap, error } = buildCmrDataPerSubClient();
      if (error) {
        toast({ title: 'Cannot generate CMR', description: error, variant: 'destructive' });
        return;
      }
      if (cmrMap.size === 1) {
        const [subClient, data] = cmrMap.entries().next().value!;
        const wb = generateCmrWorkbook(data);
        downloadCmrWorkbook(wb, `CMR_${subClient}_${cmrOutbound?.outbound_number || ''}.xlsx`);
      } else {
        const zip = new JSZip();
        for (const [subClient, data] of cmrMap) {
          const wb = generateCmrWorkbook(data);
          const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          zip.file(`CMR_${subClient}_${cmrOutbound?.outbound_number || ''}.xlsx`, xlsxData);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CMR_${cmrOutbound?.outbound_number || 'outbound'}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast({ title: 'CMR files downloaded' });
    } catch (err: any) {
      toast({ title: 'Error generating CMR', description: err.message, variant: 'destructive' });
    } finally {
      setCmrGenerating(false);
    }
  };

  const handlePrintCmr = async () => {
    if (!warehouseData?.cmr_printer_id || !warehouseData?.cmr_printer_key) {
      toast({ title: 'No CMR printer configured', description: 'Set CMR printer in warehouse settings', variant: 'destructive' });
      return;
    }
    setCmrGenerating(true);
    try {
      const { cmrMap, error } = buildCmrDataPerSubClient();
      if (error) {
        toast({ title: 'Cannot print CMR', description: error, variant: 'destructive' });
        return;
      }
      let printed = 0;
      for (const [subClient, data] of cmrMap) {
        const wb = generateCmrWorkbook(data);
        const result = await printCmrViaPrintNode(
          wb,
          warehouseData.cmr_printer_id,
          warehouseData.cmr_printer_key,
          `CMR ${subClient} - ${cmrOutbound?.outbound_number || ''}`,
          4,
        );
        if (!result.success) {
          toast({ title: `Print failed for ${subClient}`, description: result.error, variant: 'destructive' });
        } else {
          printed++;
        }
      }
      toast({ title: `${printed} CMR(s) sent to printer (4 copies each)` });
    } catch (err: any) {
      toast({ title: 'Print error', description: err.message, variant: 'destructive' });
    } finally {
      setCmrGenerating(false);
    }
  };

  // ─── Loading ───
  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // ─── SCAN VIEW (active outbound) ───
  if (activeOutbound) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setActiveOutbound(null)}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            <h1 className="text-2xl font-bold">
              Outbound {activeOutboundRecord?.outbound_number ? `#${activeOutboundRecord.outbound_number}` : ''}
              {activeOutboundRecord?.hub_code_display && <span className="text-base font-mono text-muted-foreground ml-2">({activeOutboundRecord.hub_code_display})</span>}
            </h1>
          </div>
          {pallets.length > 0 && (
            <div className="flex items-center gap-4 text-sm">
              <span className="font-medium">{pallets.length} pallets</span>
              <span className="font-semibold">{totalColli} colli</span>
              <span className="font-semibold">{totalWeight.toFixed(2)} kg</span>
            </div>
          )}
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <form onSubmit={handlePalletScan} className="flex gap-2 max-w-md">
              <Input
                ref={palletRef}
                value={palletBarcode}
                onChange={e => setPalletBarcode(e.target.value)}
                placeholder="Scan pallet number..."
                className="font-mono"
                autoFocus
              />
              <Button type="submit" disabled={addPallet.isPending}>
                <ScanBarcode className="h-4 w-4" />
              </Button>
            </form>

            <Table>
              <TableHeader>
                 <TableRow>
                  <TableHead>Pallet</TableHead>
                  <TableHead>MAWB</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Hub</TableHead>
                  <TableHead className="text-right">Colli</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead>Scanned</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pallets.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Scan pallets to add</TableCell></TableRow>
                ) : pallets.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-medium">{p.pallet_number}</TableCell>
                    <TableCell className="font-mono text-sm">{(p.shipments as any)?.mawb ?? '—'}</TableCell>
                    <TableCell>{(p.shipments as any)?.customers?.short_name ?? '—'}</TableCell>
                    <TableCell>{p.hub_code}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto py-0.5 px-1.5 font-semibold tabular-nums"
                        onClick={() => setBoxDetailPalletId(p.id)}
                      >
                        {p.pieces ?? 0}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">{p.weight != null ? `${Number(p.weight).toFixed(2)} kg` : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p._scannedAt ? format(new Date(p._scannedAt), 'dd/MM HH:mm') : '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Remove from outbound"
                        onClick={async () => {
                          const { error } = await supabase
                            .from('pallets')
                            .update({ outbound_id: null })
                            .eq('id', p.id);
                          if (error) {
                            toast({ title: 'Failed to remove', description: error.message, variant: 'destructive' });
                          } else {
                            toast({ title: `${p.pallet_number} removed from outbound` });
                            qc.invalidateQueries({ queryKey: ['outbound-pallets', activeOutbound] });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {pallets.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="font-semibold">Total ({pallets.length} pallets)</TableCell>
                    <TableCell className="text-right font-semibold">{totalColli}</TableCell>
                    <TableCell className="text-right font-semibold">{totalWeight.toFixed(2)} kg</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableFooter>
              )}
            </Table>

            <div className="flex justify-end gap-2">
              {activeOutboundRecord?.status === 'prepared' ? (
                <Button onClick={() => markDeparted.mutate()} disabled={markDeparted.isPending} variant="default">
                  <Truck className="h-4 w-4 mr-2" />Truck departed
                </Button>
              ) : (
                <Button onClick={() => confirmOutbound.mutate()} disabled={pallets.length === 0 || confirmOutbound.isPending}>
                  Scan finished
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Box Detail Dialog */}
        <Dialog open={!!boxDetailPalletId} onOpenChange={v => { if (!v) setBoxDetailPalletId(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Box Details — {pallets.find((p: any) => p.id === boxDetailPalletId)?.pallet_number}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[400px] overflow-y-auto">
              {(() => {
                const pallet = pallets.find((p: any) => p.id === boxDetailPalletId);
                const boxes = pallet?._boxes ?? [];
                if (boxes.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">No boxes found</p>;
                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Barcode</TableHead>
                        <TableHead>Scanned At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {boxes.map((b: any) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-sm">{b.barcode}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {b.scanned_in_at ? format(new Date(b.scanned_in_at), 'dd/MM/yyyy HH:mm') : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}
            </div>
          </DialogContent>
        </Dialog>

        {/* CMR Dialog */}
        <Dialog open={!!cmrOutbound} onOpenChange={v => { if (!v) setCmrOutbound(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create CMR — {cmrHubData?.name || cmrOutbound?.outbound_number || cmrOutbound?.hub_code}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Hub Address *</Label>
                <Select value={cmrAddressId} onValueChange={setCmrAddressId}>
                  <SelectTrigger><SelectValue placeholder="Select delivery address" /></SelectTrigger>
                  <SelectContent>
                    {hubAddresses.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.hub_name || a.name} — {a.street} {a.house_number}, {a.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hubAddresses.length === 0 && (
                  <p className="text-xs text-muted-foreground">No addresses configured for this hub. Add them in Hub Management.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Seal Number *</Label>
                <Input value={cmrSealNumber} onChange={e => setCmrSealNumber(e.target.value)} placeholder="Seal number" />
              </div>
              <div className="space-y-2">
                <Label>Loading Reference</Label>
                <Input value={cmrOutbound?.truck_reference || ''} disabled className="bg-muted" />
              </div>
              {cmrPallets.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  {cmrPallets.length} pallet(s), {new Set(cmrPallets.map((p: any) => (p.shipments as any)?.customers?.short_name)).size} sub-client(s)
                </div>
              )}
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setCmrOutbound(null)}>Cancel</Button>
              <Button variant="outline" onClick={handleDownloadCmr} disabled={!cmrAddressId || !cmrSealNumber || cmrGenerating}>
                <Download className="h-4 w-4 mr-1" /> Download
              </Button>
              <Button onClick={handlePrintCmr} disabled={!cmrAddressId || !cmrSealNumber || cmrGenerating}>
                <Printer className="h-4 w-4 mr-1" /> Print CMR
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── LIST VIEW (staff portal style) ───
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Outbound</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage outbound pickups grouped by date</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />New Outbound
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search truck ref, outbound # or license plate..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={hubFilter} onValueChange={setHubFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Hub" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Hubs</SelectItem>
              {hubOptions.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
            </SelectContent>
          </Select>
          {(search || hubFilter !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setHubFilter('all'); }}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} outbound{filtered.length !== 1 ? 's' : ''} across {grouped.length} date{grouped.length !== 1 ? 's' : ''}</p>

      {grouped.length === 0 ? (
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">No outbound shipments found</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([dateKey, items]) => {
            const expanded = expandedDates.has(dateKey);
            const displayDate = dateKey !== 'No Date' ? format(new Date(dateKey), 'EEEE dd/MM/yyyy') : 'No Date';

            return (
              <div key={dateKey} className="bg-card rounded-xl border overflow-hidden">
                <button onClick={() => toggleDate(dateKey)} className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-semibold">{displayDate}</span>
                    <Badge variant="secondary">{items.length} outbound{items.length !== 1 ? 's' : ''}</Badge>
                  </div>
                </button>

                {expanded && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Outbound #</TableHead>
                        <TableHead>Carrier / Hub</TableHead>
                        <TableHead>Truck Reference</TableHead>
                        <TableHead>License Plate</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead className="text-right">Pallets</TableHead>
                        <TableHead className="text-right">Colli</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">CMR</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((o: any) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {o.outbound_number ? `Outbound #${o.outbound_number}` : '—'}
                          </TableCell>
                          <TableCell>
                            <div>
                              <span className="font-medium">{o.carrier}</span>
                              <span className="text-muted-foreground text-xs ml-2">({o.hub_code_display})</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{o.truck_reference || '—'}</TableCell>
                          <TableCell className="text-sm">{o.license_plate || '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{o.pickup_time || '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.pallet_count || 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.total_colli || 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.total_weight ? `${Number(o.total_weight).toFixed(2)} kg` : '0 kg'}</TableCell>
                          <TableCell><StatusBadge status={o.status || 'Pending'} /></TableCell>
                          <TableCell className="text-center">
                            {o.cmr_uploaded ? (
                              <Check className="h-4 w-4 text-[hsl(var(--status-delivered))] mx-auto" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Scan pallets" onClick={() => setActiveOutbound(o.id)}>
                                <ScanBarcode className="h-3.5 w-3.5" />
                              </Button>
                              {o.status === 'departed' || o.status === 'Departed' || o.status === 'picked_up' || o.status === 'Picked Up' ? (
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Undo Departed" onClick={() => undoPickup(o.id)}>
                                  <Undo2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Mark as Picked Up" onClick={() => markPickup(o.id)}>
                                  <Truck className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Create CMR" onClick={() => { setCmrOutbound(o); setCmrAddressId(''); setCmrSealNumber(''); }}>
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Download CMR" onClick={() => {
                                if (!o.cmr_uploaded) {
                                  toast({ title: 'No CMR uploaded', description: 'Upload a signed CMR first before downloading', variant: 'destructive' });
                                  return;
                                }
                                // TODO: download from storage when cmr_file_path is available
                                toast({ title: 'Download CMR', description: 'CMR download — feature coming soon' });
                              }}>
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Print CMR" onClick={() => { setCmrOutbound(o); setCmrAddressId(''); setCmrSealNumber(''); }}>
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Upload CMR" onClick={() => toast({ title: 'Coming soon', description: 'Upload signed CMR PDF — feature in development' })}>
                                <Upload className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New Outbound Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Outbound</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Hub</Label>
              <Select value={hub} onValueChange={setHub}>
                <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
                <SelectContent>
                  {hubs.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Truck Reference</Label>
              <Input value={truckRef} onChange={e => setTruckRef(e.target.value)} placeholder="e.g. TR-2026-001" />
            </div>
            <div className="space-y-2">
              <Label>License Plate</Label>
              <Input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="e.g. AB-123-CD" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pickup Date</Label>
                <Input type="date" value={pickupDate} onChange={e => setPickupDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Pickup Time</Label>
                <Input type="time" value={pickupTime} onChange={e => setPickupTime(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createOutbound.mutate()} disabled={!hub || !pickupDate || createOutbound.isPending}>
              Create Outbound
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CMR Dialog (accessible from list view too) */}
      <Dialog open={!!cmrOutbound} onOpenChange={v => { if (!v) setCmrOutbound(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create CMR — {cmrHubData?.name || cmrOutbound?.outbound_number || cmrOutbound?.hub_code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Hub Address *</Label>
              <Select value={cmrAddressId} onValueChange={setCmrAddressId}>
                <SelectTrigger><SelectValue placeholder="Select delivery address" /></SelectTrigger>
                <SelectContent>
                  {hubAddresses.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.hub_name || a.name} — {a.street} {a.house_number}, {a.city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hubAddresses.length === 0 && (
                <p className="text-xs text-muted-foreground">No addresses configured for this hub. Add them in Hub Management.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Seal Number *</Label>
              <Input value={cmrSealNumber} onChange={e => setCmrSealNumber(e.target.value)} placeholder="Seal number" />
            </div>
            <div className="space-y-2">
              <Label>Loading Reference</Label>
              <Input value={cmrOutbound?.truck_reference || ''} disabled className="bg-muted" />
            </div>
            {cmrPallets.length > 0 && (
              <div className="text-sm text-muted-foreground">
                {cmrPallets.length} pallet(s), {new Set(cmrPallets.map((p: any) => (p.shipments as any)?.customers?.short_name)).size} sub-client(s)
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setCmrOutbound(null)}>Cancel</Button>
            <Button variant="outline" onClick={handleDownloadCmr} disabled={!cmrAddressId || !cmrSealNumber || cmrGenerating}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
            <Button onClick={handlePrintCmr} disabled={!cmrAddressId || !cmrSealNumber || cmrGenerating}>
              <Printer className="h-4 w-4 mr-1" /> Print CMR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
