import { type ShipmentStatus, getStatusClass } from '@/lib/mock-data';

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  return (
    <span className={`status-badge ${getStatusClass(status)}`}>
      {status}
    </span>
  );
}
