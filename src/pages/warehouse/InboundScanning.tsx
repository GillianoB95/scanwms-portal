import { useState, useRef, useEffect, useCallback } from 'react';
import Barcode from 'react-barcode';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHubs } from '@/hooks/use-hubs';
import { useToast } from '@/hooks/use-toast';
import { ScanBarcode, CheckCircle2, Search, Printer, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { printPalletLabel, type PalletLabelData } from '@/lib/printnode';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';

function normalizeBoxBarcode(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, '')
    .trim();
}

// Parse a cleaned manifest XLSX blob and return maps: BoxBagbarcode -> hub, BoxBagbarcode -> weight, BoxBagbarcode -> parcel_barcodes
// Parse a cleaned manifest XLSX blob and return maps
async function parseManifestData(blob: Blob): Promise<{
  hubMap: Map<string, string>;
  weightMap: Map<string, number>;
  boxToParcelMap: Map<string, string[]>;
  parcelSet: Set<string>;
  parcelToBoxMap: Map<string, string>;
}> {
  const hubMap = new Map<string, string>();
  const weightMap = new Map<string, number>();
  const boxToParcelMap = new Map<string, string[]>();
  const parcelSet = new Set<string>();
  const parcelToBoxMap = new Map<string, string>();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) return { hubMap, weightMap, boxToParcelMap, parcelSet, parcelToBoxMap };

    const header = rows[0].map((h: any) => String(h).trim().toLowerCase());
    let boxBagCol = 2;
    let waybillCol = 3;
    let weightCol = -1;
    let parcelCol = -1;

    const bbIdx = header.findIndex(h => h.includes('boxbagbarcode') || h.includes('boxbag'));
    if (bbIdx >= 0) boxBagCol = bbIdx;
    const wIdx = header.findIndex(h => h === 'waybill' || h.includes('waybill'));
    if (wIdx >= 0) waybillCol = wIdx;
    const twIdx = header.findIndex(h =>
      h === 'total weight' || h === 'totalweight' || h === 'total_weight' ||
      h === 'totweight' || h === 'totaalgewicht' || h === 'totalkg' ||
      h === 'total kg' || h === 'gewicht' || h === 'weight'
    );
    if (twIdx >= 0) weightCol = twIdx;
    if (weightCol < 0) weightCol = 13;
    const pIdx = header.findIndex(h => h.includes('parcelbarcode') || h.includes('parcel') || h === 'barcode');
    if (pIdx >= 0) parcelCol = pIdx;

    let lastBoxBag = '';
    let lastHub = '';

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rawBoxBag = normalizeBoxBarcode(row[boxBagCol]);
      const rawHub = String(row[waybillCol] || '').trim();
      const boxBag = rawBoxBag || lastBoxBag;
      const hub = rawHub || lastHub;
      const weight = parseFloat(String(row[weightCol] || '').replace(',', '.')) || 0;

      if (rawBoxBag) lastBoxBag = rawBoxBag;
      if (rawHub) lastHub = rawHub;

      if (boxBag && hub) hubMap.set(boxBag, hub);
      if (boxBag && weight > 0) {
        weightMap.set(boxBag, (weightMap.get(boxBag) || 0) + weight);
      }

      // Map box to parcel barcodes and build parcel lookup
      if (parcelCol >= 0 && boxBag) {
        const parcelBarcode = String(row[parcelCol] || '').trim();
        if (parcelBarcode) {
          const existing = boxToParcelMap.get(boxBag) || [];
          existing.push(parcelBarcode);
          boxToParcelMap.set(boxBag, existing);
          parcelSet.add(parcelBarcode.toUpperCase());
          parcelToBoxMap.set(parcelBarcode.toUpperCase(), boxBag);
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse manifest:', err);
  }
  return { hubMap, weightMap, boxToParcelMap, parcelSet, parcelToBoxMap };
}

export default function InboundScanning() {
  const { data: auth } = useWarehouseAuth();
  const { customer } = useAuth();
  const [mawbInput, setMawbInput] = useState('');
  const [mawbResults, setMawbResults] = useState<any[]>([]);
  const [shipment, setShipment] = useState<any>(null);
  const [shipmentError, setShipmentError] = useState('');
  const [barcode, setBarcode] = useState('');
  const [searching, setSearching] = useState(false);
  const [scanningBlocked, setScanningBlocked] = useState<string | null>(null);
  const [currentHub, setCurrentHub] = useState<string | null>(null);
  const [hubMap, setHubMap] = useState<Map<string, string>>(new Map());
  const [weightMap, setWeightMap] = useState<Map<string, number>>(new Map());
  const [notPreAlertedBarcode, setNotPreAlertedBarcode] = useState<string | null>(null);
  const [fycoBlockedBarcode, setFycoBlockedBarcode] = useState<string | null>(null);
  const [boxToParcelMap, setBoxToParcelMap] = useState<Map<string, string[]>>(new Map());
  const [parcelSet, setParcelSet] = useState<Set<string>>(new Set());
  const [parcelToBoxMap, setParcelToBoxMap] = useState<Map<string, string>>(new Map());
  const barcodeRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  // Print label state
  const [previewData, setPreviewData] = useState<PalletLabelData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [pendingPalletNumber, setPendingPalletNumber] = useState('');
  const { data: hubs = [] } = useHubs();

  // Warehouse details for PrintNode — use customer.warehouse_id or fall back to shipment.warehouse_id (which is a code like 'DSC')
  const warehouseIdFromCustomer = customer?.warehouse_id || null;
  const warehouseCodeFromShipment = shipment?.warehouse_id || null;
  const { data: warehouse } = useQuery({
    queryKey: ['warehouse-detail', warehouseIdFromCustomer, warehouseCodeFromShipment],
    queryFn: async () => {
      if (warehouseIdFromCustomer) {
        const { data } = await supabase
          .from('warehouses')
          .select('id, code, name, printnode_id, printnode_key, printnode_name')
          .eq('id', warehouseIdFromCustomer)
          .single();
        if (data) return data;
      }
      if (warehouseCodeFromShipment) {
        const { data } = await supabase
          .from('warehouses')
          .select('id, code, name, printnode_id, printnode_key, printnode_name')
          .eq('code', warehouseCodeFromShipment)
          .single();
        if (data) return data;
      }
      return null;
    },
    enabled: !!warehouseIdFromCustomer || !!warehouseCodeFromShipment,
  });

  const fetchManifestDataForShipment = useCallback(async (shipmentId: string) => {
    const empty = { hubMap: new Map<string, string>(), weightMap: new Map<string, number>(), boxToParcelMap: new Map<string, string[]>(), parcelSet: new Set<string>(), parcelToBoxMap: new Map<string, string>() };
    try {
      const { data: files } = await supabase
        .from('shipment_files')
        .select('storage_path')
        .eq('shipment_id', shipmentId)
        .eq('file_type', 'manifest_cleaned')
        .order('uploaded_at', { ascending: false })
        .limit(1);

      if (!files || files.length === 0) return empty;

      const { data: blob, error } = await supabase.storage
        .from('shipment-files')
        .download(files[0].storage_path);

      if (error || !blob) {
        console.warn('Could not download manifest:', error?.message);
        return empty;
      }

      return await parseManifestData(blob);
    } catch (err) {
      console.warn('Failed to load manifest hubs:', err);
      return empty;
    }
  }, []);

  const loadManifestHubs = useCallback(async (shipmentId: string) => {
    const { hubMap: hMap, weightMap: wMap, boxToParcelMap: bpMap, parcelSet: pSet, parcelToBoxMap: ptbMap } = await fetchManifestDataForShipment(shipmentId);
    setHubMap(hMap);
    setWeightMap(wMap);
    setBoxToParcelMap(bpMap);
    setParcelSet(pSet);
    setParcelToBoxMap(ptbMap);
  }, [fetchManifestDataForShipment]);

  const handleMawbSearch = async () => {
    const q = mawbInput.trim();
    if (!q) return;
    setSearching(true);
    setShipmentError('');
    setShipment(null);
    setMawbResults([]);
    setScanningBlocked(null);
    setCurrentHub(null);
    setHubMap(new Map());
    setWeightMap(new Map());
    try {
      // Use ilike for partial/suffix matching
      const { data, error } = await supabase
        .from('shipments')
        .select('id, mawb, warehouse_id, colli_expected, status, created_at, customers(name, short_name)')
        .ilike('mawb', `%${q}`)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      if (!data || data.length === 0) {
        setShipmentError('No shipments found matching this MAWB');
        return;
      }
      if (data.length === 1) {
        selectShipment(data[0]);
      } else {
        setMawbResults(data);
      }
    } catch (err: any) {
      setShipmentError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const selectShipment = async (s: any) => {
    setMawbResults([]);
    setMawbInput(s.mawb);

    const allowedStatuses = ['In Stock', 'In Transit'];
    if (!allowedStatuses.includes(s.status)) {
      setShipment(s);
      setScanningBlocked('This shipment must be marked as Unloaded by staff before scanning can begin.');
      return;
    }

    const { data: blocks } = await supabase
      .from('shipment_blocks')
      .select('reason')
      .eq('shipment_id', s.id)
      .eq('block_type', 'inbound')
      .is('removed_at', null);

    if (blocks && blocks.length > 0) {
      setShipment(s);
      setScanningBlocked(`Inbound blocked: ${blocks[0].reason || 'No reason provided'}`);
      return;
    }

    setShipment(s);
    loadManifestHubs(s.id);
  };

  const { data: scannedBoxes = [] } = useQuery({
    queryKey: ['scanned-boxes', shipment?.id],
    queryFn: async () => {
      if (!shipment?.id) return [];
      const { data } = await supabase
        .from('outerboxes')
        .select('id, barcode, scanned_in_at, hub, pallet_id, status, weight')
        .eq('shipment_id', shipment.id)
        .order('scanned_in_at', { ascending: false });

      // Fetch pallet numbers for boxes with pallet_id
      if (data && data.length > 0) {
        const palletIds = [...new Set(data.filter(b => b.pallet_id).map(b => b.pallet_id))];
        if (palletIds.length > 0) {
          const { data: pallets } = await supabase
            .from('pallets')
            .select('id, pallet_number')
            .in('id', palletIds);
          const palletMap = new Map((pallets || []).map(p => [p.id, p.pallet_number]));
          return data.map(box => ({ ...box, pallet_number: palletMap.get(box.pallet_id) || null }));
        }
      }
      return (data ?? []).map(box => ({ ...box, pallet_number: null }));
    },
    enabled: !!shipment?.id,
  });

  // Pallets for this shipment
  const { data: existingPallets = [] } = useQuery({
    queryKey: ['shipment-pallets', shipment?.id],
    queryFn: async () => {
      if (!shipment?.id) return [];
      const { data } = await supabase
        .from('pallets')
        .select('*, outbounds(status, outbound_number, outbound_id)')
        .eq('shipment_id', shipment.id)
        .order('created_at', { ascending: false });
      if (!data || data.length === 0) return [];

      // Fetch all outerboxes for these pallets to derive real status
      const palletIds = data.map((p: any) => p.id);
      const { data: allBoxes } = await supabase
        .from('outerboxes')
        .select('pallet_id, status')
        .in('pallet_id', palletIds);

      const boxesByPallet = new Map<string, any[]>();
      (allBoxes ?? []).forEach((b: any) => {
        const arr = boxesByPallet.get(b.pallet_id) || [];
        arr.push(b);
        boxesByPallet.set(b.pallet_id, arr);
      });

      return data.map((p: any) => {
        const outboundStatus = p.outbounds?.status;
        const boxes = boxesByPallet.get(p.id) || [];
        const activeBoxes = boxes.filter((b: any) => b.status !== 'deleted');
        const deletedBoxes = boxes.filter((b: any) => b.status === 'deleted');

        // Derive pallet status from boxes
        let derivedStatus = p.status || 'Palletized';
        if (boxes.length > 0 && activeBoxes.length === 0) derivedStatus = 'Deleted';
        else if (deletedBoxes.length > 0 && activeBoxes.length > 0) derivedStatus = 'Partly deleted';

        let displayStatus = derivedStatus;
        if (outboundStatus === 'departed') displayStatus = 'Departed';
        else if (outboundStatus === 'preparing' || outboundStatus === 'prepared') displayStatus = 'Prepared';

        const outboundLabel = p.outbound_id && p.outbounds
          ? `Outbound #${p.outbounds.outbound_number}`
          : null;

        // Auto-fix DB if status is stale
        if (derivedStatus !== p.status && (derivedStatus === 'Deleted' || derivedStatus === 'Partly deleted')) {
          supabase.from('pallets').update({ status: derivedStatus, pieces: activeBoxes.length }).eq('id', p.id).then();
        }

        return { ...p, status: derivedStatus, displayStatus, outboundLabel };
      });
    },
    enabled: !!shipment?.id,
  });

  // Pre-check mutation: validates barcode, returns whether it's pre-alerted
  const preCheckMutation = useMutation({
    mutationFn: async (code: string) => {
      const { data: blocks } = await supabase
        .from('shipment_blocks')
        .select('reason')
        .eq('shipment_id', shipment.id)
        .eq('block_type', 'inbound')
        .is('removed_at', null);
      if (blocks && blocks.length > 0) {
        throw new Error(`Inbound blocked: ${blocks[0].reason || 'No reason provided'}`);
      }

      const normalizedCode = normalizeBoxBarcode(code);
      const freshManifestData = await fetchManifestDataForShipment(shipment.id);
      const effectiveHubMap = freshManifestData.hubMap.size > 0 ? freshManifestData.hubMap : hubMap;
      const effectiveBoxToParcelMap = freshManifestData.boxToParcelMap.size > 0 ? freshManifestData.boxToParcelMap : boxToParcelMap;
      const effectiveParcelSet = freshManifestData.parcelSet.size > 0 ? freshManifestData.parcelSet : parcelSet;

      const isBoxPreAlerted = effectiveHubMap.has(normalizedCode);
      const isParcelInManifest = effectiveParcelSet.has(code.toUpperCase());

      // If this is a parcel barcode from the manifest → it's a fyco individual parcel scan
      if (!isBoxPreAlerted && isParcelInManifest) {
        // Set scan_time on the matching inspection record
        const { data: inspection } = await supabase
          .from('inspections')
          .select('id, scan_time')
          .eq('shipment_id', shipment.id)
          .eq('parcel_barcode', code)
          .maybeSingle();
        if (inspection && !inspection.scan_time) {
          await supabase
            .from('inspections')
            .update({ scan_time: new Date().toISOString() })
            .eq('id', inspection.id);
        }
        return { isPreAlerted: true, fycoBlocked: false, isParcelScan: true };
      }

      // Check duplicate for outerbox scans
      if (isBoxPreAlerted) {
        const { data: existing } = await supabase
          .from('outerboxes')
          .select('id, status')
          .eq('shipment_id', shipment.id)
          .eq('barcode', code)
          .neq('status', 'deleted');
        if (existing && existing.length > 0) {
          throw new Error(`Barcode "${code}" is already scanned for this shipment.`);
        }
      }

      // Fyco detection: check if any parcel under this outerbox is an inspection parcel without scan_time
      if (isBoxPreAlerted) {
        const parcelsForBox = effectiveBoxToParcelMap.get(normalizedCode) || [];
        if (parcelsForBox.length > 0) {
          const { data: fycoInspections } = await supabase
            .from('inspections')
            .select('id, scan_time, parcel_barcode')
            .eq('shipment_id', shipment.id)
            .in('parcel_barcode', parcelsForBox)
            .is('scan_time', null);
          if (fycoInspections && fycoInspections.length > 0) {
            return { isPreAlerted: true, fycoBlocked: true, isParcelScan: false };
          }
        }
      }

      return { isPreAlerted: isBoxPreAlerted, fycoBlocked: false, isParcelScan: false };
    },
    onSuccess: (result) => {
      if (result.isParcelScan) {
        // Individual parcel scan succeeded — scan_time set
        toast({ title: 'Fyco parcel scanned', description: `${barcode.trim()} — scan time recorded` });
        setBarcode('');
        barcodeRef.current?.focus();
        qc.invalidateQueries({ queryKey: ['fyco-management'] });
      } else if (!result.isPreAlerted) {
        setNotPreAlertedBarcode(barcode.trim());
      } else if (result.fycoBlocked) {
        setFycoBlockedBarcode(barcode.trim());
      } else {
        scanMutation.mutate(barcode.trim());
      }
    },
    onError: (err: any) => {
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (code: string) => {
      const normalizedCode = normalizeBoxBarcode(code);
      const freshManifestData = await fetchManifestDataForShipment(shipment.id);
      const effectiveHubMap = freshManifestData.hubMap.size > 0 ? freshManifestData.hubMap : hubMap;
      const effectiveWeightMap = freshManifestData.weightMap.size > 0 ? freshManifestData.weightMap : weightMap;

      const boxHub = effectiveHubMap.get(normalizedCode) || null;

      if (boxHub && currentHub && boxHub !== currentHub) {
        throw new Error(`Cannot mix hubs on one pallet. Hub "${currentHub}" is active. Print the pallet label first to close this pallet, then you can scan "${boxHub}" boxes.`);
      }

      const boxWeight = effectiveWeightMap.get(normalizedCode) || null;

      const insertData: any = {
        shipment_id: shipment.id,
        barcode: code,
        status: 'scanned_in',
        scanned_in_at: new Date().toISOString(),
      };
      if (boxHub) insertData.hub = boxHub;
      if (boxWeight) insertData.weight = Number(boxWeight.toFixed(2));

      const { error } = await supabase.from('outerboxes').insert(insertData);
      if (error) throw error;

      return { boxHub };
    },
    onSuccess: (result) => {
      if (result.boxHub && !currentHub) {
        setCurrentHub(result.boxHub);
      }
      qc.invalidateQueries({ queryKey: ['scanned-boxes', shipment?.id] });
      toast({ title: 'Box scanned', description: barcode });
      setBarcode('');
      barcodeRef.current?.focus();
    },
    onError: (err: any) => {
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (boxId: string) => {
      // Get the box to find its pallet_id
      const { data: box } = await supabase
        .from('outerboxes')
        .select('id, pallet_id')
        .eq('id', boxId)
        .single();

      const { error } = await supabase
        .from('outerboxes')
        .update({ status: 'deleted' })
        .eq('id', boxId);
      if (error) throw error;

      // Update pallet status if box belongs to a pallet
      if (box?.pallet_id) {
        const { data: palletBoxes } = await supabase
          .from('outerboxes')
          .select('id, status')
          .eq('pallet_id', box.pallet_id);

        if (palletBoxes && palletBoxes.length > 0) {
          const activeBoxes = palletBoxes.filter(b => b.id === boxId ? false : b.status !== 'deleted');
          const allDeleted = activeBoxes.length === 0;
          const someDeleted = !allDeleted && palletBoxes.some(b => b.status === 'deleted' || b.id === boxId);

          let newStatus = 'Palletized';
          if (allDeleted) newStatus = 'Deleted';
          else if (someDeleted) newStatus = 'Partly deleted';

          // Also update pieces count (only active boxes)
          await supabase
            .from('pallets')
            .update({ status: newStatus, pieces: activeBoxes.length })
            .eq('id', box.pallet_id);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scanned-boxes', shipment?.id] });
      qc.invalidateQueries({ queryKey: ['shipment-pallets', shipment?.id] });
      toast({ title: 'Scan removed' });
    },
    onError: (err: any) => {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    },
  });

  const unloadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('shipments')
        .update({ status: 'In Stock', unloaded_at: new Date().toISOString() })
        .eq('id', shipment.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Shipment marked as unloaded and In Stock' });
      setShipment(null);
      setMawbInput('');
      setCurrentHub(null);
    },
  });

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim() || !shipment) return;
    preCheckMutation.mutate(barcode.trim());
  };

  const handleMawbKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleMawbSearch();
    }
  };

  useEffect(() => {
    if (shipment && !scanningBlocked) barcodeRef.current?.focus();
  }, [shipment, scanningBlocked]);

  const totalExpected = shipment?.colli_expected ?? 0;
  const totalScanned = scannedBoxes.filter((b: any) => b.status !== 'deleted').length;
  const subklant = shipment?.customers?.short_name || shipment?.customers?.name || '—';

  // Print Label logic — hub is auto-set from current session hub
  const handleGenerateLabel = async () => {
    const unassigned = scannedBoxes.filter((b: any) => !b.pallet_id && b.status !== 'deleted');
    if (unassigned.length === 0) {
      toast({ title: 'No unassigned boxes to palletize', variant: 'destructive' });
      return;
    }
    // Derive hub from currentHub state or from scanned boxes' hub field
    const effectiveHub = currentHub || unassigned.find((b: any) => b.hub)?.hub || null;
    if (!effectiveHub) {
      toast({ title: 'No hub detected from scanned barcodes. Scan at least one box first.', variant: 'destructive' });
      return;
    }
    // Prefer the configured warehouse row, but fall back to the shipment's warehouse code
    const effectiveWarehouseCode = warehouse?.code || shipment?.warehouse_id || null;
    if (!warehouse && !effectiveWarehouseCode) {
      toast({ title: 'Warehouse code not configured', variant: 'destructive' });
      return;
    }
    try {
      const colli = unassigned.length;
      const weightKg = unassigned.reduce((sum: number, b: any) => sum + (b.weight || weightMap.get(b.barcode) || 0), 0);

      const { data: palletNumber, error: rpcError } = await supabase.rpc('generate_pallet_number', {
        p_warehouse_code: effectiveWarehouseCode,
      });
      if (rpcError) throw rpcError;
      if (!palletNumber) throw new Error('No pallet number returned');

      const { data: palletRow, error: insertError } = await supabase.from('pallets').insert({
        shipment_id: shipment.id,
        pallet_number: palletNumber,
        warehouse_code: effectiveWarehouseCode,
        pieces: colli,
        weight: weightKg,
        status: 'Palletized',
        hub_code: effectiveHub,
      }).select('id').single();
      if (insertError) throw insertError;

      const unassignedIds = unassigned.map((b: any) => b.id);
      if (unassignedIds.length > 0 && palletRow) {
        await supabase
          .from('outerboxes')
          .update({ pallet_id: palletRow.id })
          .in('id', unassignedIds);
      }

      const labelData: PalletLabelData = {
        palletId: palletNumber,
        subklant,
        mawb: shipment.mawb || '',
        colli,
        weight: weightKg,
        hub: effectiveHub,
        printedAt: new Date(),
      };

      setPendingPalletNumber(palletNumber);
      setPreviewData(labelData);
      setPreviewOpen(true);

      // Reset hub session so next scans start a new pallet
      setCurrentHub(null);

      qc.invalidateQueries({ queryKey: ['shipment-pallets', shipment.id] });
      qc.invalidateQueries({ queryKey: ['scanned-boxes', shipment.id] });
      toast({ title: 'Pallet created', description: palletNumber });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handlePrint = async () => {
    if (!previewData || !warehouse?.printnode_key || !warehouse?.printnode_id) {
      toast({ title: 'PrintNode not configured for this warehouse', variant: 'destructive' });
      return;
    }
    setPrinting(true);
    try {
      const result = await printPalletLabel(previewData, warehouse.printnode_key, warehouse.printnode_id);
      if (result.success) {
        toast({ title: 'Sent to printer', description: `${pendingPalletNumber} (Job #${result.jobId})` });
        setPreviewOpen(false);
      } else {
        toast({ title: 'Print failed', description: result.error, variant: 'destructive' });
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Inbound Scanning</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Find Shipment by MAWB</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 max-w-md">
            <Input
              value={mawbInput}
              onChange={e => setMawbInput(e.target.value)}
              onKeyDown={handleMawbKeyDown}
              placeholder="Enter full or last digits of MAWB (e.g. 2772)"
              className="font-mono"
            />
            <Button onClick={handleMawbSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {shipmentError && (
            <p className="text-sm text-destructive mt-2">{shipmentError}</p>
          )}
          {mawbResults.length > 0 && !shipment && (
            <div className="mt-3 border rounded-lg divide-y max-h-64 overflow-y-auto">
              {mawbResults.map((s: any) => (
                <button
                  key={s.id}
                  className="w-full text-left px-4 py-3 hover:bg-muted transition-colors flex items-center justify-between"
                  onClick={() => selectShipment(s)}
                >
                  <div>
                    <span className="font-mono font-medium">{s.mawb}</span>
                    <span className="text-sm text-muted-foreground ml-3">{(s.customers as any)?.name ?? ''}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{s.status}</span>
                </button>
              ))}
            </div>
          )}
          {shipment && (
            <div className="mt-4 p-3 rounded-lg bg-muted text-sm space-y-1">
              <p><span className="font-medium">MAWB:</span> <span className="font-mono">{shipment.mawb}</span></p>
              <p><span className="font-medium">Customer:</span> {shipment.customers?.name ?? '—'} ({subklant})</p>
              <p><span className="font-medium">Colli Expected:</span> {shipment.colli_expected ?? '—'}</p>
              <p><span className="font-medium">Status:</span> {shipment.status}</p>
              {currentHub && (
                <p><span className="font-medium">Active Hub:</span> <span className="font-mono font-bold">{currentHub}</span></p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {shipment && (
        <>
          {scanningBlocked && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Scanning Disabled</AlertTitle>
              <AlertDescription>{scanningBlocked}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-6">
                <form onSubmit={handleScan} className="space-y-4">
                  <label className="text-sm font-medium">Scan Barcode</label>
                  <div className="flex gap-2">
                    <Input
                      ref={barcodeRef}
                      value={barcode}
                      onChange={e => setBarcode(e.target.value)}
                      placeholder={scanningBlocked ? 'Scanning disabled' : 'Scan or type barcode...'}
                      className="text-lg h-14 font-mono"
                      autoFocus
                      disabled={!!scanningBlocked}
                    />
                    <Button type="submit" size="lg" className="h-14" disabled={scanMutation.isPending || !!scanningBlocked}>
                      <ScanBarcode className="h-5 w-5" />
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 flex flex-col items-center justify-center">
                <p className="text-sm text-muted-foreground mb-1">Scanning Progress</p>
                <p className="text-4xl font-bold">
                  <span className={totalScanned >= totalExpected && totalExpected > 0 ? 'text-[hsl(var(--status-delivered))]' : ''}>{totalScanned}</span>
                  <span className="text-muted-foreground text-2xl"> / {totalExpected}</span>
                </p>
                <div className="w-full bg-muted rounded-full h-3 mt-4">
                  <div
                    className="bg-accent h-3 rounded-full transition-all"
                    style={{ width: `${totalExpected > 0 ? Math.min((totalScanned / totalExpected) * 100, 100) : 0}%` }}
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={() => unloadMutation.mutate()}
                    disabled={unloadMutation.isPending}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Mark as Unloaded
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleGenerateLabel}
                    disabled={!!scanningBlocked}
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Print Label
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Existing pallets for this shipment */}
          {existingPallets.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pallets for this Shipment</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pallet #</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Hub</TableHead>
                      <TableHead>Pieces</TableHead>
                      <TableHead>Weight</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Outbound</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {existingPallets.map((p: any) => {
                      const isDeletedPallet = p.status === 'Deleted';
                      const isPartlyDeleted = p.status === 'Partly deleted';
                      const statusColor = isDeletedPallet ? 'text-destructive' : 
                        isPartlyDeleted ? 'text-orange-500' : 
                        p.displayStatus === 'Departed' ? 'text-blue-500' :
                        p.displayStatus === 'Prepared' ? 'text-yellow-600' : '';
                      return (
                      <TableRow key={p.id} className={isDeletedPallet ? 'opacity-50' : ''}>
                        <TableCell className={`font-mono font-medium ${isDeletedPallet ? 'line-through' : ''}`}>{p.pallet_number}</TableCell>
                        <TableCell className={`text-sm text-muted-foreground ${isDeletedPallet ? 'line-through' : ''}`}>
                          {p.created_at ? new Date(p.created_at).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + new Date(p.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </TableCell>
                        <TableCell className={isDeletedPallet ? 'line-through' : ''}>{p.hub_code || '—'}</TableCell>
                        <TableCell className={isDeletedPallet ? 'line-through' : ''}>{p.pieces ?? p.colli_count ?? '—'}</TableCell>
                        <TableCell className={isDeletedPallet ? 'line-through' : ''}>{(p.weight ?? p.weight_kg) != null ? `${Number(p.weight ?? p.weight_kg).toFixed(2)} kg` : '—'}</TableCell>
                        <TableCell className={statusColor}>{p.displayStatus}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{p.outboundLabel || '—'}</TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scanned Boxes ({totalScanned})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                   <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Hub</TableHead>
                    <TableHead>Scanned At</TableHead>
                    <TableHead>Pallet Nr</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                {scannedBoxes.map((box: any, i: number) => {
                    const isDeleted = box.status === 'deleted';
                    const isNotPreAlerted = box.status === 'not_pre_alerted';
                    return (
                    <TableRow key={box.id} className={cn(
                      isDeleted && 'opacity-40',
                      isNotPreAlerted && 'bg-yellow-500/10'
                    )}>
                      <TableCell className={isDeleted ? 'line-through' : ''}>{i + 1}</TableCell>
                      <TableCell className={`font-mono ${isDeleted ? 'line-through' : ''}`}>
                        {isNotPreAlerted && <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 inline mr-1.5" />}
                        {box.barcode}
                      </TableCell>
                      <TableCell className={`font-mono ${isDeleted ? 'line-through' : ''}`}>{box.hub || '—'}</TableCell>
                      <TableCell className={isDeleted ? 'line-through' : ''}>{new Date(box.scanned_in_at).toLocaleTimeString()}</TableCell>
                      <TableCell className={`font-mono ${isDeleted ? 'line-through' : ''}`}>{box.pallet_number || '—'}</TableCell>
                      <TableCell>
                        {isDeleted ? (
                          <span className="text-xs text-destructive font-medium line-through">Deleted</span>
                        ) : isNotPreAlerted ? (
                          <span className="text-xs text-yellow-600 font-medium">Not pre-alerted</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Scanned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!isDeleted && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate(box.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                  {scannedBoxes.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No boxes scanned yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Print Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Label Preview</DialogTitle></DialogHeader>
          {previewData && (
            <div className="border-2 border-foreground p-4 font-mono mx-auto" style={{ width: '100%', maxWidth: '380px' }}>
              <div className="text-center text-xl font-bold border-2 border-foreground p-2 mb-2">
                {previewData.subklant}
              </div>
              <div className="text-center text-lg font-bold mb-1">
                {previewData.palletId}
              </div>
              <div className="text-center text-xs mb-2">
                {(previewData.printedAt || new Date()).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })}{' '}
                {(previewData.printedAt || new Date()).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="flex justify-center p-2 my-2 border-2 border-foreground">
                <Barcode value={previewData.palletId} format="CODE128" width={1.5} height={50} displayValue={false} margin={0} />
              </div>
              <div className="text-center text-sm font-bold my-1">
                MAWB: {previewData.mawb}
              </div>
              <div className="text-center text-sm font-bold border-2 border-foreground p-2 my-1">
                {previewData.colli} CTN | {previewData.weight.toFixed(2)} KG
              </div>
              <div className="text-center text-xl font-bold mt-2 border-[3px] border-foreground p-2">
                {previewData.hub}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
            <Button onClick={handlePrint} disabled={printing}>
              {printing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}
              Send to Printer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!notPreAlertedBarcode} onOpenChange={(v) => { if (!v) { setNotPreAlertedBarcode(null); setBarcode(''); barcodeRef.current?.focus(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Unknown Barcode
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm py-2">
            Barcode <span className="font-mono font-bold">{notPreAlertedBarcode}</span> was not found in the manifest.
          </p>
          <p className="text-sm font-medium text-destructive">
            Recheck the label and/or report to the supervisor.
          </p>
          <DialogFooter>
            <Button onClick={() => { setNotPreAlertedBarcode(null); setBarcode(''); barcodeRef.current?.focus(); }}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fyco blocked dialog */}
      <Dialog open={!!fycoBlockedBarcode} onOpenChange={(v) => { if (!v) { setFycoBlockedBarcode(null); setBarcode(''); barcodeRef.current?.focus(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              ⚠️ Fyco Parcel Detected
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm py-2">
            Outerbox <span className="font-mono font-bold">{fycoBlockedBarcode}</span> contains a fyco inspection parcel that has not been individually scanned yet.
          </p>
          <p className="text-sm font-medium text-destructive">
            Please scan the individual parcel barcode first.
          </p>
          <DialogFooter>
            <Button onClick={() => { setFycoBlockedBarcode(null); setBarcode(''); barcodeRef.current?.focus(); }}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
