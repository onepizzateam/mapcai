import type { VehicleStatus } from '@/lib/types';

// StatusBadge — sentence-case status pill (agents.md §6 copy decisions):
// "Driving" / "Charging" / "Parked" — not all-caps, not icons-only.

const LABEL: Record<VehicleStatus, string> = {
  driving: 'Driving',
  charging: 'Charging',
  parked: 'Parked',
};

const DOT: Record<VehicleStatus, string> = {
  driving: 'bg-driving',
  charging: 'bg-charging',
  parked: 'bg-parked',
};

export function StatusBadge({ status }: { status: VehicleStatus }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] font-medium text-text-primary">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} aria-hidden />
      {LABEL[status]}
    </span>
  );
}
