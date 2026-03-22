import { useState } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useAllHubs, useCreateHub, useUpdateHub, useDeleteHub } from '@/hooks/use-staff-data';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

interface HubForm {
  code: string;
  name: string;
  carrier: string;
  active: boolean;
}

const emptyForm: HubForm = { code: '', name: '', carrier: '', active: true };

export default function HubManagement() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { data: hubs = [], isLoading } = useAllHubs();
  const createHub = useCreateHub();
  const updateHub = useUpdateHub();
  const deleteHub = useDeleteHub();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<HubForm>(emptyForm);

  const openCreate = () => { setForm(emptyForm); setEditingId(null); setDialogOpen(true); };
  const openEdit = (hub: any) => {
    setForm({ code: hub.code, name: hub.name || '', carrier: hub.carrier || '', active: hub.active });
    setEditingId(hub.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await updateHub.mutateAsync({ id: editingId, ...form });
        toast.success('Hub updated');
      } else {
        await createHub.mutateAsync(form);
        toast.success('Hub created');
      }
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
        <DialogContent>
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
