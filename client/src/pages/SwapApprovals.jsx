import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Repeat } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Badge, Empty, ErrorState, Notice, PageHeader, Spinner, Tabs, fmtDate } from '../components/ui';

function Side({ name, roll, studentId, hostel, room, bed }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-4 py-3">
      <Link to={`/students/${studentId}`} className="block truncate font-semibold hover:text-campus-700">{name}</Link>
      <p className="text-xs text-slate-500">{roll}</p>
      <p className="mt-1 text-sm">{hostel} · {room}-{bed}</p>
    </div>
  );
}

export default function SwapApprovals() {
  const [status, setStatus] = useState('PENDING_WARDEN');
  const swaps = useApi(`/swaps${status ? `?status=${status}` : ''}`);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);

  const decide = async (id, approve) => {
    setBusy(id);
    setMsg(null);
    try {
      await api.patch(`/swaps/${id}/decision`, { approve });
      setMsg({ kind: 'success', text: approve ? 'Swap approved. Both students moved together.' : 'Swap rejected.' });
      swaps.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title="Swap approvals" subtitle="Swaps appear here once both students have agreed." />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'PENDING_WARDEN', label: 'Waiting for you' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }, { value: '', label: 'All' }]} />
      {msg && <div className="mb-4"><Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice></div>}
      {swaps.loading && <Spinner />}
      {swaps.error && <ErrorState message={swaps.error} onRetry={swaps.reload} />}
      {swaps.data && (swaps.data.data.length === 0 ? <div className="panel"><Empty icon={Repeat} title="Nothing here" /></div> : (
        <ul className="space-y-3">
          {swaps.data.data.map((s) => (
            <li key={s.id} className="panel p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span>Requested {fmtDate(s.createdAt)}</span><Badge status={s.status} /></div>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <Side name={s.requesterName} roll={s.requesterRollNo} studentId={s.requesterStudentId} hostel={s.requesterHostel} room={s.requesterRoom} bed={s.requesterBed} />
                <Repeat className="h-5 w-5 shrink-0 self-center text-slate-400" aria-label="swaps with" />
                <Side name={s.targetName} roll={s.targetRollNo} studentId={s.targetStudentId} hostel={s.targetHostel} room={s.targetRoom} bed={s.targetBed} />
              </div>
              {s.status === 'PENDING_WARDEN' && (
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" className="btn-secondary btn-sm" disabled={busy === s.id} onClick={() => decide(s.id, false)}>Reject</button>
                  <button type="button" className="btn-primary btn-sm" disabled={busy === s.id} onClick={() => decide(s.id, true)}>Approve swap</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
