import { useState, useEffect } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAllHubs, useCreateHub, useUpdateHub, useDeleteHub } from '@/hooks/use-staff-data';
import { useAuth } from '@/lib/auth-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface HubForm {
  code: string;
  name: string;
  carrier: string;
  active: boolean;
}

interface HubAddress {
  id?: string;
  hub_id?: string;
  name: string;
  street: string;
  house_number: string;
  postal_code: string;
  city: string;
  country: string;
}

const emptyForm: HubForm = { code: '', name: '', carrier: '', active: true };
const emptyAddress: HubAddress = { name: '', street: '', house_number: '', postal_code: '', city: '', country: '' };

export default function HubManagement() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { data: hubs = [], isLoading } = useAllHubs();
  const createHub = useCreateHub();
  const updateHub = useUpdateHub();
  const deleteHub = useDeleteHub();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<HubForm>(emptyForm);
  const [addresses, setAddresses] = useState<HubAddress[]>([]);
  const [deletedAddressIds, setDeletedAddressIds] = useState<string[]>([]);

  const { data: hubAddresses = [] } = useQuery({
    queryKey: ['hub-addresses', editingId],
    queryFn: async () => {
      if (!editingId) return [];
      const { data, error } = await supabase
        .from('hub_addresses')
        .select('*')
        .eq('hub_id', editingId)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!editingId && dialogOpen,
  });

  useEffect(() => {
    if (editingId && hubAddresses.length >= 0) {
      setAddresses(hubAddresses.map((a: any) => ({ ...a })));
    }
  }, [hubAddresses, editingId]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setAddresses([]);
    setDeletedAddressIds([]);
    setDialogOpen(true);
  };

  const openEdit = (hub: any) => {
    setForm({ code: hub.code, name: hub.name || '', carrier: hub.carrier || '', active: hub.active });
    setEditingId(hub.id);
    setDeletedAddressIds([]);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      let hubId = editingId;
      if (editingId) {
        await updateHub.mutateAsync({ id: editingId, ...form });
      } else {
        const created = await createHub.mutateAsync(form);
        hubId = (created as any).id;
      }

      // Save addresses
      if (hubId) {
        // Delete removed addresses
        for (const id of deletedAddressIds) {
          await supabase.from('hub_addresses').delete().eq('id', id);
        }
        // Upsert addresses
        for (const addr of addresses) {
          if (addr.id) {
            await supabase.from('hub_addresses').update({
              name: addr.name, street: addr.street, house_number: addr.house_number,
              postal_code: addr.postal_code, city: addr.city, country: addr.country,
            }).eq('id', addr.id);
          } else {
            await supabase.from('hub_addresses').insert({
              hub_id: hubId, name: addr.name, street: addr.street, house_number: addr.house_number,
              postal_code: addr.postal_code, city: addr.city, country: addr.country,
            });
          }
        }
        qc.invalidateQueries({ queryKey: ['hub-addresses'] });
      }

      toast.success(editingId ? 'Hub updated' : 'Hub created');
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save hub');
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Delete hub ${code}?`)) return;
    try {
      await deleteHub.mutateAsync(id);
      toast.success('Hub deleted');
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete hub');
    }
  };

  const handleToggleActive = (hub: any) => {
    updateHub.mutate({ id: hub.id, active: !hub.active });
  };

  const addAddress = () => setAddresses(prev => [...prev, { ...emptyAddress }]);
  const removeAddress = (idx: number) => {
    const addr = addresses[idx];
    if (addr.id) setDeletedAddressIds(prev => [...prev, addr.id!]);
    setAddresses(prev => prev.filter((_, i) => i !== idx));
  };
  const updateAddress = (idx: number, field: keyof HubAddress, value: string) => {
    setAddresses(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
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
          <h1 className="text-2xl font-bold">Hub Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage warehouse hubs and carriers</p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Hub
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hubs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No hubs configured</TableCell>
              </TableRow>
            ) : (
              hubs.map((hub: any) => (
                <TableRow key={hub.id}>
                  <TableCell className="font-mono font-medium">{hub.code}</TableCell>
                  <TableCell>{hub.name || '—'}</TableCell>
                  <TableCell>{hub.carrier || '—'}</TableCell>
                  <TableCell>
                    <Switch checked={hub.active} onCheckedChange={() => handleToggleActive(hub)} className="scale-90" />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(hub)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(hub.id, hub.code)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Hub' : 'Add New Hub'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="e.g. UPS-NL" />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. UPS Netherlands" />
            </div>
            <div className="space-y-2">
              <Label>Carrier</Label>
              <Input value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} placeholder="e.g. UPS" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={active => setForm(f => ({ ...f, active }))} />
              <Label>Active</Label>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Addresses</p>
                <Button type="button" variant="outline" size="sm" onClick={addAddress}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Address
                </Button>
              </div>

              {addresses.length === 0 && (
                <p className="text-sm text-muted-foreground">No addresses configured for this hub.</p>
              )}

              {addresses.map((addr, idx) => (
                <div key={idx} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Address {idx + 1}</p>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeAddress(idx)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Input placeholder="Name" value={addr.name} onChange={e => updateAddress(idx, 'name', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input placeholder="Street" value={addr.street} onChange={e => updateAddress(idx, 'street', e.target.value)} className="col-span-2" />
                    <Input placeholder="Nr" value={addr.house_number} onChange={e => updateAddress(idx, 'house_number', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input placeholder="Postal code" value={addr.postal_code} onChange={e => updateAddress(idx, 'postal_code', e.target.value)} />
                    <Input placeholder="City" value={addr.city} onChange={e => updateAddress(idx, 'city', e.target.value)} />
                    <Input placeholder="Country" value={addr.country} onChange={e => updateAddress(idx, 'country', e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.code}>
              {editingId ? 'Save Changes' : 'Create Hub'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
