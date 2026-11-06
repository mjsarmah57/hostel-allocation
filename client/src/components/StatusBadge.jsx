const COLORS = {
  ALLOCATED: 'bg-amber-100 text-amber-800',
  FEE_SUBMITTED: 'bg-sky-100 text-sky-800',
  VERIFIED: 'bg-indigo-100 text-indigo-800',
  CHECKED_IN: 'bg-emerald-100 text-emerald-800',
  VACATED: 'bg-slate-100 text-slate-600',
  RELEASED: 'bg-rose-100 text-rose-800',
  SWAPPED: 'bg-slate-100 text-slate-600',
  PENDING_PEER: 'bg-amber-100 text-amber-800',
  PENDING_WARDEN: 'bg-sky-100 text-sky-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
  DRAFT: 'bg-slate-100 text-slate-600',
  PREFERENCES_OPEN: 'bg-sky-100 text-sky-800',
  BOOKING_OPEN: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-100 text-slate-600',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${COLORS[status] || 'bg-slate-100'}`}>
      {status?.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}
