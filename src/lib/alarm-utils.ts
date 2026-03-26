/**
 * Alarm utility functions for Fyco & Shipment alarms.
 * Working days = Mon–Fri only.
 */

export interface AlarmSettings {
  id?: string;
  fyco_no_check_days: number;
  fyco_no_action_days: number;
  fyco_docs_no_release_days: number;
  fyco_action_no_release_days: number;
  shipment_noa_not_unloaded_hours: number;
  shipment_no_noa_after_eta_days: number;
  shipment_created_no_noa_days: number;
  noa_kpi_warning_hours: number;
  carrier_pickup_hours: number;
  carrier_pickup_warning_hours: number;
}

export const DEFAULT_ALARM_SETTINGS: AlarmSettings = {
  fyco_no_check_days: 2,
  fyco_no_action_days: 3,
  fyco_docs_no_release_days: 5,
  fyco_action_no_release_days: 5,
  shipment_noa_not_unloaded_hours: 24,
  shipment_no_noa_after_eta_days: 2,
  shipment_created_no_noa_days: 5,
  noa_kpi_warning_hours: 12,
  carrier_pickup_hours: 16,
  carrier_pickup_warning_hours: 12,
};

/** Count working days (Mon-Fri) between two dates */
export function workingDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/** Hours between two dates */
export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

export interface FycoAlarm {
  stage: 1 | 2 | 3 | 4;
  label: string;
  description: string;
}

/** Determine if a fyco inspection row has an alarm */
export function getFycoAlarm(
  row: {
    scan_time: string | null;
    checked_at: string | null;
    documents_requested: boolean;
    documents_requested_at: string | null;
    additional_action_required: boolean;
    additional_action_at: string | null;
    released_at: string | null;
  },
  settings: AlarmSettings,
): FycoAlarm | null {
  const now = new Date();

  // Stage 1: scanned but not checked
  if (row.scan_time && !row.checked_at) {
    const days = workingDaysBetween(new Date(row.scan_time), now);
    if (days > settings.fyco_no_check_days) {
      return { stage: 1, label: 'No check', description: `No check — overdue (${days} working days)` };
    }
  }

  // Stage 2: checked but no further action taken
  if (row.checked_at && !row.documents_requested && !row.additional_action_required && !row.released_at) {
    const days = workingDaysBetween(new Date(row.checked_at), now);
    if (days > settings.fyco_no_action_days) {
      return { stage: 2, label: 'No action', description: `No action after check — overdue (${days} working days)` };
    }
  }

  // Stage 3+4: both docs and action active — use latest timestamp
  if (row.documents_requested_at && row.additional_action_at && !row.released_at) {
    const latest = new Date(Math.max(
      new Date(row.documents_requested_at).getTime(),
      new Date(row.additional_action_at).getTime(),
    ));
    const days = workingDaysBetween(latest, now);
    const threshold = Math.max(settings.fyco_docs_no_release_days, settings.fyco_action_no_release_days);
    if (days > threshold) {
      return { stage: 4, label: 'No release', description: `Docs + action pending, no release — overdue (${days} working days)` };
    }
    return null;
  }

  // Stage 3: docs requested, no release
  if (row.documents_requested_at && !row.additional_action_required && !row.released_at) {
    const days = workingDaysBetween(new Date(row.documents_requested_at), now);
    if (days > settings.fyco_docs_no_release_days) {
      return { stage: 3, label: 'Docs no release', description: `Docs requested, no release — overdue (${days} working days)` };
    }
  }

  // Stage 4: action required, no release
  if (row.additional_action_at && !row.released_at) {
    const days = workingDaysBetween(new Date(row.additional_action_at), now);
    if (days > settings.fyco_action_no_release_days) {
      return { stage: 4, label: 'Action no release', description: `Action required, no release — overdue (${days} working days)` };
    }
  }

  return null;
}

export interface ShipmentAlarm {
  type: 'noa_not_unloaded' | 'no_noa_after_eta' | 'action_required';
  label: string;
  description: string;
}

/** Determine shipment-level alarms */
export function getShipmentAlarms(
  shipment: {
    id: string;
    mawb: string;
    status: string;
    eta: string | null;
    noa_received_at: string | null;
    unloaded_at: string | null;
    customer_name: string | null;
  },
  settings: AlarmSettings,
): ShipmentAlarm[] {
  const alarms: ShipmentAlarm[] = [];
  const now = new Date();

  // Action Required status
  if (shipment.status === 'Needs Action') {
    alarms.push({
      type: 'action_required',
      label: 'Action Required',
      description: `${shipment.mawb} — Action Required`,
    });
  }

  // NOA received but not unloaded
  const noaPastStatuses = ['NOA Complete', 'Partial NOA', 'In Transit', 'In Stock'];
  if (shipment.noa_received_at && !shipment.unloaded_at && noaPastStatuses.includes(shipment.status)) {
    const hrs = hoursBetween(new Date(shipment.noa_received_at), now);
    if (hrs > settings.shipment_noa_not_unloaded_hours) {
      alarms.push({
        type: 'noa_not_unloaded',
        label: 'NOA not unloaded',
        description: `${shipment.mawb} — NOA received, not unloaded (${Math.round(hrs)}h)`,
      });
    }
  }

  // No NOA after ETA
  if (shipment.eta && shipment.status === 'Awaiting NOA') {
    const days = workingDaysBetween(new Date(shipment.eta), now);
    if (days > settings.shipment_no_noa_after_eta_days) {
      alarms.push({
        type: 'no_noa_after_eta',
        label: 'No NOA after ETA',
        description: `${shipment.mawb} — No NOA after ETA (${days} working days)`,
      });
    }
  }

  return alarms;
}
