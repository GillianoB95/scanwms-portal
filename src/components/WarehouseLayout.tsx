import { ReactNode } from 'react';
import { LayoutDashboard, ScanBarcode, ArrowUpFromLine, PackageSearch, Warehouse, ShieldCheck } from 'lucide-react';
import { WarehouseAlarmPanel } from '@/components/warehouse/WarehouseAlarmPanel';
import { PortalLayout } from '@/components/PortalLayout';

const navItems = [
  { to: '/warehouse', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/warehouse/inbound', label: 'Inbound Scanning', icon: ScanBarcode },
  { to: '/warehouse/outbound', label: 'Outbound', icon: ArrowUpFromLine },
  { to: '/warehouse/stock', label: 'Stock Overview', icon: PackageSearch },
  { to: '/warehouse/fyco', label: 'Fyco Management', icon: ShieldCheck },
];

export function WarehouseLayout({ children }: { children: ReactNode }) {
  return <PortalLayout items={navItems} home="/warehouse" brand="WMS" title="Warehouse Portal" icon={Warehouse} alarms={<WarehouseAlarmPanel />}>{children}</PortalLayout>;
}
