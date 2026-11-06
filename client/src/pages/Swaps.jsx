import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorState, Loading, Notice } from '../components/States';
import StatusBadge from '../components/StatusBadge';

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
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const request = (e) => {
    e.preventDefault();
    if (!roll.trim()) return setMsg({ kind: 'error', text: 'Enter the roll number of the student you want to swap with' });
    return run(() => api.post('/swaps', { targetRollNo: roll.trim().toUpperCase() }), 'Swap requested. The other student must accept, then the warden approves.').then(() => setRoll(''));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Room swaps</h1>
      <form onSubmit={request} className="card flex flex-wrap items-end gap-3" noValidate>
        <label className="text-sm">Swap with roll number
          <input className="input mt-1 w-56" placeholder="e.g. HR00002" value={roll} onChange={(e) => setRoll(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>Request swap</button>
      </form>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {swaps.loading && <Loading />}
      {swaps.error && <ErrorState message={swaps.error} onRetry={swaps.reload} />}
      {swaps.data && (swaps.data.data.length === 0 ? <Empty title="No swap requests yet" /> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead><tr><th className="th">From</th><th className="th">To</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>
              {swaps.data.data.map((s) => {
                const iAmTarget = s.targetStudentId === user.studentId;
                const iAmRequester = s.requesterStudentId === user.studentId;
                return (
                  <tr key={s.id}>
                    <td className="td">{s.requesterRollNo} · {s.requesterHostel} {s.requesterRoom}-{s.requesterBed}</td>
                    <td className="td">{s.targetRollNo} · {s.targetHostel} {s.targetRoom}-{s.targetBed}</td>
                    <td className="td"><StatusBadge status={s.status} /></td>
                    <td className="td space-x-2 text-right whitespace-nowrap">
                      {iAmTarget && s.status === 'PENDING_PEER' && (
                        <>
                          <button type="button" className="btn-primary" disabled={busy} onClick={() => run(() => api.patch(`/swaps/${s.id}/respond`, { accept: true }), 'Accepted. Waiting for warden approval.')}>Accept</button>
                          <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(() => api.patch(`/swaps/${s.id}/respond`, { accept: false }), 'Declined.')}>Decline</button>
                        </>
                      )}
                      {iAmRequester && ['PENDING_PEER', 'PENDING_WARDEN'].includes(s.status) && (
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(() => api.patch(`/swaps/${s.id}/cancel`), 'Swap cancelled.')}>Cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
