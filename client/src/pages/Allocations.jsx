import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BedDouble } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, ErrorState, PageHeader, Pagination, Spinner, Tabs, fmtDate } from '../components/ui';

const STATUSES = ['ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN', 'RELEASED', 'VACATED', 'SWAPPED'];

export default function Allocations() {
  const { can } = useAuth();
  const isAdmin = can('hostel:all');
  const [params] = useSearchParams();
  const hostels = useApi(isAdmin ? '/hostels' : null);
  const [status, setStatus] = useState(params.get('status') || '');
  const [hostelId, setHostelId] = useState('');
  const [sort, setSort] = useState('-createdAt');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  const qs = new URLSearchParams({ page, limit: 20, sort });
  if (status) qs.set('status', status);
  if (hostelId) qs.set('hostelId', hostelId);
  if (q) qs.set('q', q);
  const list = useApi(`/allocations?${qs}`);

  return (
    <div>
      <PageHeader title="Allocations" subtitle={list.data ? `Session ${list.data.session}. Open a row to verify fees, check students in, or see its history.` : undefined} />
      <Tabs
        value={status}
        onChange={(v) => { setStatus(v); setPage(1); }}
        tabs={[{ value: '', label: 'All' }, ...STATUSES.slice(0, 4).map((s) => ({ value: s, label: { ALLOCATED: 'Awaiting fee', FEE_SUBMITTED: 'To verify', VERIFIED: 'Verified', CHECKED_IN: 'Checked in' }[s] })), { value: 'RELEASED', label: 'Released' }]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <input className="input" placeholder="Search roll number or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        {isAdmin && (
          <select className="input" value={hostelId} onChange={(e) => { setHostelId(e.target.value); setPage(1); }} aria-label="Hostel">
            <option value="">All hostels</option>
            {hostels.data?.data.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
        <select className="input" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="Sort">
          <option value="-createdAt">Newest first</option>
          <option value="createdAt">Oldest first</option>
          <option value="rollNo">Roll number</option>
          <option value="roomNo">Room number</option>
          <option value="feeDueAt">Fee deadline (soonest)</option>
        </select>
      </div>
      <div className="panel overflow-hidden">
        {list.loading && <div className="px-5"><Spinner /></div>}
        {list.error && <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>}
        {list.data && (list.data.data.length === 0 ? <Empty icon={BedDouble} title="No allocations match these filters" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className="th">Student</th><th className="th">Hostel / room</th><th className="th">Status</th><th className="th">Fee due</th><th className="th">Receipt</th><th className="th">Allocated</th></tr></thead>
                <tbody>
                  {list.data.data.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="td"><Link to={`/allocations/${a.id}`} className="font-semibold text-ink hover:text-campus-700">{a.studentName}</Link><span className="block text-xs text-slate-500">{a.rollNo} · year {a.year}</span></td>
                      <td className="td">{a.hostelName}<span className="block text-xs text-slate-500">Room {a.roomNo} · bed {a.bedLabel}</span></td>
                      <td className="td"><Badge status={a.status} /></td>
                      <td className="td text-slate-600">{a.status === 'ALLOCATED' && a.feeDueAt ? fmtDate(a.feeDueAt) : '–'}</td>
                      <td className="td text-slate-600">{a.hasReceipt ? 'Uploaded' : '–'}</td>
                      <td className="td text-slate-500">{fmtDate(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={list.data.meta} onPage={setPage} />
          </>
        ))}
      </div>
    </div>
  );
}
