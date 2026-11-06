import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Empty, ErrorState, Loading, Notice } from '../components/States';
import StatusBadge from '../components/StatusBadge';

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
      setMsg({ kind: 'success', text: approve ? 'Swap approved: both students moved in one transaction.' : 'Swap rejected.' });
      swaps.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Swap approvals</h1>
        <select className="input w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING_WARDEN">Awaiting approval</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {swaps.loading && <Loading />}
      {swaps.error && <ErrorState message={swaps.error} onRetry={swaps.reload} />}
      {swaps.data && (swaps.data.data.length === 0 ? <Empty title="Nothing here" hint="Swaps appear once both students have agreed." /> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead><tr><th className="th">Student A</th><th className="th">Student B</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>
              {swaps.data.data.map((s) => (
                <tr key={s.id}>
                  <td className="td">{s.requesterName} ({s.requesterRollNo})<br /><span className="text-slate-500">{s.requesterHostel} {s.requesterRoom}-{s.requesterBed}</span></td>
                  <td className="td">{s.targetName} ({s.targetRollNo})<br /><span className="text-slate-500">{s.targetHostel} {s.targetRoom}-{s.targetBed}</span></td>
                  <td className="td"><StatusBadge status={s.status} /></td>
                  <td className="td space-x-2 text-right whitespace-nowrap">
                    {s.status === 'PENDING_WARDEN' && (
                      <>
                        <button type="button" className="btn-primary" disabled={busy === s.id} onClick={() => decide(s.id, true)}>Approve</button>
                        <button type="button" className="btn-secondary" disabled={busy === s.id} onClick={() => decide(s.id, false)}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
