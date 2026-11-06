import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// Navigation is derived from permissions. Hiding a link is a CONVENIENCE,
// not security: the server enforces every permission independently.
const LINKS = [
  { to: '/me', label: 'My room', perm: 'allocation:read_own' },
  { to: '/preferences', label: 'Preferences', perm: 'preference:submit' },
  { to: '/book', label: 'Open booking', perm: 'booking:create' },
  { to: '/swaps', label: 'Swaps', perm: 'swap:create' },
  { to: '/allocations', label: 'Allocations', perm: 'allocation:read' },
  { to: '/swap-approvals', label: 'Swap approvals', perm: 'swap:approve' },
  { to: '/rounds', label: 'Rounds', perm: 'round:manage' },
  { to: '/occupancy', label: 'Occupancy', perm: 'report:read' },
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold text-indigo-700">Hostel Allocation</span>
          <nav className="flex flex-wrap gap-1">
            {LINKS.filter((l) => can(l.perm)).map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-600">{user.name} <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{user.role}</span></span>
            <button type="button" className="btn-secondary" onClick={async () => { await logout(); navigate('/login'); }}>
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
