import { useState, useMemo } from 'react';
import { Search, Loader2, Plus, Pencil, Trash2, ChevronDown, ChevronRight, Users, Bell } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useAllWarehouses } from '@/hooks/use-staff-data';
import { toast } from 'sonner';

function useCustomersWithSubs() {
  return useQuery({
    queryKey: ['staff-customers-full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*, customer_users(id, email, role), subklanten(id, name)')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (customer: { name: string; short_name?: string; email?: string; warehouse_id?: string; parent_customer_id?: string }) => {
      const { data, error } = await supabase.from('customers').insert(customer).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-customers-full'] });
      toast.success('Customer created');
    },
  });
}

function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase.from('customers').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-customers-full'] });
      toast.success('Customer updated');
    },
  });
}

function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-customers-full'] });
      toast.success('Customer deleted');
    },
  });
}

function useNotificationSettings(customerId: string | undefined) {
  return useQuery({
    queryKey: ['notification-settings', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('customer_id', customerId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!customerId,
  });
}

function useUpsertNotificationSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (setting: { customer_id: string; notification_type: string; enabled: boolean; email: string }) => {
      const { data: existing } = await supabase
        .from('notification_settings')
        .select('id')
        .eq('customer_id', setting.customer_id)
        .eq('notification_type', setting.notification_type)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase.from('notification_settings').update({
          enabled: setting.enabled,
          email: setting.email,
        }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('notification_settings').insert(setting);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['notification-settings', vars.customer_id] });
      toast.success('Notification setting saved');
    },
  });
}

/* ─── Customer Form Dialog ─── */
function CustomerFormDialog({ open, onOpenChange, customer, parentId, isAdmin }: {
  open: boolean; onOpenChange: (v: boolean) => void; customer?: any; parentId?: string; isAdmin: boolean;
}) {
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const { data: warehouses = [] } = useAllWarehouses();
  const [name, setName] = useState(customer?.name || '');
  const [shortName, setShortName] = useState(customer?.short_name || '');
  const [email, setEmail] = useState(customer?.email || '');
  const [warehouseId, setWarehouseId] = useState(customer?.warehouse_id || '');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const isNew = !customer?.id;
  const isSub = !!parentId;

  const handleSave = async () => {
    if (!name) return;
    setSaving(true);
    try {
      const payload: any = { name, short_name: shortName || null, email: email || null, warehouse_id: warehouseId || null };
      if (parentId) payload.parent_customer_id = parentId;

      if (customer?.id) {
        await updateCustomer.mutateAsync({ id: customer.id, ...payload });
        onOpenChange(false);
      } else {
        const newCustomer = await createCustomer.mutateAsync(payload);

        if (userEmail && userPassword) {
          const { data: authData, error: authError } = await supabase.auth.signUp({
            email: userEmail,
            password: userPassword,
          });
          if (authError) throw authError;

          const { error: linkError } = await supabase.from('customer_users').insert({
            email: userEmail,
            customer_id: newCustomer.id,
            role: 'user',
          });
          if (linkError) {
            console.error('Failed to link customer_user:', linkError);
            toast.error('Customer created but user link failed: ' + linkError.message);
          } else {
            toast.success('Customer & login account created');
          }
        }

        onOpenChange(false);
        setName(''); setShortName(''); setEmail(''); setWarehouseId('');
        setUserEmail(''); setUserPassword('');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{customer ? 'Edit Customer' : parentId ? 'Add Sub-Account' : 'Add Customer'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Company name" />
          </div>
          <div className="space-y-2">
            <Label>Short Name</Label>
            <Input value={shortName} onChange={e => setShortName(e.target.value)} placeholder="Short code" />
          </div>
          <div className="space-y-2">
            <Label>Contact Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@company.com" />
          </div>
          <div className="space-y-2">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {warehouses.map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isNew && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Login Account (optional)</p>
              <div className="space-y-2">
                <Label>Login Email</Label>
                <Input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} placeholder="user@company.com" />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" value={userPassword} onChange={e => setUserPassword(e.target.value)} placeholder="Min 6 characters" />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Notification Settings Dialog ─── */
function NotificationSettingsDialog({ customer, open, onOpenChange }: {
  customer: any; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { data: settings = [] } = useNotificationSettings(customer?.id);
  const upsert = useUpsertNotificationSetting();

  const ccCleared = settings.find((s: any) => s.notification_type === 'cc_cleared');
  const inspection = settings.find((s: any) => s.notification_type === 'inspection');

  const [ccEnabled, setCcEnabled] = useState(ccCleared?.enabled ?? false);
  const [ccEmail, setCcEmail] = useState(ccCleared?.email ?? customer?.email ?? '');
  const [inspEnabled, setInspEnabled] = useState(inspection?.enabled ?? false);
  const [inspEmail, setInspEmail] = useState(inspection?.email ?? customer?.email ?? '');

  // Sync when settings load
  useState(() => {
    if (ccCleared) { setCcEnabled(ccCleared.enabled); setCcEmail(ccCleared.email); }
    if (inspection) { setInspEnabled(inspection.enabled); setInspEmail(inspection.email); }
  });

  const handleSave = async () => {
    await upsert.mutateAsync({ customer_id: customer.id, notification_type: 'cc_cleared', enabled: ccEnabled, email: ccEmail || '' });
    await upsert.mutateAsync({ customer_id: customer.id, notification_type: 'inspection', enabled: inspEnabled, email: inspEmail || '' });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notification Settings — {customer?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">CC Cleared</p>
                <p className="text-xs text-muted-foreground">Notify when customs clearance is complete</p>
              </div>
              <Switch checked={ccEnabled} onCheckedChange={setCcEnabled} />
            </div>
            {ccEnabled && (
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={ccEmail} onChange={e => setCcEmail(e.target.value)} placeholder="email@example.com" />
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Inspection</p>
                <p className="text-xs text-muted-foreground">Notify when an inspection is opened</p>
              </div>
              <Switch checked={inspEnabled} onCheckedChange={setInspEnabled} />
            </div>
            {inspEnabled && (
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={inspEmail} onChange={e => setInspEmail(e.target.value)} placeholder="email@example.com" />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={upsert.isPending}>
            {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Page ─── */
export default function CustomerManagement() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { data: customers = [], isLoading } = useCustomersWithSubs();
  const deleteCustomer = useDeleteCustomer();

  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<any>(null);
  const [addSubParentId, setAddSubParentId] = useState<string | undefined>();
  const [notifCustomer, setNotifCustomer] = useState<any>(null);

  const mainCustomers = useMemo(() => {
    return customers
      .filter((c: any) => !c.parent_customer_id)
      .filter((c: any) => !search || c.name?.toLowerCase().includes(search.toLowerCase()));
  }, [customers, search]);

  const subsByParent = useMemo(() => {
    const map = new Map<string, any[]>();
    customers.filter((c: any) => c.parent_customer_id).forEach((c: any) => {
      if (!map.has(c.parent_customer_id)) map.set(c.parent_customer_id, []);
      map.get(c.parent_customer_id)!.push(c);
    });
    return map;
  }, [customers]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openAddDialog = (parentId?: string) => {
    setEditCustomer(null);
    setAddSubParentId(parentId);
    setDialogOpen(true);
  };

  const openEditDialog = (customer: any) => {
    setEditCustomer(customer);
    setAddSubParentId(undefined);
    setDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customer Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage customer accounts and sub-accounts</p>
        </div>
        {isAdmin && (
          <Button onClick={() => openAddDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl border p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{mainCustomers.length} customer{mainCustomers.length !== 1 ? 's' : ''}</p>

      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Short Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Sub-accounts</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mainCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No customers found</TableCell>
              </TableRow>
            ) : (
              mainCustomers.map((customer: any) => {
                const subs = subsByParent.get(customer.id) ?? [];
                const expanded = expandedIds.has(customer.id);

                return (
                  <> 
                    <TableRow key={customer.id}>
                      <TableCell>
                        {subs.length > 0 ? (
                          <button onClick={() => toggleExpand(customer.id)} className="p-1 hover:bg-muted rounded">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        ) : <div className="w-6" />}
                      </TableCell>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell className="text-muted-foreground">{customer.short_name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{customer.email || '—'}</TableCell>
                      <TableCell>{customer.warehouse_id || '—'}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{subs.length}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Notification Settings" onClick={() => setNotifCustomer(customer)}>
                            <Bell className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Add Sub-Account" onClick={() => openAddDialog(customer.id)}>
                              <Users className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEditDialog(customer)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              title="Delete"
                              onClick={() => { if (confirm(`Delete ${customer.name}?`)) deleteCustomer.mutate(customer.id); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && subs.map((sub: any) => (
                      <TableRow key={sub.id} className="bg-muted/30">
                        <TableCell />
                        <TableCell className="pl-10 font-medium text-muted-foreground">↳ {sub.name}</TableCell>
                        <TableCell className="text-muted-foreground">{sub.short_name || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{sub.email || '—'}</TableCell>
                        <TableCell>{sub.warehouse_id || '—'}</TableCell>
                        <TableCell />
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEditDialog(sub)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Delete"
                                onClick={() => { if (confirm(`Delete ${sub.name}?`)) deleteCustomer.mutate(sub.id); }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CustomerFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customer={editCustomer}
        parentId={addSubParentId}
        isAdmin={isAdmin}
      />

      {notifCustomer && (
        <NotificationSettingsDialog
          customer={notifCustomer}
          open={!!notifCustomer}
          onOpenChange={v => { if (!v) setNotifCustomer(null); }}
        />
      )}
    </div>
  );
}
