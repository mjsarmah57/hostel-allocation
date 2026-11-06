import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Badge, ErrorState, Field, Modal, Notice, PageHeader, Panel, Spinner, fmtDate } from '../components/ui';

// The round lifecycle is a real sequence, so it's drawn as numbered steps.
const STAGES = [
  ['DRAFT', 'Draft'],
  ['PREFERENCES_OPEN', 'Preferences open'],
  ['ALLOCATED', 'Priority round run'],
  ['BOOKING_OPEN', 'Open booking'],
  ['CLOSED', 'Closed'],
];

export default function Rounds() {
  const rounds = useApi('/rounds');
  const [msg, setMsg] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ session: '', name: '', feeWindowDays: 7 });

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
      setConfirm(null);
    }
  };

  if (rounds.loading) return <Spinner />;
  if (rounds.error) return <ErrorState message={rounds.error} onRetry={rounds.reload} />;
  const list = rounds.data.data;
  const current = list.find((r) => r.status !== 'CLOSED');
  const past = list.filter((r) => r !== current);
  const at = current ? STAGES.findIndex(([s]) => s === current.status) : -1;

  const actions = current && {
    DRAFT: [['open-prefs', 'Open preferences', 'btn-primary']],
    PREFERENCES_OPEN: [['run', 'Run priority allocation', 'btn-primary']],
    ALLOCATED: [['open-booking', 'Open booking', 'btn-primary'], ['close', 'Close round', 'btn-secondary']],
    BOOKING_OPEN: [['close', 'Close round', 'btn-secondary']],
  }[current.status];

  const doAction = async (key) => {
    if (key === 'run') {
      const res = await run(() => api.post(`/rounds/${current.id}/run`), 'Priority allocation complete.');
      if (res) setSummary(res.data.data);
      return;
    }
    const to = { 'open-prefs': 'PREFERENCES_OPEN', 'open-booking': 'BOOKING_OPEN', close: 'CLOSED' }[key];
    await run(() => api.patch(`/rounds/${current.id}/status`, { status: to }), `Round moved to ${to.replaceAll('_', ' ').toLowerCase()}.`);
  };

  const create = async () => {
    if (!/^\d{4}-\d{2}$/.test(form.session)) return setMsg({ kind: 'error', text: 'Session must look like 2027-28.' });
    const res = await run(() => api.post('/rounds', { ...form, name: form.name || `Allocation ${form.session}`, feeWindowDays: Number(form.feeWindowDays) }), 'Round created.');
    if (res) setCreating(false);
    return undefined;
  };

  const releaseNow = () => run(async () => {
    const { data } = await api.post('/admin/jobs/release-unpaid');
    setMsg({ kind: 'success', text: `Released ${data.data.releasedCount} unpaid allocation(s).` });
  }, 'Release job finished.');

  return (
    <div className="space-y-6">
      <PageHeader title="Allocation rounds" subtitle="One round per session: preferences, the priority run, open booking, then close." actions={!current && <button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />New round</button>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      {current ? (
        <Panel bodyClass="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-sm text-slate-500">Current round</p><p className="text-2xl font-bold">{current.name}</p><p className="text-sm text-slate-500">Fee window {current.feeWindowDays} days</p></div>
            <div className="flex flex-wrap gap-2">{actions?.map(([k, label, cls]) => <button key={k} type="button" className={cls} disabled={busy} onClick={() => (k === 'run' || k === 'close' ? setConfirm(k) : doAction(k))}>{label}</button>)}</div>
          </div>
          <ol className="mt-6 grid grid-cols-5 gap-2">
            {STAGES.map(([s, label], i) => (
              <li key={s}>
                <span className={`block h-1.5 rounded-full ${i < at ? 'bg-campus-600' : i === at ? 'bg-marigold-500' : 'bg-slate-200'}`} />
                <span className={`mt-2 flex items-center gap-1 text-xs ${i < at ? 'text-campus-700' : i === at ? 'font-semibold text-ink' : 'text-slate-400'}`}>
                  {i < at ? <Check className="h-3 w-3" aria-hidden="true" /> : <span className="tabular-nums">{i + 1}.</span>}{label}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : <Notice>No round is open. Create one for the next session.</Notice>}

      {summary && (
        <Panel title={`Priority run result · ${summary.round.session}`}>
          <p className="text-sm"><strong className="text-2xl">{summary.allocated.toLocaleString()}</strong> of {summary.studentsWithPreferences.toLocaleString()} students got a bed; {summary.unallocated.toLocaleString()} move to open booking.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {Object.entries(summary.allocatedByPreferenceRank).map(([k, v]) => <span key={k} className="rounded-md bg-slate-100 px-2 py-1">{k === 'hostelFallback' ? 'Hostel fallback' : `Choice ${k}`}: <strong>{v}</strong></span>)}
          </div>
        </Panel>
      )}

      <Panel title="Unpaid allocations" action={<button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={releaseNow}>Release unpaid now</button>}>
        <p className="text-sm text-slate-600">Every hour, beds whose fee deadline has passed without a receipt are released automatically. Run it now to free them immediately.</p>
      </Panel>

      <Panel title="Past rounds" bodyClass="p-0">
        <table className="w-full">
          <thead><tr><th className="th">Session</th><th className="th">Name</th><th className="th">Status</th><th className="th">Allocated on</th></tr></thead>
          <tbody>{past.map((r) => <tr key={r.id}><td className="td font-medium">{r.session}</td><td className="td">{r.name}</td><td className="td"><Badge status={r.status} /></td><td className="td text-slate-500">{fmtDate(r.allocatedAt)}</td></tr>)}</tbody>
        </table>
      </Panel>

      <Modal open={!!confirm} title={confirm === 'run' ? 'Run the priority allocation?' : 'Close this round?'} onClose={() => setConfirm(null)}
        footer={<><button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={() => doAction(confirm)}>{confirm === 'run' ? 'Run allocation' : 'Close round'}</button></>}>
        <p className="text-sm text-slate-600">{confirm === 'run' ? 'Preferences close and every student with preferences is placed by priority. This cannot be undone.' : 'No more bookings or changes for this session. You can then create the next round.'}</p>
      </Modal>
      <Modal open={creating} title="New round" onClose={() => setCreating(false)} footer={<><button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={create}>Create round</button></>}>
        <div className="space-y-4">
          <Field label="Session" hint="Format 2027-28">{(id) => <input id={id} className="input" placeholder="2027-28" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} />}</Field>
          <Field label="Name">{(id) => <input id={id} className="input" placeholder={`Allocation ${form.session || '2027-28'}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Days to pay the fee">{(id) => <input id={id} className="input" type="number" min="1" max="60" value={form.feeWindowDays} onChange={(e) => setForm({ ...form, feeWindowDays: e.target.value })} />}</Field>
        </div>
      </Modal>
    </div>
  );
}
