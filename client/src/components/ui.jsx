import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

// ---------- Page header ----------
export function PageHeader({ title, subtitle, back, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-campus-700">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Panel with optional title ----------
export function Panel({ title, action, children, className = '', bodyClass = 'p-5' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

// ---------- Stat tile: the number is the hero, the label is quiet ----------
export function Stat({ label, value, hint, icon: Icon, tone = 'default', to }) {
  const tones = {
    default: 'text-ink',
    good: 'text-campus-700',
    warn: 'text-marigold-700',
    bad: 'text-red-700',
  };
  const body = (
    <div className="panel flex h-full items-start justify-between gap-3 p-4">
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className={`mt-1 text-3xl font-bold tracking-tight ${tones[tone]}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
      {Icon && <Icon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />}
    </div>
  );
  return to ? <Link to={to} className="block rounded-xl hover:ring-2 hover:ring-campus-100">{body}</Link> : body;
}

// ---------- Badges ----------
const BADGE = {
  ALLOCATED: 'bg-marigold-50 text-marigold-700 ring-marigold-100',
  FEE_SUBMITTED: 'bg-sky-50 text-sky-800 ring-sky-100',
  VERIFIED: 'bg-indigo-50 text-indigo-800 ring-indigo-100',
  CHECKED_IN: 'bg-campus-50 text-campus-700 ring-campus-100',
  VACATED: 'bg-slate-100 text-slate-600 ring-slate-200',
  RELEASED: 'bg-red-50 text-red-800 ring-red-100',
  SWAPPED: 'bg-slate-100 text-slate-600 ring-slate-200',
  PENDING_PEER: 'bg-marigold-50 text-marigold-700 ring-marigold-100',
  PENDING_WARDEN: 'bg-sky-50 text-sky-800 ring-sky-100',
  APPROVED: 'bg-campus-50 text-campus-700 ring-campus-100',
  REJECTED: 'bg-red-50 text-red-800 ring-red-100',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
  PENDING: 'bg-marigold-50 text-marigold-700 ring-marigold-100',
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  PREFERENCES_OPEN: 'bg-sky-50 text-sky-800 ring-sky-100',
  BOOKING_OPEN: 'bg-campus-50 text-campus-700 ring-campus-100',
  CLOSED: 'bg-slate-100 text-slate-600 ring-slate-200',
  OPEN: 'bg-red-50 text-red-800 ring-red-100',
  IN_PROGRESS: 'bg-marigold-50 text-marigold-700 ring-marigold-100',
  RESOLVED: 'bg-campus-50 text-campus-700 ring-campus-100',
  HIGH: 'bg-red-50 text-red-800 ring-red-100',
  MEDIUM: 'bg-marigold-50 text-marigold-700 ring-marigold-100',
  LOW: 'bg-slate-100 text-slate-600 ring-slate-200',
  INACTIVE: 'bg-slate-100 text-slate-600 ring-slate-200',
  ACTIVE: 'bg-campus-50 text-campus-700 ring-campus-100',
};

export const humanize = (s) => (s ? s.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : '');

export function Badge({ status, children }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[status] || 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
      {children || humanize(status)}
    </span>
  );
}

// ---------- Feedback ----------
export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-2 py-12 text-sm text-slate-500" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {label}…
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p>{message}</p>
        {onRetry && <button type="button" className="btn-secondary btn-sm mt-3" onClick={onRetry}>Try again</button>}
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />}
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ kind = 'info', children, onClose }) {
  const map = {
    info: ['border-sky-200 bg-sky-50 text-sky-900', Info],
    success: ['border-campus-100 bg-campus-50 text-campus-900', CheckCircle2],
    error: ['border-red-200 bg-red-50 text-red-900', AlertCircle],
    warn: ['border-marigold-100 bg-marigold-50 text-marigold-700', AlertCircle],
  };
  const [cls, Icon] = map[kind];
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm ${cls}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">{children}</div>
      {onClose && <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>}
    </div>
  );
}

// ---------- Form field ----------
export function Field({ label, error, hint, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {child}
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

// ---------- Modal (focus-trapped enough for a form: Esc closes, focus moves in) ----------
export function Modal({ open, title, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Tabs (buttons, URL-agnostic) ----------
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${value === t.value ? 'border-campus-600 text-campus-700' : 'border-transparent text-slate-500 hover:text-ink'}`}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Key/value list for detail pages ----------
export function DetailList({ items }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm font-medium break-words text-ink">{v ?? '–'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- Vertical timeline ----------
export function Timeline({ items }) {
  return (
    <ol className="relative space-y-5 border-l border-slate-200 pl-5">
      {items.map((it, i) => (
        <li key={it.key ?? i} className="relative">
          <span className={`absolute top-1 -left-[25px] h-2.5 w-2.5 rounded-full ring-4 ring-white ${it.active ? 'bg-marigold-500' : 'bg-campus-600'}`} />
          <p className="text-sm font-medium text-ink">{it.title}</p>
          {it.body && <p className="mt-0.5 text-sm text-slate-600">{it.body}</p>}
          {it.time && <p className="mt-0.5 text-xs text-slate-400">{it.time}</p>}
        </li>
      ))}
    </ol>
  );
}

export function Avatar({ name, size = 'md' }) {
  const initials = (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const s = size === 'lg' ? 'h-14 w-14 text-lg' : size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-campus-100 font-semibold text-campus-900 ${s}`}>{initials}</span>;
}

// ---------- Pagination ----------
export function Pagination({ meta, onPage }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>{from}–{to} of {meta.total.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary btn-sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
        <span className="hidden sm:inline">Page {meta.page} of {meta.totalPages}</span>
        <button type="button" className="btn-secondary btn-sm" disabled={!meta.hasNext} onClick={() => onPage(meta.page + 1)}>Next</button>
      </div>
    </div>
  );
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '–');
