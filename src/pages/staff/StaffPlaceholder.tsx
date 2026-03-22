import { Construction } from 'lucide-react';

export default function StaffPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Construction className="h-12 w-12 mb-4 opacity-40" />
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="text-sm mt-2">This section is under construction.</p>
    </div>
  );
}
