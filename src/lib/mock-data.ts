export type ShipmentStatus = 'Awaiting NOA' | 'Partial NOA' | 'NOA Complete' | 'In Transit' | 'In Stock' | 'Outbound' | 'Needs Action';
export type PalletStatus = 'Palletized' | 'Loaded' | 'Outbound';

export interface Shipment {
  id: string;
  mawb: string;
  subklant: string;
  subklantId: string;
  pieces: number;
  parcels: number;
  chargeableWeight: number;
  warehouse: string;
  status: ShipmentStatus;
  transportType: 'AIR' | 'TRUCK';
  createdAt: string;
  lastStatusUpdate: string;
  colliExpected: number;
  colliNoa: number | null;
  hasValidationErrors?: boolean;
}

export interface StatusHistory {
  status: ShipmentStatus;
  changedBy: string;
  changedAt: string;
  notes?: string;
}

export interface Outerbox {
  id: string;
  barcode: string;
  status: 'expected' | 'scanned_in' | 'in_stock' | 'scanned_out';
  scannedInAt: string | null;
  scannedOutAt: string | null;
  palletId: string | null;
}

export interface NoaEntry {
  id: string;
  noaNumber: number;
  receivedAt: string;
  colli: number;
  weight: number;
  filePath: string | null;
}

export interface OutboundGroup {
  hub: string;
  hubCode: string;
  totalExpected: number;
  totalPickedUp: number;
  stillInStock: number;
  pickups: OutboundPickup[];
}

export interface OutboundPickup {
  date: string;
  truckReference: string;
  totalPieces: number;
  pallets: Pallet[];
}

export interface Pallet {
  id: string;
  palletNumber: string;
  pieces: number;
  weight: number;
  status: PalletStatus;
}

export interface Note {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

export const subklanten = [
  { id: 'sk1', name: 'PostNL Express' },
  { id: 'sk2', name: 'DHL Parcel' },
  { id: 'sk3', name: 'GLS Netherlands' },
  { id: 'sk4', name: 'DPD Benelux' },
];

export const shipments: Shipment[] = [];

export const statusOrder: ShipmentStatus[] = ['Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound'];

export const getStatusClass = (status: string): string => {
  const map: Record<string, string> = {
    'Awaiting NOA': 'status-awaiting-noa',
    'Partial NOA': 'status-partial-noa',
    'NOA Complete': 'status-noa-complete',
    'In Transit': 'status-intransit',
    'In Stock': 'status-instock',
    'Outbound': 'status-outbound',
    'Needs Action': 'status-needs-action',
    'Delivered': 'status-delivered',
    // Pallet statuses
    'Palletized': 'status-instock',
    'Loaded': 'status-intransit',
    // Clearance statuses
    'pending': 'status-pending',
    'partial': 'status-partial',
    'cleared': 'status-cleared',
    // Inspection statuses
    'under_inspection': 'status-needs-action',
    'removed': 'status-partial-noa',
    'released': 'status-delivered',
  };
  return map[status] || 'status-created';
};

export const getStatusHistory = (_shipmentId: string): StatusHistory[] => [];
export const getOuterboxes = (_shipmentId: string): Outerbox[] => [];
export const getNoaEntries = (_shipmentId: string): NoaEntry[] => [];
export const getOutboundGroups = (_shipmentId: string): OutboundGroup[] => [];
export const getPallets = (_shipmentId: string): Pallet[] => [];
export const getNotes = (_shipmentId: string): Note[] => [];
