import { Loader2, Users, ChevronRight } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useAllCustomers } from '@/hooks/use-staff-data';

export default function CustomerManagement() {
  const { data: customers = [], isLoading } = useAllCustomers();

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
          <p className="text-muted-foreground text-sm mt-1">Manage customer accounts and their users</p>
        </div>
        <Button>
          <Users className="h-4 w-4 mr-2" />
          Add Customer
        </Button>
      </div>

      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No customers found</TableCell>
              </TableRow>
            ) : (
              customers.map((customer: any) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell>{customer.warehouse_id || '—'}</TableCell>
                  <TableCell className="text-right">{customer.customer_users?.length || 0}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <Button variant="ghost" size="sm">
                        Manage <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
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
