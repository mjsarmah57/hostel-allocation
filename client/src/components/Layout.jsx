import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BedDouble, Building2, CalendarRange, ClipboardList, Gauge, Home, ListOrdered, LogOut, Menu, MessageSquareWarning,
  Repeat, ShieldCheck, Ticket, UserCog, Users, X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './ui';
import { useApi } from '../hooks/useApi';

// Navigation is derived from PERMISSIONS. Hiding a link is a convenience, not security:
// the API enforces every permission on its own.
const SECTIONS = [
  {
    label: 'My hostel',
    links: [
      { to: '/me', label: 'My room', icon: Home, perm: 'allocation:read_own' },
      { to: '/preferences', label: 'Preferences', icon: ListOrdered, perm: 'preference:submit' },
      { to: '/book', label: 'Open booking', icon: Ticket, perm: 'booking:create' },
      { to: '/swaps', label: 'Room swaps', icon: Repeat, perm: 'swap:create' },
      { to: '/complaints', label: 'Complaints', icon: MessageSquareWarning, perm: 'complaint:create' },
    ],
  },
  {
    label: 'Overview',
    links: [{ to: '/dashboard', label: 'Dashboard', icon: Gauge, perm: 'dashboard:read' }],
  },
  {
    label: 'Manage',
    links: [
      { to: '/allocations', label: 'Allocations', icon: BedDouble, perm: 'allocation:read' },
      { to: '/students', label: 'Students', icon: Users, perm: 'student:read' },
      { to: '/hostels', label: 'Hostels & rooms', icon: Building2, perm: 'hostel:read', hideFor: 'allocation:read_own' },
      { to: '/complaints', label: 'Complaints', icon: MessageSquareWarning, perm: 'complaint:manage' },
      { to: '/swap-approvals', label: 'Swap approvals', icon: Repeat, perm: 'swap:approve' },
    ],
  },
  {
    label: 'Administration',
    links: [
      { to: '/rounds', label: 'Allocation rounds', icon: CalendarRange, perm: 'round:manage' },
      { to: '/users', label: 'Users & registrations', icon: UserCog, perm: 'user:manage', badge: 'pending' },
    ],
  },
];

function Sidebar({ onNavigate }) {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Re-checked on every navigation so the badge drops as soon as registrations are handled.
  const pending = useApi(can('user:manage') ? `/users?status=PENDING&limit=1&at=${encodeURIComponent(pathname)}` : null);
  const pendingCount = pending.data?.meta?.total || 0;

  return (
    <div className="flex h-full flex-col bg-campus-900 text-campus-100">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-marigold-500 text-campus-900"><BedDouble className="h-5 w-5" aria-hidden="true" /></span>
        <span className="leading-tight">
          <span className="block font-bold text-white">Hostel Allocation</span>
          <span className="block text-xs text-campus-100/70">Housing office</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {SECTIONS.map((sec) => {
          const links = sec.links.filter((l) => can(l.perm) && !(l.hideFor && can(l.hideFor)));
          if (!links.length) return null;
          return (
            <div key={sec.label}>
              <p className="px-3 pb-1.5 text-xs font-medium text-campus-100/50">{sec.label}</p>
              {links.map((l) => (
                <NavLink
                  key={l.to + l.label}
                  to={l.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/10 text-white' : 'text-campus-100/80 hover:bg-white/5 hover:text-white'}`
                  }
                >
                  <l.icon className="h-4 w-4" aria-hidden="true" />
                  <span className="flex-1">{l.label}</span>
                  {l.badge === 'pending' && pendingCount > 0 && (
                    <span className="rounded-full bg-marigold-500 px-1.5 text-xs font-semibold text-campus-900">{pendingCount}</span>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <NavLink to="/profile" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
          <Avatar name={user.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">{user.name}</span>
            <span className="flex items-center gap-1 text-xs text-campus-100/60"><ShieldCheck className="h-3 w-3" aria-hidden="true" />{user.role}</span>
          </span>
        </NavLink>
        <button type="button" onClick={async () => { await logout(); navigate('/login'); }} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-campus-100/80 hover:bg-white/5 hover:text-white">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72"><Sidebar onNavigate={() => setOpen(false)} /></aside>
          <button type="button" className="absolute top-4 left-[19rem] text-white" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-6 w-6" /></button>
        </div>
      )}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <span className="font-bold">Hostel Allocation</span>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        {user.mustChangePassword && location.pathname !== '/profile' && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-marigold-100 bg-marigold-50 px-4 py-3 text-sm text-marigold-700">
            <span><ClipboardList className="mr-2 inline h-4 w-4" aria-hidden="true" />You're using a temporary password. Set your own before continuing.</span>
            <Link to="/profile" className="btn-secondary btn-sm">Change password</Link>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
