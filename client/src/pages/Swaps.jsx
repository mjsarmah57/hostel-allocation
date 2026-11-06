import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, ErrorState, Notice, PageHeader, Panel, Spinner, fmtDate } from '../components/ui';

export default function Swaps() {
  const { user } = useAuth();
  const swaps = useApi('/swaps');
  const [roll, setRoll] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, success) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'success', text: success });
      swaps.reload();
      return true;
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const request = async (e) => {
    e.preventDefault();
    if (!roll.trim()) return setMsg({ kind: 'error', text: 'Enter the roll number of the student you want to swap with.' });
    if (await run(() => api.post('/swaps', { targetRollNo: roll.trim().toUpperCase() }), 'Swap requested. The other student accepts, then the warden approves.')) setRoll('');
    return undefined;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Room swaps" subtitle="Both students agree, the warden approves, and both moves happen together." />
      <Panel>
        <form onSubmit={request} className="flex flex-wrap items-end gap-3" noValidate>
          <label className="text-sm text-slate-600">Swap with roll number
            <input className="input mt-1 w-56 uppercase" placeholder="HR00002" value={roll} onChange={(e) => setRoll(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>Request swap</button>
        </form>
      </Panel>
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <Panel title="Your swap requests" bodyClass="p-0">
        {swaps.loading && <div className="px-5"><Spinner /></div>}
        {swaps.error && <div className="p-4"><ErrorState message={swaps.error} onRetry={swaps.reload} /></div>}
        {swaps.data && (swaps.data.data.length === 0 ? <Empty icon={Repeat} title="No swap requests yet" /> : (
          <ul className="divide-y divide-slate-100">
            {swaps.data.data.map((s) => {
              const iAmTarget = s.targetStudentId === user.studentId;
              const iAmRequester = s.requesterStudentId === user.studentId;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="flex-1 text-sm">
                    <p><strong>{s.requesterRollNo}</strong> {s.requesterHostel} {s.requesterRoom}-{s.requesterBed}
                      <Repeat className="mx-2 inline h-3.5 w-3.5 text-slate-400" aria-label="swaps with" />
                      <strong>{s.targetRollNo}</strong> {s.targetHostel} {s.targetRoom}-{s.targetBed}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{iAmRequester ? 'You asked' : 'You were asked'} on {fmtDate(s.createdAt)}</p>
                  </div>
                  <Badge status={s.status} />
                  <div className="flex gap-2">
                    {iAmTarget && s.status === 'PENDING_PEER' && (
                      <>
                        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.patch(`/swaps/${s.id}/respond`, { accept: true }), 'Accepted. Waiting for warden approval.')}>Accept</button>
                        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run(() => api.patch(`/swaps/${s.id}/respond`, { accept: false }), 'Declined.')}>Decline</button>
                      </>
                    )}
                    {iAmRequester && ['PENDING_PEER', 'PENDING_WARDEN'].includes(s.status) && (
                      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run(() => api.patch(`/swaps/${s.id}/cancel`), 'Swap cancelled.')}>Cancel</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
      </Panel>
    </div>
  );
}
