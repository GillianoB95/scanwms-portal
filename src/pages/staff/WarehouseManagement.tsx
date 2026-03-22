import { useState, useMemo } from 'react';
import { Loader2, Pencil, Search } from 'lucide-react';
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

function WarehouseEditDialog({ open, onOpenChange, warehouse }: { open: boolean; onOpenChange: (v: boolean) => void; warehouse: any }) {
  const updateWarehouse = useUpdateWarehouse();
  const [name, setName] = useState(warehouse?.name || '');
  const [code, setCode] = useState(warehouse?.code || '');
  const [email, setEmail] = useState(warehouse?.email || '');
  const [printerIp, setPrinterIp] = useState(warehouse?.label_printer_ip || '');

  const handleSave = () => {
    if (!warehouse?.id) return;
    updateWarehouse.mutate(
      { id: warehouse.id, name, code, email: email || null, label_printer_ip: printerIp || null },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Warehouse — {warehouse?.code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Code</Label>
            <Input value={code} onChange={e => setCode(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="warehouse@example.com" />
          </div>
          <div className="space-y-2">
            <Label>Label Printer IP</Label>
            <Input value={printerIp} onChange={e => setPrinterIp(e.target.value)} placeholder="192.168.1.100" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WarehouseManagement() {
  const { data: warehouses = [], isLoading } = useWarehouses();
  const [search, setSearch] = useState('');
  const [editWarehouse, setEditWarehouse] = useState<any>(null);

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
      <div>
        <h1 className="text-2xl font-bold">Warehouse Management</h1>
        <p className="text-muted-foreground text-sm mt-1">View and edit warehouse configurations</p>
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
              <TableHead>Label Printer IP</TableHead>
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
                  <TableCell className="font-mono text-muted-foreground">{w.label_printer_ip || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setEditWarehouse(w)}>
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

      {editWarehouse && (
        <WarehouseEditDialog
          open={!!editWarehouse}
          onOpenChange={v => { if (!v) setEditWarehouse(null); }}
          warehouse={editWarehouse}
        />
      )}
    </div>
  );
}
