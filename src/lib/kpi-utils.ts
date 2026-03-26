/**
 * KPI utility functions for palletizing and carrier pickup tracking.
 */

export interface NoaKpiEntry {
  noa_number: number;
  colli: number;
  received_at: string | null;
  cumulative_target: number;
  deadline: Date | null;
  status: 'met' | 'overdue' | 'warning' | 'on_track' | 'waiting';
  hours_remaining: number | null;
}

export interface CarrierPickupKpi {
  first_noa_received_at: string | null;
  deadline: Date | null;
  status: 'met' | 'overdue' | 'warning' | 'on_track' | 'waiting';
  hours_remaining: number | null;
  is_unloaded: boolean;
}

export function computeNoaKpis(
  noas: Array<{ noa_number: number; colli: number; received_at: string | null }>,
  palletizedCount: number,
  kpiHours: number,
  warningHours: number,
): NoaKpiEntry[] {
  const now = new Date();
  let cumulative = 0;

  // Sort by noa_number ascending
  const sorted = [...noas].sort((a, b) => a.noa_number - b.noa_number);

  return sorted.map((noa) => {
    cumulative += noa.colli ?? 0;

    if (!noa.received_at) {
      return {
        noa_number: noa.noa_number,
        colli: noa.colli ?? 0,
        received_at: noa.received_at,
        cumulative_target: cumulative,
        deadline: null,
        status: 'waiting' as const,
        hours_remaining: null,
      };
    }

    const deadline = new Date(new Date(noa.received_at).getTime() + kpiHours * 3600_000);
    const met = palletizedCount >= cumulative;

    if (met) {
      return {
        noa_number: noa.noa_number,
        colli: noa.colli ?? 0,
        received_at: noa.received_at,
        cumulative_target: cumulative,
        deadline,
        status: 'met' as const,
        hours_remaining: null,
      };
    }

    const hoursLeft = (deadline.getTime() - now.getTime()) / 3600_000;

    let status: 'overdue' | 'warning' | 'on_track';
    if (hoursLeft <= 0) {
      status = 'overdue';
    } else if (hoursLeft <= warningHours) {
      status = 'warning';
    } else {
      status = 'on_track';
    }

    return {
      noa_number: noa.noa_number,
      colli: noa.colli ?? 0,
      received_at: noa.received_at,
      cumulative_target: cumulative,
      deadline,
      status,
      hours_remaining: Math.max(0, hoursLeft),
    };
  });
}

export function computeCarrierPickupKpi(
  noas: Array<{ received_at: string | null }>,
  unloadedAt: string | null,
  carrierPickupHours: number,
  carrierPickupWarningHours: number,
): CarrierPickupKpi {
  const now = new Date();

  const receivedTimes = noas
    .filter((n) => n.received_at)
    .map((n) => new Date(n.received_at!).getTime());

  if (receivedTimes.length === 0) {
    return { first_noa_received_at: null, deadline: null, status: 'waiting', hours_remaining: null, is_unloaded: !!unloadedAt };
  }

  const firstReceived = new Date(Math.min(...receivedTimes));
  const deadline = new Date(firstReceived.getTime() + carrierPickupHours * 3600_000);
  const isUnloaded = !!unloadedAt;

  if (isUnloaded) {
    return { first_noa_received_at: firstReceived.toISOString(), deadline, status: 'met', hours_remaining: null, is_unloaded: true };
  }

  const hoursLeft = (deadline.getTime() - now.getTime()) / 3600_000;

  let status: 'overdue' | 'warning' | 'on_track';
  if (hoursLeft <= 0) {
    status = 'overdue';
  } else {
    const warningDeadline = new Date(firstReceived.getTime() + carrierPickupWarningHours * 3600_000);
    status = now >= warningDeadline ? 'warning' : 'on_track';
  }

  return {
    first_noa_received_at: firstReceived.toISOString(),
    deadline,
    status,
    hours_remaining: Math.max(0, hoursLeft),
    is_unloaded: false,
  };
}

export function kpiStatusEmoji(status: string): string {
  switch (status) {
    case 'met': return '✅';
    case 'overdue': return '🔴';
    case 'warning': return '🟠';
    case 'on_track': return '🟡';
    case 'waiting': return '⏳';
    default: return '—';
  }
}

export function kpiStatusColor(status: string): string {
  switch (status) {
    case 'met': return 'text-emerald-600';
    case 'overdue': return 'text-destructive';
    case 'warning': return 'text-amber-500';
    case 'on_track': return 'text-yellow-500';
    case 'waiting': return 'text-muted-foreground';
    default: return 'text-muted-foreground';
  }
}

export function formatHoursRemaining(hours: number | null): string {
  if (hours === null) return '';
  if (hours < 1) return `${Math.round(hours * 60)}m remaining`;
  return `${Math.round(hours)}h remaining`;
}

export function formatHoursOverdue(deadline: Date): string {
  const now = new Date();
  const hours = (now.getTime() - deadline.getTime()) / 3600_000;
  if (hours < 1) return `${Math.round(hours * 60)}m overdue`;
  return `${Math.round(hours)}h overdue`;
}
