import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, Menu, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

export interface PortalNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface PortalLayoutProps {
  children: ReactNode;
  items: PortalNavItem[];
  home: string;
  brand: string;
  title: string;
  icon: LucideIcon;
  footerLink?: PortalNavItem;
  alarms?: ReactNode;
}

export function PortalLayout({ children, items, home, brand, title, icon: BrandIcon, footerLink, alarms }: PortalLayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const displayName: string = user?.user_metadata?.full_name || user?.email || '';
  const initials = displayName.includes('@')
    ? displayName.slice(0, 1).toUpperCase()
    : displayName.split(' ').filter(Boolean).slice(0, 2).map(name => name.slice(0, 1)).join('').toUpperCase();
  const current = items.find(item => item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to));

  const navigation = (mobile: boolean) => (
    <>
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-5">
        <Link to={home} className="flex items-center gap-2 text-lg font-bold" aria-label={`${title} home`}>
          <BrandIcon className="h-6 w-6 text-sidebar-primary" />
          <span className="text-sidebar-primary">SCAN</span>
          <span className="text-sidebar-primary-foreground">{brand}</span>
        </Link>
      </div>
      <nav aria-label={title} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4">
        {items.map(item => {
          const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
          const link = (
            <Link to={item.to} aria-current={active ? 'page' : undefined} className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'}`}>
              <item.icon className="h-5 w-5 shrink-0" />{item.label}
            </Link>
          );
          return mobile ? <SheetClose asChild key={item.to}>{link}</SheetClose> : <div key={item.to}>{link}</div>;
        })}
      </nav>
      <div className="portal-nav-footer shrink-0 space-y-1 border-t border-sidebar-border px-3 pt-3">
        {footerLink && <Button variant="ghost" asChild className="min-h-11 w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><Link to={footerLink.to}><footerLink.icon className="h-5 w-5" />{footerLink.label}</Link></Button>}
        <Button variant="ghost" onClick={() => logout()} className="min-h-11 w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><LogOut className="h-5 w-5" />Log out</Button>
      </div>
    </>
  );

  return (
    <div className="portal-shell flex min-h-dvh w-full min-w-0">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">{navigation(false)}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="portal-header sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b bg-card px-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet>
              <SheetTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></Button></SheetTrigger>
              <SheetContent side="left" aria-describedby={undefined} className="flex h-dvh w-[min(20rem,90vw)] max-w-none flex-col gap-0 bg-sidebar p-0 text-sidebar-foreground sm:max-w-none [&>button]:text-sidebar-foreground">
                <SheetTitle className="sr-only">{title} navigation</SheetTitle>
                {navigation(true)}
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold lg:hidden">{current?.label || title}</p>
              <p className="text-xs text-muted-foreground lg:text-sm">{title}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground" title={displayName}>{initials}</div>
            <span className="hidden max-w-64 truncate text-sm font-medium sm:block">{displayName}</span>
          </div>
        </header>
        <main className="portal-content min-w-0 flex-1 p-3 sm:p-6 lg:p-8">{children}</main>
      </div>
      {alarms}
    </div>
  );
}