import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import {
  LayoutDashboard, Package, ArrowDownToLine, ArrowUpFromLine,
  MapPin, Users, UserCog, Settings, LogOut, Menu, X, Shield, Warehouse
} from 'lucide-react';

const navItems = [
  { to: '/staff', label: 'MAWB Overview', icon: LayoutDashboard, exact: true },
  { to: '/staff/inbound', label: 'Inbound Shipment', icon: ArrowDownToLine },
  { to: '/staff/outbound', label: 'Outbound Shipment', icon: ArrowUpFromLine },
  { to: '/staff/hubs', label: 'Hub Management', icon: MapPin },
  { to: '/staff/customers', label: 'Customer Management', icon: Users },
  { to: '/staff/staff-users', label: 'Staff Management', icon: UserCog },
  { to: '/staff/settings', label: 'Settings', icon: Settings },
];

export function StaffLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const displayName = user?.user_metadata?.full_name || user?.email || '';
  const initials = displayName.includes('@')
    ? displayName[0].toUpperCase()
    : displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase();

  return (
    <div className="min-h-screen flex">
      {mobileOpen && (
        <div className="fixed inset-0 bg-foreground/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`
        fixed lg:sticky top-0 left-0 z-50 h-screen w-64 flex flex-col
        bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-fg))]
        transition-transform duration-300 ease-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="h-16 flex items-center px-6 border-b border-[hsl(var(--sidebar-border))]">
          <Link to="/staff" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
            <Shield className="h-6 w-6 text-[hsl(var(--sidebar-active))]" />
            <span className="text-lg font-bold tracking-tight text-[hsl(var(--sidebar-active))]">SCAN</span>
            <span className="text-lg font-bold tracking-tight text-primary-foreground">STAFF</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150
                  ${active
                    ? 'bg-[hsl(var(--sidebar-active))] text-[hsl(var(--sidebar-primary-foreground))]'
                    : 'hover:bg-[hsl(var(--sidebar-hover))] text-[hsl(var(--sidebar-fg))]'
                  }
                `}
              >
                <item.icon className="h-4.5 w-4.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-4 space-y-1">
          <Link
            to="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-hover))] transition-colors"
          >
            <Package className="h-4.5 w-4.5" />
            Customer Portal
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-hover))] transition-colors"
          >
            <LogOut className="h-4.5 w-4.5" />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-4 lg:px-8 bg-card border-b">
          <button className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-muted" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="hidden lg:flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-accent text-accent-foreground">Staff Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-sm font-semibold">
              {initials}
            </div>
            <span className="text-sm font-medium hidden sm:block">{displayName}</span>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
