export type ShipmentStatus = 'Created' | 'NOA Received' | 'Arrived' | 'In Stock' | 'In Transit' | 'Delivered';
export type PalletStatus = 'Palletized' | 'Loaded' | 'Delivered';

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

export const shipments: Shipment[] = [
  { id: '1', mawb: '235-84729301', subklant: 'PostNL Express', subklantId: 'sk1', pieces: 48, parcels: 312, chargeableWeight: 2840, warehouse: 'AMS-01', status: 'Delivered', transportType: 'AIR', createdAt: '2025-03-18', colliExpected: 48, colliNoa: 48 },
  { id: '2', mawb: '074-19283746', subklant: 'DHL Parcel', subklantId: 'sk2', pieces: 22, parcels: 156, chargeableWeight: 1420, warehouse: 'AMS-02', status: 'In Transit', transportType: 'AIR', createdAt: '2025-03-19', colliExpected: 22, colliNoa: 22 },
  { id: '3', mawb: '180-55738291', subklant: 'GLS Netherlands', subklantId: 'sk3', pieces: 35, parcels: 244, chargeableWeight: 1980, warehouse: 'AMS-01', status: 'In Stock', transportType: 'AIR', createdAt: '2025-03-20', colliExpected: 35, colliNoa: 33 },
  { id: '4', mawb: '607-33847291', subklant: 'PostNL Express', subklantId: 'sk1', pieces: 15, parcels: 89, chargeableWeight: 760, warehouse: 'AMS-02', status: 'Arrived', transportType: 'AIR', createdAt: '2025-03-20', colliExpected: 15, colliNoa: null },
  { id: '5', mawb: '176-92847130', subklant: 'DPD Benelux', subklantId: 'sk4', pieces: 60, parcels: 420, chargeableWeight: 3200, warehouse: 'AMS-01', status: 'NOA Received', transportType: 'AIR', createdAt: '2025-03-21', colliExpected: 60, colliNoa: 58 },
  { id: '6', mawb: '235-10293847', subklant: 'PostNL Express', subklantId: 'sk1', pieces: 28, parcels: 195, chargeableWeight: 1650, warehouse: 'AMS-01', status: 'Created', transportType: 'AIR', createdAt: '2025-03-22', colliExpected: 28, colliNoa: null },
];

export const getStatusHistory = (shipmentId: string): StatusHistory[] => {
  const histories: Record<string, StatusHistory[]> = {
    '1': [
      { status: 'Created', changedBy: 'System', changedAt: '2025-03-18 08:00', notes: 'Shipment created via portal' },
      { status: 'NOA Received', changedBy: 'KLM Cargo', changedAt: '2025-03-18 14:30' },
      { status: 'Arrived', changedBy: 'Warehouse AMS-01', changedAt: '2025-03-19 06:15' },
      { status: 'In Stock', changedBy: 'Warehouse AMS-01', changedAt: '2025-03-19 09:45', notes: 'All 48 colli scanned in' },
      { status: 'In Transit', changedBy: 'Transport Desk', changedAt: '2025-03-19 16:00' },
      { status: 'Delivered', changedBy: 'Driver M. de Vries', changedAt: '2025-03-20 11:30' },
    ],
    '2': [
      { status: 'Created', changedBy: 'System', changedAt: '2025-03-19 10:00' },
      { status: 'NOA Received', changedBy: 'Martinair', changedAt: '2025-03-19 18:00' },
      { status: 'Arrived', changedBy: 'Warehouse AMS-02', changedAt: '2025-03-20 07:00' },
      { status: 'In Stock', changedBy: 'Warehouse AMS-02', changedAt: '2025-03-20 10:00' },
      { status: 'In Transit', changedBy: 'Transport Desk', changedAt: '2025-03-21 08:00' },
    ],
  };
  return histories[shipmentId] || [
    { status: 'Created', changedBy: 'System', changedAt: '2025-03-20 09:00' },
  ];
};

export const getOuterboxes = (shipmentId: string): Outerbox[] => {
  if (shipmentId === '1') {
    return Array.from({ length: 48 }, (_, i) => ({
      id: `ob-${i}`,
      barcode: `AMS${String(i + 1).padStart(4, '0')}`,
      status: 'scanned_out' as const,
      scannedInAt: '2025-03-19 09:00',
      scannedOutAt: '2025-03-19 16:00',
      palletId: `p-${Math.floor(i / 12)}`,
    }));
  }
  if (shipmentId === '3') {
    return Array.from({ length: 35 }, (_, i) => ({
      id: `ob-${i}`,
      barcode: `AMS${String(i + 1).padStart(4, '0')}`,
      status: i < 30 ? 'in_stock' as const : i < 33 ? 'scanned_in' as const : 'expected' as const,
      scannedInAt: i < 33 ? '2025-03-20 10:00' : null,
      scannedOutAt: null,
      palletId: null,
    }));
  }
  return [];
};

export const getNoaEntries = (shipmentId: string): NoaEntry[] => {
  const entries: Record<string, NoaEntry[]> = {
    '1': [
      { id: 'noa-1', noaNumber: 1, receivedAt: '2025-03-18 09:00', colli: 24, weight: 1420, filePath: '/noa/1-1.pdf' },
      { id: 'noa-2', noaNumber: 2, receivedAt: '2025-03-18 14:30', colli: 24, weight: 1420, filePath: '/noa/1-2.pdf' },
    ],
    '3': [
      { id: 'noa-3', noaNumber: 1, receivedAt: '2025-03-20 09:00', colli: 20, weight: 1130, filePath: '/noa/3-1.pdf' },
      { id: 'noa-4', noaNumber: 2, receivedAt: '2025-03-20 14:30', colli: 13, weight: 850, filePath: '/noa/3-2.pdf' },
    ],
    '5': [
      { id: 'noa-5', noaNumber: 1, receivedAt: '2025-03-21 10:00', colli: 58, weight: 3100, filePath: '/noa/5-1.pdf' },
    ],
  };
  return entries[shipmentId] || [];
};

export const getOutboundGroups = (shipmentId: string): OutboundGroup[] => {
  if (shipmentId === '1') {
    return [
      {
        hub: 'UPS Netherlands',
        hubCode: 'UPS-NL',
        totalExpected: 30,
        totalPickedUp: 30,
        stillInStock: 0,
        pickups: [
          {
            date: '2025-03-19',
            truckReference: 'XY-123-NL',
            totalPieces: 24,
            pallets: [
              { id: 'p-0', palletNumber: 'PLT-001', pieces: 12, weight: 710, status: 'Delivered' },
              { id: 'p-1', palletNumber: 'PLT-002', pieces: 12, weight: 695, status: 'Delivered' },
            ],
          },
          {
            date: '2025-03-20',
            truckReference: 'AB-456-NL',
            totalPieces: 6,
            pallets: [
              { id: 'p-4', palletNumber: 'PLT-005', pieces: 6, weight: 310, status: 'Delivered' },
            ],
          },
        ],
      },
      {
        hub: 'DHL Germany',
        hubCode: 'DHL-DE',
        totalExpected: 18,
        totalPickedUp: 18,
        stillInStock: 0,
        pickups: [
          {
            date: '2025-03-19',
            truckReference: 'CD-789-DE',
            totalPieces: 18,
            pallets: [
              { id: 'p-2', palletNumber: 'PLT-003', pieces: 12, weight: 720, status: 'Delivered' },
              { id: 'p-3', palletNumber: 'PLT-004', pieces: 6, weight: 360, status: 'Delivered' },
            ],
          },
        ],
      },
    ];
  }
  return [];
};

export const getPallets = (shipmentId: string): Pallet[] => {
  const groups = getOutboundGroups(shipmentId);
  return groups.flatMap(g => g.pickups.flatMap(p => p.pallets));
};

export const getNotes = (shipmentId: string): Note[] => {
  if (shipmentId === '1') {
    return [
      { id: 'n1', author: 'Warehouse Team', content: 'All boxes received in good condition. No damage reported.', createdAt: '2025-03-19 10:15' },
      { id: 'n2', author: 'Transport Desk', content: 'Split across 2 trucks due to hub routing. TR-0382 and TR-0385.', createdAt: '2025-03-19 15:45' },
    ];
  }
  if (shipmentId === '3') {
    return [
      { id: 'n1', author: 'Warehouse Team', content: '2 colli missing from NOA count. Investigating with airline.', createdAt: '2025-03-20 11:00' },
    ];
  }
  return [];
};

export const statusOrder: ShipmentStatus[] = ['Created', 'NOA Received', 'Arrived', 'In Stock', 'In Transit', 'Delivered'];

export const getStatusClass = (status: ShipmentStatus): string => {
  const map: Record<ShipmentStatus, string> = {
    'Created': 'status-created',
    'NOA Received': 'status-noa',
    'Arrived': 'status-arrived',
    'In Stock': 'status-instock',
    'In Transit': 'status-intransit',
    'Delivered': 'status-delivered',
  };
  return map[status];
};
