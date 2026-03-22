import { getStatusClass } from '@/lib/mock-data';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge ${getStatusClass(status)}`}>
      {status}
    </span>
  );
}
