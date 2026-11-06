import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, ErrorState, Notice, PageHeader, Panel, Spinner, fmtDate } from '../components/ui';

export default function RoomDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const r = useApi(`/rooms/${id}`);
  const [capacity, setCapacity] = useState('');
  const [msg, setMsg] = useState(null);
  if (r.loading) return <Spinner />;
  if (r.error) return <ErrorState message={r.error} onRetry={r.reload} />;
  const d = r.data.data;
  const staff = can('student:read');

  const saveCapacity = async () => {
    setMsg(null);
    try {
      await api.patch(`/rooms/${d.id}`, { capacity: Number(capacity) });
      setMsg({ kind: 'success', text: `Room now has ${capacity} bed${capacity === '1' ? '' : 's'}.` });
      setCapacity('');
      r.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={`Room ${d.roomNo}`} subtitle={`${d.hostel.name} · ${d.floor === 0 ? 'ground floor' : `floor ${d.floor}`} · ${d.occupied} of ${d.capacity} beds taken`} back={{ to: `/hostels/${d.hostel.id}`, label: d.hostel.name }} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {d.beds.map((b) => (
          <div key={b.id} className={`panel p-5 ${b.allocationId ? '' : 'border-dashed'}`}>
            <div className="flex items-center justify-between"><p className="text-3xl font-bold">{b.label}</p>{b.status ? <Badge status={b.status} /> : <span className="text-sm text-slate-400">Free</span>}</div>
            {staff && b.studentId && (
              <Link to={`/students/${b.studentId}`} className="mt-3 block hover:text-campus-700"><span className="font-semibold">{b.studentName}</span><span className="block text-sm text-slate-500">{b.rollNo} · {b.program} year {b.year}</span></Link>
            )}
            {staff && b.allocationId && <Link to={`/allocations/${b.allocationId}`} className="mt-2 inline-block text-sm text-campus-700 hover:underline">Open allocation</Link>}
          </div>
        ))}
      </div>
      {can('hostel:manage') && (
        <Panel title="Capacity">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-600">Beds in this room
              <select className="input mt-1 w-32" value={capacity || d.capacity} onChange={(e) => setCapacity(e.target.value)}>{[1, 2, 3, 4, 5, 6].map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </label>
            <button type="button" className="btn-primary" disabled={!capacity || Number(capacity) === d.capacity} onClick={saveCapacity}>Save</button>
            <p className="text-xs text-slate-500">Beds with any allocation history can't be removed.</p>
          </div>
        </Panel>
      )}
      {staff && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Who lived here" bodyClass="p-0">
            {d.history.length === 0 ? <Empty title="No history" /> : (
              <ul className="divide-y divide-slate-100">{d.history.map((h) => (
                <li key={h.id}><Link to={`/allocations/${h.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"><span className="flex-1 text-sm"><span className="font-medium">{h.studentName}</span> <span className="text-slate-500">{h.rollNo}</span><span className="block text-xs text-slate-500">{h.session} · bed {h.bedLabel}</span></span><Badge status={h.status} /></Link></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Complaints" bodyClass="p-0">
            {d.complaints.length === 0 ? <Empty title="No complaints for this room" /> : (
              <ul className="divide-y divide-slate-100">{d.complaints.map((c) => (
                <li key={c.id}><Link to={`/complaints/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"><span className="flex-1 text-sm"><span className="font-medium">{c.title}</span><span className="block text-xs text-slate-500">{fmtDate(c.createdAt)}</span></span><Badge status={c.status} /></Link></li>
              ))}</ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
