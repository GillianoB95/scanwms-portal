import { ReactNode } from 'react';
import { LayoutDashboard, Package, PlusCircle, Truck } from 'lucide-react';
import { PortalLayout } from '@/components/PortalLayout';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/shipments', label: 'Shipments', icon: Package },
  { to: '/outbounds', label: 'Outbounds', icon: Truck },
  { to: '/new-shipment', label: 'New Shipment', icon: PlusCircle },
];

export function AppLayout({ children }: { children: ReactNode }) {
  return <PortalLayout items={navItems} home="/dashboard" brand="WMS" title="Customer Portal" icon={Package}>{children}</PortalLayout>;
}
