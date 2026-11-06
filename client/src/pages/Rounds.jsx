import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Empty, ErrorState, Loading, Notice } from '../components/States';
import StatusBadge from '../components/StatusBadge';

const NEXT = {
  DRAFT: [['PREFERENCES_OPEN', 'Open preferences']],
  ALLOCATED: [['BOOKING_OPEN', 'Open booking'], ['CLOSED', 'Close round']],
  BOOKING_OPEN: [['CLOSED', 'Close round']],
};

export default function Rounds() {
  const rounds = useApi('/rounds');
  const [form, setForm] = useState({ session: '', name: '', feeWindowDays: 7 });
  const [msg, setMsg] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      setMsg({ kind: 'success', text: okText });
      rounds.reload();
      return res;
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const create = (e) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(form.session)) return setMsg({ kind: 'error', text: 'Session must look like 2027-28' });
    return run(() => api.post('/rounds', { ...form, feeWindowDays: Number(form.feeWindowDays) }), 'Round created');
  };

  const runAllocation = async (r) => {
    if (!window.confirm(`Run the priority allocation for ${r.session}? This closes preferences and cannot be undone.`)) return;
    const res = await run(() => api.post(`/rounds/${r.id}/run`), 'Priority allocation complete');
    if (res) setSummary(res.data.data);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Allocation rounds</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {summary && (
        <div className="card">
          <h2 className="mb-2 font-medium">Result for {summary.round.session}</h2>
          <p className="text-sm">{summary.allocated} of {summary.studentsWithPreferences} students allocated · {summary.unallocated} go to open booking</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {Object.entries(summary.allocatedByPreferenceRank).map(([k, v]) => (
              <span key={k} className="rounded bg-slate-100 px-2 py-1">{k === 'hostelFallback' ? 'Hostel fallback' : `Choice ${k}`}: <strong>{v}</strong></span>
            ))}
          </div>
        </div>
      )}

      {rounds.loading && <Loading />}
      {rounds.error && <ErrorState message={rounds.error} onRetry={rounds.reload} />}
      {rounds.data && (rounds.data.data.length === 0 ? <Empty title="No rounds yet" /> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead><tr><th className="th">Session</th><th className="th">Name</th><th className="th">Status</th><th className="th">Fee window</th><th className="th" /></tr></thead>
            <tbody>
              {rounds.data.data.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium">{r.session}</td>
                  <td className="td">{r.name}</td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                  <td className="td">{r.feeWindowDays} days</td>
                  <td className="td space-x-2 text-right whitespace-nowrap">
                    {r.status === 'PREFERENCES_OPEN' && <button type="button" className="btn-primary" disabled={busy} onClick={() => runAllocation(r)}>Run allocation</button>}
                    {(NEXT[r.status] || []).map(([to, label]) => (
                      <button key={to} type="button" className={to === 'CLOSED' ? 'btn-secondary' : 'btn-primary'} disabled={busy}
                        onClick={() => run(() => api.patch(`/rounds/${r.id}/status`, { status: to }), `${label}: done`)}>{label}</button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <form onSubmit={create} className="card grid gap-3 sm:grid-cols-4 sm:items-end" noValidate>
        <label className="text-sm">Session
          <input className="input mt-1" placeholder="2027-28" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} />
        </label>
        <label className="text-sm">Name
          <input className="input mt-1" placeholder="Allocation 2027-28" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="text-sm">Fee window (days)
          <input className="input mt-1" type="number" min="1" max="60" value={form.feeWindowDays} onChange={(e) => setForm({ ...form, feeWindowDays: e.target.value })} />
        </label>
        <button type="submit" className="btn-primary justify-center" disabled={busy}>Create round</button>
      </form>
    </div>
  );
}
