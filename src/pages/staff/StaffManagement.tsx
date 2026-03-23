import { useState, useMemo } from 'react';
import { Search, Loader2, Trash2, UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { format } from 'date-fns';
import { toast } from 'sonner';

function useStaffUsers() {
  return useQuery({
    queryKey: ['staff-users-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_users')
        .select('*, customers(name)')
        .in('role', ['staff', 'admin'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useUpdateStaffRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const { error } = await supabase.from('customer_users').update({ role }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-users-list'] });
      toast.success('Role updated');
    },
  });
}

function useDeleteStaffUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customer_users').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-users-list'] });
      toast.success('Staff user removed');
    },
  });
}

export default function StaffManagement() {
  const { role: currentRole } = useAuth();
  const isAdmin = currentRole === 'admin';
  const { data: staffUsers = [], isLoading } = useStaffUsers();
  const updateRole = useUpdateStaffRole();
  const deleteUser = useDeleteStaffUser();

  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    return staffUsers.filter((u: any) => {
      if (search && !u.email?.toLowerCase().includes(search.toLowerCase())) return false;
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      return true;
    });
  }, [staffUsers, search, roleFilter]);

  const handleCreateUser = async () => {
    if (!inviteEmail || !invitePassword) return;
    setCreating(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: inviteEmail,
        password: invitePassword,
      });
      if (authError) throw authError;

      const { error: linkError } = await supabase.from('customer_users').insert({
        email: inviteEmail,
        role: inviteRole,
      });
      if (linkError) throw linkError;

      toast.success(`Staff user ${inviteEmail} created`);
      setInviteOpen(false);
      setInviteEmail('');
      setInvitePassword('');
      setInviteRole('staff');
      qc.invalidateQueries({ queryKey: ['staff-users-list'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
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
          <h1 className="text-2xl font-bold">Staff Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage staff and admin users</p>
        </div>
        {isAdmin && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 mr-2" />
                Create Staff User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Staff User</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email *</Label>
                  <Input id="invite-email" type="email" placeholder="staff@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-password">Password *</Label>
                  <Input id="invite-password" type="password" placeholder="Min 6 characters" value={invitePassword} onChange={e => setInvitePassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="staff">Staff</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateUser} disabled={!inviteEmail || !invitePassword || creating}>
                  {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Create User
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="staff">Staff</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} staff user{filtered.length !== 1 ? 's' : ''}</p>

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No staff users found</TableCell>
              </TableRow>
            ) : (
              filtered.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{u.customers?.name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.created_at ? format(new Date(u.created_at), 'dd/MM/yy') : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {isAdmin && (
                        <Select
                          value={u.role}
                          onValueChange={(role) => updateRole.mutate({ id: u.id, role })}
                        >
                          <SelectTrigger className="h-8 w-[100px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="staff">Staff</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Remove"
                          onClick={() => {
                            if (confirm('Remove this staff user?')) deleteUser.mutate(u.id);
                          }}
                        >
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
    </div>
  );
}
