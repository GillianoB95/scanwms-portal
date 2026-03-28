import { useState, useMemo } from 'react';
import { Loader2, Plus, Pencil, Trash2, Save, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { useAlarmSettings, useUpdateAlarmSettings } from '@/hooks/use-alarm-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAllWarehouses } from '@/hooks/use-staff-data';
import { toast } from 'sonner';

/* ─── Email Templates ─── */
const DEFAULT_TEMPLATES = [
  {
    key: 'customs_cleared',
    label: 'Customs Cleared',
    default_subject: 'Customs Cleared — {{mawb}}',
    default_body: 'Dear {{customer_name}},\n\nYour shipment {{mawb}} has been cleared by customs.\n\nColli: {{colli_count}}\n\nBest regards',
  },
  {
    key: 'customs_cleared_fyco',
    label: 'Customs Cleared with Fyco',
    default_subject: 'Customs Cleared with Inspections — {{mawb}}',
    default_body: 'Dear {{customer_name}},\n\nYour shipment {{mawb}} has been cleared by customs with {{fyco_count}} inspection(s).\n\nInspected parcels:\n{{parcel_list}}\n\nBest regards',
  },
  {
    key: 'converted_manifest',
    label: 'Converted Manifest',
    default_subject: 'Manifest Converted — {{mawb}}',
    default_body: 'Dear {{customer_name}},\n\nThe manifest for shipment {{mawb}} has been converted and is ready.\n\nColli: {{colli_count}}\n\nBest regards',
  },
  {
    key: 'inbound_finish_scan',
    label: 'Inbound Finish Scan',
    default_subject: 'Inbound Scan Complete — {{mawb}}',
    default_body: 'Dear {{customer_name}},\n\nInbound scanning for shipment {{mawb}} is complete.\n\nColli scanned: {{colli_count}}\n\nBest regards',
  },
];

function useEmailTemplates() {
  return useQuery({
    queryKey: ['email-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('email_templates').select('*').order('template_type');
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useUpsertTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tpl: { template_type: string; subject: string; body: string; email_account_id?: string | null }) => {
      const { data: existing } = await supabase.from('email_templates').select('id').eq('template_type', tpl.template_type).maybeSingle();
      if (existing) {
        const { error } = await supabase.from('email_templates').update({ subject: tpl.subject, body: tpl.body, email_account_id: tpl.email_account_id ?? null }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('email_templates').insert(tpl);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      toast.success('Template saved');
    },
  });
}

function EmailTemplatesTab() {
  const { data: templates = [], isLoading } = useEmailTemplates();
  const upsert = useUpsertTemplate();
  const [editing, setEditing] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const startEdit = (key: string) => {
    const saved = templates.find((t: any) => t.template_type === key);
    const def = DEFAULT_TEMPLATES.find(d => d.key === key)!;
    setSubject(saved?.subject ?? def.default_subject);
    setBody(saved?.body ?? def.default_body);
    setEditing(key);
  };

  const handleSave = async () => {
    if (!editing) return;
    await upsert.mutateAsync({ template_type: editing, subject, body });
    setEditing(null);
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Available placeholders: <code className="text-xs bg-muted px-1 rounded">{'{{customer_name}}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{{mawb}}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{{fyco_count}}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{{parcel_list}}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{{colli_count}}'}</code>
      </p>
      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEFAULT_TEMPLATES.map(def => {
              const saved = templates.find((t: any) => t.template_type === def.key);
              return (
                <TableRow key={def.key}>
                  <TableCell className="font-medium">{def.label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{saved?.subject ?? def.default_subject}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(def.key)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <Dialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit Template — {DEFAULT_TEMPLATES.find(d => d.key === editing)?.label}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input value={subject} onChange={e => setSubject(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Body</Label>
                <Textarea value={body} onChange={e => setBody(e.target.value)} rows={10} className="font-mono text-sm" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={upsert.isPending}>
                {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ─── Email Accounts ─── */
function useEmailAccounts() {
  return useQuery({
    queryKey: ['email-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('email_accounts').select('*, customers(name), warehouses(name, code)').order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useCreateEmailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (account: { customer_id?: string; warehouse_id?: string; from_email: string; from_name?: string; domain: string; resend_api_key?: string; is_default?: boolean }) => {
      const { error } = await supabase.from('email_accounts').insert(account);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-accounts'] });
      toast.success('Email account created');
    },
  });
}

function useUpdateEmailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase.from('email_accounts').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-accounts'] });
      toast.success('Email account updated');
    },
  });
}

function useDeleteEmailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('email_accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-accounts'] });
      toast.success('Email account deleted');
    },
  });
}

function EmailAccountFormDialog({ open, onOpenChange, account }: { open: boolean; onOpenChange: (v: boolean) => void; account?: any }) {
  const { data: warehouses = [] } = useAllWarehouses();
  const { data: customers = [] } = useQuery({
    queryKey: ['staff-customers-simple'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
  const createAccount = useCreateEmailAccount();
  const updateAccount = useUpdateEmailAccount();

  const [customerId, setCustomerId] = useState(account?.customer_id || '');
  const [warehouseId, setWarehouseId] = useState(account?.warehouse_id || '');
  const [fromName, setFromName] = useState(account?.from_name || '');
  const [fromEmail, setFromEmail] = useState(account?.from_email || '');
  const [domain, setDomain] = useState(account?.domain || '');
  const [resendApiKey, setResendApiKey] = useState(account?.resend_api_key || '');
  const [isDefault, setIsDefault] = useState(account?.is_default || false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const isEdit = !!account?.id;

  const handleSave = async () => {
    if (!fromEmail || !domain) return;
    setSaving(true);
    try {
      const payload: any = {
        customer_id: customerId || null,
        warehouse_id: warehouseId || null,
        from_name: fromName || null,
        from_email: fromEmail,
        domain,
        is_default: isDefault,
      };
      // Only include resend_api_key if provided (don't overwrite with empty)
      if (resendApiKey) payload.resend_api_key = resendApiKey;
      if (isEdit) {
        await updateAccount.mutateAsync({ id: account.id, ...payload });
      } else {
        await createAccount.mutateAsync(payload);
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Email Account' : 'Add Email Account'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select customer (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select warehouse (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {warehouses.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>From Name</Label>
            <Input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="DSC Asia" />
          </div>
          <div className="space-y-2">
            <Label>From Email *</Label>
            <Input type="email" value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="noa@dscasia.nl" />
          </div>
          <div className="space-y-2">
            <Label>Domain *</Label>
            <Input value={domain} onChange={e => setDomain(e.target.value)} placeholder="dscasia.nl" />
          </div>
          <div className="space-y-2">
            <Label>Resend API Key</Label>
            <div className="flex gap-2">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={resendApiKey}
                onChange={e => setResendApiKey(e.target.value)}
                placeholder={isEdit ? '••••••••••••' : 're_xxxxxxxxxxxxx'}
                className="font-mono text-sm"
              />
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setShowApiKey(!showApiKey)}>
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Required for sending via Resend. Get it from resend.com/api-keys</p>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            <Label>Default sender for this customer</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!fromEmail || !domain || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmailAccountsTab() {
  const { data: accounts = [], isLoading } = useEmailAccounts();
  const deleteAccount = useDeleteEmailAccount();
  const [formOpen, setFormOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditAccount(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Email Account
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Configure Resend email accounts per customer. The API key is used to send emails directly via the Resend API.</p>
      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>API Key</TableHead>
              <TableHead>Default</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No email accounts configured</TableCell>
              </TableRow>
            ) : accounts.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell>{a.customers?.name || '—'}</TableCell>
                <TableCell>
                  <div>
                    {a.from_name && <span className="text-sm font-medium">{a.from_name} </span>}
                    <span className="font-mono text-sm text-muted-foreground">&lt;{a.from_email}&gt;</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{a.domain}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {a.resend_api_key ? '••••' + a.resend_api_key.slice(-4) : '—'}
                </TableCell>
                <TableCell>
                  {a.is_default && <span className="text-xs font-medium text-accent bg-accent/10 px-2 py-0.5 rounded">Default</span>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditAccount(a); setFormOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(a)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {formOpen && (
        <EmailAccountFormDialog
          open={formOpen}
          onOpenChange={v => { if (!v) { setFormOpen(false); setEditAccount(null); } }}
          account={editAccount}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete email account?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the email account for {deleteTarget?.from_email}.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { deleteAccount.mutate(deleteTarget.id); setDeleteTarget(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── Customs Inspection Email Template ─── */
function useCustomsInspectionTemplate() {
  return useQuery({
    queryKey: ['customs-inspection-template'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('template_type', 'customs_inspection')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function CustomsInspectionTab() {
  const { data: template, isLoading } = useCustomsInspectionTemplate();
  const upsert = useUpsertTemplate();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Sync state when data loads
  if (template && !initialized) {
    setSubject(template.subject || 'Customs Inspection — {{mawb}}');
    setBody(template.body || 'Dear Customs,\n\nPlease find below the inspection parcel(s) for MAWB {{mawb}} at warehouse {{warehouse_name}}.\n\nSLA Deadline: {{sla_deadline}}\n\nParcels:\n{{parcel_list}}\n\nBest regards');
    setRecipients(template.recipients || '');
    setInitialized(true);
  } else if (!template && !isLoading && !initialized) {
    setSubject('Customs Inspection — {{mawb}}');
    setBody('Dear Customs,\n\nPlease find below the inspection parcel(s) for MAWB {{mawb}} at warehouse {{warehouse_name}}.\n\nSLA Deadline: {{sla_deadline}}\n\nParcels:\n{{parcel_list}}\n\nBest regards');
    setInitialized(true);
  }

  const handleSave = async () => {
    // Upsert template + recipients
    const { data: existing } = await supabase.from('email_templates').select('id').eq('template_type', 'customs_inspection').maybeSingle();
    if (existing) {
      const { error } = await supabase.from('email_templates').update({ subject, body, recipients }).eq('id', existing.id);
      if (error) { toast.error('Failed to save'); return; }
    } else {
      const { error } = await supabase.from('email_templates').insert({ template_type: 'customs_inspection', subject, body, recipients });
      if (error) { toast.error('Failed to save'); return; }
    }
    toast.success('Customs inspection template saved');
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Available placeholders: <code className="text-xs bg-muted px-1 rounded">{'{{mawb}}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{{parcel_barcode}}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{{warehouse_name}}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{{sla_deadline}}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{{parcel_list}}'}</code>
      </p>
      <div className="space-y-4 bg-card rounded-xl border p-6">
        <div className="space-y-2">
          <Label>Subject</Label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Body</Label>
          <Textarea value={body} onChange={e => setBody(e.target.value)} rows={10} className="font-mono text-sm" />
        </div>
        <div className="space-y-2">
          <Label>Recipients (comma-separated)</Label>
          <Input value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="customs@example.com, inspector@example.com" />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save Template
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Alarm Settings Tab ─── */
const ALARM_FIELDS = [
  { key: 'fyco_no_check_days', label: 'Fyco: no check alarm', unit: 'working days', description: 'Days after scan without customs check' },
  { key: 'fyco_no_action_days', label: 'Fyco: no action after check', unit: 'working days', description: 'Days after check without further action' },
  { key: 'fyco_docs_no_release_days', label: 'Fyco: docs requested, no release', unit: 'working days', description: 'Days after docs requested without release' },
  { key: 'fyco_action_no_release_days', label: 'Fyco: action required, no release', unit: 'working days', description: 'Days after action required without release' },
  { key: 'shipment_noa_not_unloaded_hours', label: 'Shipment: NOA not unloaded', unit: 'hours', description: 'Hours after NOA received without unloading' },
  { key: 'shipment_no_noa_after_eta_days', label: 'Shipment: no NOA after ETA', unit: 'working days', description: 'Working days after ETA without NOA' },
  { key: 'shipment_created_no_noa_days', label: 'Shipment: no NOA after created', unit: 'working days', description: 'Working days after shipment created without NOA' },
  { key: 'noa_kpi_warning_hours', label: 'Palletizing KPI: warning threshold', unit: 'hours', description: 'Hours before palletizing deadline to show warning' },
  { key: 'carrier_pickup_hours', label: 'Carrier pickup: deadline', unit: 'hours', description: 'Hours after first NOA for carrier to pick up' },
  { key: 'carrier_pickup_warning_hours', label: 'Carrier pickup: warning threshold', unit: 'hours', description: 'Hours before carrier pickup deadline to show warning' },
] as const;

function AlarmSettingsTab() {
  const { data: settings, isLoading } = useAlarmSettings();
  const updateSettings = useUpdateAlarmSettings();
  const [values, setValues] = useState<Record<string, number>>({});
  const [initialized, setInitialized] = useState(false);

  if (settings && !initialized) {
    const v: Record<string, number> = {};
    for (const f of ALARM_FIELDS) {
      v[f.key] = (settings as any)[f.key] ?? 0;
    }
    setValues(v);
    setInitialized(true);
  }

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync(values);
      toast.success('Alarm settings saved');
    } catch {
      toast.error('Failed to save alarm settings');
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure alarm thresholds. Working days count Mon–Fri only. Alarms appear in the Action Required panel.
      </p>
      <div className="bg-card rounded-xl border p-6 space-y-5">
        {ALARM_FIELDS.map(field => (
          <div key={field.key} className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <Label className="text-sm font-medium">{field.label}</Label>
              <p className="text-xs text-muted-foreground">{field.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                className="w-20 text-center h-9"
                value={values[field.key] ?? 0}
                onChange={e => setValues(prev => ({ ...prev, [field.key]: parseInt(e.target.value) || 0 }))}
              />
              <span className="text-xs text-muted-foreground w-24">{field.unit}</span>
            </div>
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            <Save className="h-4 w-4 mr-2" />
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Settings Page ─── */
export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage email templates, accounts, and alarm thresholds</p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Email Templates</TabsTrigger>
          <TabsTrigger value="customs">Customs Inspection Email</TabsTrigger>
          <TabsTrigger value="accounts">Email Accounts</TabsTrigger>
          <TabsTrigger value="alarms">
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            Alarm Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="mt-4">
          <EmailTemplatesTab />
        </TabsContent>
        <TabsContent value="customs" className="mt-4">
          <CustomsInspectionTab />
        </TabsContent>
        <TabsContent value="accounts" className="mt-4">
          <EmailAccountsTab />
        </TabsContent>
        <TabsContent value="alarms" className="mt-4">
          <AlarmSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
