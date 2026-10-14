import { ReactNode } from 'react';
import { LayoutDashboard, Package, ArrowDownToLine, ArrowUpFromLine, MapPin, Users, UserCog, Settings, Shield, Warehouse, ShieldCheck, FileCheck, BarChart3 } from 'lucide-react';
import { ActionRequiredPanel } from '@/components/staff/ActionRequiredPanel';
import { PortalLayout } from '@/components/PortalLayout';

const navItems = [
  { to: '/staff', label: 'MAWB Overview', icon: LayoutDashboard, exact: true },
  { to: '/staff/inbound', label: 'Inbound Shipment', icon: ArrowDownToLine },
  { to: '/staff/outbound', label: 'Outbound Shipment', icon: ArrowUpFromLine },
  { to: '/staff/hubs', label: 'Hub Management', icon: MapPin },
  { to: '/staff/warehouses', label: 'Warehouse Management', icon: Warehouse },
  { to: '/staff/customers', label: 'Customer Management', icon: Users },
  { to: '/staff/fyco', label: 'Fyco Management', icon: ShieldCheck },
  { to: '/staff/staff-users', label: 'Staff Management', icon: UserCog },
  { to: '/staff/manifest-cleaner', label: 'Manifest Cleaner', icon: FileCheck },
  { to: '/staff/kpi-dashboard', label: 'KPI Dashboard', icon: BarChart3 },
  { to: '/staff/settings', label: 'Settings', icon: Settings },
];

export function StaffLayout({ children }: { children: ReactNode }) {
  return <PortalLayout items={navItems} home="/staff" brand="STAFF" title="Staff Portal" icon={Shield} footerLink={{ to: '/dashboard', label: 'Customer Portal', icon: Package }} alarms={<ActionRequiredPanel />}>{children}</PortalLayout>;
}
