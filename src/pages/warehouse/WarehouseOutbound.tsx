import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useHubs } from '@/hooks/use-hubs';
import { useToast } from '@/hooks/use-toast';
import { Plus, ScanBarcode, Truck, FileText, Download, Printer } from 'lucide-react';
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

  const [showCreate, setShowCreate] = useState(false);
  const [hub, setHub] = useState('');
  const [truckRef, setTruckRef] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [activeOutbound, setActiveOutbound] = useState<string | null>(null);
  const [palletBarcode, setPalletBarcode] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [pickupTime, setPickupTime] = useState('');

  // CMR state
  const [cmrOutbound, setCmrOutbound] = useState<any>(null);
  const [cmrAddressId, setCmrAddressId] = useState('');
  const [cmrSealNumber, setCmrSealNumber] = useState('');
  const [cmrGenerating, setCmrGenerating] = useState(false);

  const { data: outbounds = [] } = useQuery({
    queryKey: ['warehouse-outbounds', warehouseId],
    queryFn: async () => {
      const { data } = await supabase
        .from('outbounds')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!warehouseId,
  });

  const { data: pallets = [] } = useQuery({
    queryKey: ['outbound-pallets', activeOutbound],
    queryFn: async () => {
      if (!activeOutbound) return [];
      const { data } = await supabase
        .from('pallets')
        .select('*, shipments(mawb, customs_cleared, customers(short_name))')
        .eq('outbound_id', activeOutbound);
      return data ?? [];
    },
    enabled: !!activeOutbound,
  });

  // Hub addresses for CMR modal
  const { data: hubAddresses = [] } = useQuery({
    queryKey: ['hub-addresses-for-cmr', cmrOutbound?.hub_code],
    queryFn: async () => {
      if (!cmrOutbound?.hub_code) return [];
      // Find hub id by code
      const { data: hubData } = await supabase.from('hubs').select('id').eq('code', cmrOutbound.hub_code).maybeSingle();
      if (!hubData) return [];
      const { data } = await supabase.from('hub_addresses').select('*').eq('hub_id', hubData.id).order('name');
      return data ?? [];
    },
    enabled: !!cmrOutbound?.hub_code,
  });

  // Warehouse data for CMR
  const { data: warehouseData } = useQuery({
    queryKey: ['warehouse-cmr-data', warehouseId],
    queryFn: async () => {
      if (!warehouseId) return null;
      const { data } = await supabase.from('warehouses').select('*').eq('id', warehouseId).maybeSingle();
      return data;
    },
    enabled: !!warehouseId,
  });

  // CMR pallets for the selected outbound
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

  const createOutbound = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('outbounds').insert({
        hub_code: hub,
        truck_reference: truckRef,
        license_plate: licensePlate || null,
        pickup_date: pickupDate,
        pickup_time: pickupTime || null,
        status: 'preparing',
      }).select().single();
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
        .select('id, shipment_id, shipments(customs_cleared)')
        .eq('pallet_number', code)
        .maybeSingle();
      if (findErr || !pallet) throw new Error('Pallet not found');

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

      const { error } = await supabase
        .from('pallets')
        .update({ outbound_id: activeOutbound })
        .eq('id', pallet.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound-pallets', activeOutbound] });
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
        .update({ status: 'picked_up' })
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
      toast({ title: 'Outbound confirmed as picked up' });
      setActiveOutbound(null);
    },
  });

  const handlePalletScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!palletBarcode.trim() || !activeOutbound) return;
    addPallet.mutate(palletBarcode.trim());
  };

  // Build CMR data grouped by sub-client
  const buildCmrDataPerSubClient = (): Map<string, CmrData> => {
    const selectedAddress = hubAddresses.find((a: any) => a.id === cmrAddressId);
    if (!selectedAddress || !warehouseData) return new Map();

    // Group pallets by sub-client
    const subClientGroups = new Map<string, typeof cmrPallets>();
    for (const p of cmrPallets) {
      const subClient = (p.shipments as any)?.customers?.short_name || 'Unknown';
      if (!subClientGroups.has(subClient)) subClientGroups.set(subClient, []);
      subClientGroups.get(subClient)!.push(p);
    }

    const result = new Map<string, CmrData>();
    for (const [subClient, scPallets] of subClientGroups) {
      // Group by MAWB within this sub-client
      const mawbMap = new Map<string, { colli: number; weight: number }>();
      for (const p of scPallets) {
        const mawb = (p.shipments as any)?.mawb || 'Unknown';
        const existing = mawbMap.get(mawb) || { colli: 0, weight: 0 };
        existing.colli += p.colli_count || 0;
        existing.weight += parseFloat(p.weight_kg) || 0;
        mawbMap.set(mawb, existing);
      }

      const lines = Array.from(mawbMap.entries()).map(([mawb, data]) => ({
        mawb,
        colli: data.colli,
        weightKg: Math.round(data.weight * 100) / 100,
      }));

      result.set(subClient, {
        warehouseName: warehouseData.cmr_name || warehouseData.name || '',
        warehouseStreet: warehouseData.cmr_street || '',
        warehousePostalCity: warehouseData.cmr_postal_city || '',
        warehouseCountry: warehouseData.cmr_country || '',
        warehouseCity: warehouseData.cmr_city || '',
        hubName: selectedAddress.name,
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
    return result;
  };

  const handleDownloadCmr = async () => {
    setCmrGenerating(true);
    try {
      const cmrMap = buildCmrDataPerSubClient();
      if (cmrMap.size === 0) {
        toast({ title: 'No data', description: 'No pallets found for CMR generation', variant: 'destructive' });
        return;
      }

      if (cmrMap.size === 1) {
        const [subClient, data] = cmrMap.entries().next().value!;
        const wb = generateCmrWorkbook(data);
        downloadCmrWorkbook(wb, `CMR_${subClient}_${cmrOutbound?.outbound_number || ''}.xlsx`);
      } else {
        // Multiple sub-clients → zip
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
      const cmrMap = buildCmrDataPerSubClient();
      if (cmrMap.size === 0) {
        toast({ title: 'No data', description: 'No pallets found', variant: 'destructive' });
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

  // We need XLSX import for multi-file zip
  const XLSX = require('xlsx');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Outbound</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />New Outbound
        </Button>
      </div>

      {activeOutbound && (
        <Card className="border-accent">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Truck className="h-5 w-5 text-accent" />
              Active Outbound
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                  <TableHead>Subklant</TableHead>
                  <TableHead>Hub</TableHead>
                  <TableHead className="text-right">Colli</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pallets.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Scan pallets to add</TableCell></TableRow>
                ) : pallets.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-medium">{p.pallet_number}</TableCell>
                    <TableCell>{(p.shipments as any)?.customers?.short_name ?? '—'}</TableCell>
                    <TableCell>{p.hub_code}</TableCell>
                    <TableCell className="text-right">{p.colli_count}</TableCell>
                    <TableCell className="text-right">{p.weight_kg} kg</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-end gap-2">
              <Button onClick={() => confirmOutbound.mutate()} disabled={pallets.length === 0 || confirmOutbound.isPending}>
                Confirm Outbound — Mark as Picked Up
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Recent Outbounds</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nr</TableHead>
                <TableHead>Hub</TableHead>
                <TableHead>Truck Ref</TableHead>
                <TableHead>License Plate</TableHead>
                <TableHead>Pickup Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outbounds.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No outbounds yet</TableCell></TableRow>
              ) : outbounds.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono">{o.outbound_number ?? '—'}</TableCell>
                  <TableCell className="font-medium">{o.hub_code}</TableCell>
                  <TableCell>{o.truck_reference ?? '—'}</TableCell>
                  <TableCell>{o.license_plate ?? '—'}</TableCell>
                  <TableCell>{o.pickup_date ?? '—'}</TableCell>
                  <TableCell>{o.pickup_time ?? '—'}</TableCell>
                  <TableCell className="capitalize">{o.status?.replace('_', ' ')}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {o.status === 'preparing' && (
                        <Button size="sm" variant="ghost" onClick={() => setActiveOutbound(o.id)}>
                          Continue
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => { setCmrOutbound(o); setCmrAddressId(''); setCmrSealNumber(''); }}>
                        <FileText className="h-3.5 w-3.5 mr-1" />CMR
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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

      {/* CMR Dialog */}
      <Dialog open={!!cmrOutbound} onOpenChange={v => { if (!v) setCmrOutbound(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create CMR — {cmrOutbound?.outbound_number || cmrOutbound?.hub_code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Hub Address</Label>
              <Select value={cmrAddressId} onValueChange={setCmrAddressId}>
                <SelectTrigger><SelectValue placeholder="Select delivery address" /></SelectTrigger>
                <SelectContent>
                  {hubAddresses.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} — {a.street} {a.house_number}, {a.city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hubAddresses.length === 0 && (
                <p className="text-xs text-muted-foreground">No addresses configured for this hub. Add them in Hub Management.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Seal Number</Label>
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
            <Button variant="outline" onClick={handleDownloadCmr} disabled={!cmrAddressId || cmrGenerating}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
            <Button onClick={handlePrintCmr} disabled={!cmrAddressId || cmrGenerating}>
              <Printer className="h-4 w-4 mr-1" /> Print (4x)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
