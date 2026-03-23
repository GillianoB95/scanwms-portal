import { useState, useMemo } from 'react';
import { Loader2, Pencil, Search, Plus, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

function useWarehouses() {
  return useQuery({
    queryKey: ['staff-warehouses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase.from('warehouses').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-warehouses'] });
      toast.success('Warehouse updated');
    },
  });
}

function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (warehouse: { code: string; name: string; email?: string; printnode_id?: string; printnode_key?: string; printnode_name?: string }) => {
      const { data, error } = await supabase.from('warehouses').insert(warehouse).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-warehouses'] });
      toast.success('Warehouse created');
    },
  });
}

function WarehouseFormDialog({ open, onOpenChange, warehouse }: { open: boolean; onOpenChange: (v: boolean) => void; warehouse?: any }) {
  const updateWarehouse = useUpdateWarehouse();
  const createWarehouse = useCreateWarehouse();
  const [name, setName] = useState(warehouse?.name || '');
  const [code, setCode] = useState(warehouse?.code || '');
  const [email, setEmail] = useState(warehouse?.email || '');
  const [printnodeId, setPrintnodeId] = useState(warehouse?.printnode_id || '');
  const [printnodeKey, setPrintnodeKey] = useState(warehouse?.printnode_key || '');
  const [printnodeName, setPrintnodeName] = useState(warehouse?.printnode_name || '');
  const [saving, setSaving] = useState(false);

  const isEdit = !!warehouse?.id;

  const handleSave = async () => {
    if (!code || !name) return;
    setSaving(true);
    try {
      const payload = {
        name,
        code,
        email: email || null,
        printnode_id: printnodeId || null,
        printnode_key: printnodeKey || null,
        printnode_name: printnodeName || null,
      };
      if (isEdit) {
        await updateWarehouse.mutateAsync({ id: warehouse.id, ...payload });
      } else {
        await createWarehouse.mutateAsync(payload);
      }
      onOpenChange(false);
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
          <DialogTitle>{isEdit ? `Edit Warehouse — ${warehouse?.code}` : 'Create Warehouse'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Code *</Label>
              <Input value={code} onChange={e => setCode(e.target.value)} placeholder="WH-001" />
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Warehouse Name" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="warehouse@example.com" />
          </div>
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium text-muted-foreground">PrintNode Configuration</p>
            <div className="space-y-2">
              <Label>PrintNode Print ID</Label>
              <Input value={printnodeId} onChange={e => setPrintnodeId(e.target.value)} placeholder="Printer ID" />
            </div>
            <div className="space-y-2">
              <Label>PrintNode Print Key</Label>
              <Input value={printnodeKey} onChange={e => setPrintnodeKey(e.target.value)} placeholder="API Key" />
            </div>
            <div className="space-y-2">
              <Label>PrintNode Print Name</Label>
              <Input value={printnodeName} onChange={e => setPrintnodeName(e.target.value)} placeholder="Printer name" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!code || !name || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WarehouseManagement() {
  const { data: warehouses = [], isLoading } = useWarehouses();
  const [search, setSearch] = useState('');
  const [formWarehouse, setFormWarehouse] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return warehouses;
    return warehouses.filter((w: any) =>
      w.code?.toLowerCase().includes(search.toLowerCase()) ||
      w.name?.toLowerCase().includes(search.toLowerCase())
    );
  }, [warehouses, search]);

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
          <h1 className="text-2xl font-bold">Warehouse Management</h1>
          <p className="text-muted-foreground text-sm mt-1">View and edit warehouse configurations</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Warehouse
        </Button>
      </div>

      <div className="bg-card rounded-xl border p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search warehouses..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} warehouse{filtered.length !== 1 ? 's' : ''}</p>

      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Printer</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No warehouses found</TableCell>
              </TableRow>
            ) : (
              filtered.map((w: any) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono font-medium">{w.code}</TableCell>
                  <TableCell>{w.name}</TableCell>
                  <TableCell className="text-muted-foreground">{w.email || '—'}</TableCell>
                  <TableCell>
                    {w.printnode_id ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setFormWarehouse(w)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {formWarehouse && (
        <WarehouseFormDialog
          open={!!formWarehouse}
          onOpenChange={v => { if (!v) setFormWarehouse(null); }}
          warehouse={formWarehouse}
        />
      )}

      {createOpen && (
        <WarehouseFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
    </div>
  );
}
