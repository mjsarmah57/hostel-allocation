import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorState, Loading, Notice } from '../components/States';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';

const ACTION_LABELS = {
  VERIFIED: 'Verify fee', ALLOCATED: 'Reject receipt', CHECKED_IN: 'Check in', VACATED: 'Vacate', RELEASED: 'Release',
};
const ACTION_PERMS = { VERIFIED: 'receipt:verify', ALLOCATED: 'receipt:verify', CHECKED_IN: 'allocation:update', VACATED: 'allocation:update', RELEASED: 'allocation:release' };

export default function Allocations() {
  const { can } = useAuth();
  const isAdmin = can('hostel:all');
  const hostels = useApi(isAdmin ? '/hostels' : null);
  const [filters, setFilters] = useState({ status: '', hostelId: '', q: '', sort: '-createdAt' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setFilters((f) => ({ ...f, q: search })); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ page, limit: 20, sort: filters.sort });
  if (filters.status) params.set('status', filters.status);
  if (filters.hostelId) params.set('hostelId', filters.hostelId);
  if (filters.q) params.set('q', filters.q);
  const list = useApi(`/allocations?${params}`);
  const set = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };

  const act = async (row, status) => {
    let note;
    if (status === 'ALLOCATED') {
      note = window.prompt('Reason for rejecting this receipt?') || undefined;
      if (note === undefined) return;
    }
    if (['RELEASED', 'VACATED'].includes(status) && !window.confirm(`${ACTION_LABELS[status]} ${row.rollNo}? This frees the bed.`)) return;
    setBusy(row.id);
    setMsg(null);
    try {
      await api.patch(`/allocations/${row.id}/status`, { status, note });
      setMsg({ kind: 'success', text: `${row.rollNo}: ${ACTION_LABELS[status].toLowerCase()} done.` });
      list.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  // Receipts are protected downloads, so fetch with the token and open a blob URL.
  const viewReceipt = async (row) => {
    try {
      const res = await api.get(`/allocations/${row.id}/receipt`, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data), '_blank', 'noopener');
    } catch (err) {
      setMsg({ kind: 'error', text: err.response?.status === 404 ? 'No receipt uploaded' : errorMessage(err) });
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Allocations {list.data && <span className="text-base font-normal text-slate-500">· {list.data.session}</span>}</h1>
      <div className="card grid gap-3 sm:grid-cols-4">
        <label className="text-sm">Search
          <input className="input mt-1" placeholder="Roll no. or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="text-sm">Status
          <select className="input mt-1" value={filters.status} onChange={set('status')}>
            <option value="">All</option>
            {['ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN', 'VACATED', 'RELEASED', 'SWAPPED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
          </select>
        </label>
        {isAdmin && (
          <label className="text-sm">Hostel
            <select className="input mt-1" value={filters.hostelId} onChange={set('hostelId')}>
              <option value="">All hostels</option>
              {hostels.data?.data.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">Sort
          <select className="input mt-1" value={filters.sort} onChange={set('sort')}>
            <option value="-createdAt">Newest first</option>
            <option value="createdAt">Oldest first</option>
            <option value="rollNo">Roll number</option>
            <option value="roomNo">Room</option>
            <option value="feeDueAt">Fee deadline</option>
          </select>
        </label>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {list.loading && <Loading />}
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.data && (list.data.data.length === 0 ? <Empty title="No allocations match these filters" /> : (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead><tr><th className="th">Student</th><th className="th">Hostel / room</th><th className="th">Status</th><th className="th">Fee due</th><th className="th" /></tr></thead>
              <tbody>
                {list.data.data.map((a) => (
                  <tr key={a.id}>
                    <td className="td">{a.studentName}<br /><span className="text-slate-500">{a.rollNo} · year {a.year}</span></td>
                    <td className="td">{a.hostelName}<br /><span className="text-slate-500">Room {a.roomNo} · bed {a.bedLabel}</span></td>
                    <td className="td"><StatusBadge status={a.status} /></td>
                    <td className="td">{a.status === 'ALLOCATED' && a.feeDueAt ? new Date(a.feeDueAt).toLocaleDateString() : '–'}</td>
                    <td className="td space-x-1 text-right whitespace-nowrap">
                      {a.hasReceipt && <button type="button" className="btn-secondary" onClick={() => viewReceipt(a)}>Receipt</button>}
                      {a.allowedNext.filter((s) => s !== 'FEE_SUBMITTED' && can(ACTION_PERMS[s])).map((s) => (
                        <button key={s} type="button" className={s === 'RELEASED' || s === 'ALLOCATED' ? 'btn-secondary' : 'btn-primary'} disabled={busy === a.id} onClick={() => act(a, s)}>
                          {ACTION_LABELS[s]}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      ))}
    </div>
  );
}
