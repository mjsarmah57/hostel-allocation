import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Badge, DetailList, ErrorState, Notice, PageHeader, Panel, Spinner, Timeline, fmtDateTime, humanize } from '../components/ui';

const ACTION = {
  IN_PROGRESS: ['Start work', 'btn-primary'],
  RESOLVED: ['Mark resolved', 'btn-primary'],
  CLOSED: ['Confirm fixed and close', 'btn-primary'],
  OPEN: ['Reopen', 'btn-secondary'],
};

export default function ComplaintDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const staff = can('complaint:manage');
  const c = useApi(`/complaints/${id}`);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  if (c.loading) return <Spinner />;
  if (c.error) return <ErrorState message={c.error} onRetry={c.reload} />;
  const d = c.data.data;

  const move = async (status) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.patch(`/complaints/${d.id}/status`, { status, note: note.trim() || undefined });
      setNote('');
      setMsg({ kind: 'success', text: `Complaint ${humanize(status).toLowerCase()}.` });
      c.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={d.title} back={{ to: '/complaints', label: 'Complaints' }} subtitle={`${humanize(d.category)} · reported ${fmtDateTime(d.createdAt)}`} actions={<><Badge status={d.priority}>{humanize(d.priority)} urgency</Badge><Badge status={d.status} /></>} />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Description"><p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">{d.description}</p></Panel>
          <Panel title="Progress">
            <Timeline items={d.events.map((e, i) => ({
              key: e.id,
              title: `${humanize(e.toStatus)}${e.note ? `: ${e.note}` : ''}`,
              body: `${e.actorName} (${e.actorRole})`,
              time: fmtDateTime(e.createdAt),
              active: i === d.events.length - 1 && d.status !== 'CLOSED',
            }))} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Details">
            <DetailList items={[
              ['Hostel', d.hostelName],
              ['Room', staff ? <Link className="text-campus-700 hover:underline" to={`/rooms/${d.roomId}`}>{d.roomNo}</Link> : d.roomNo],
              staff && ['Student', <Link key="s" className="text-campus-700 hover:underline" to={`/students/${d.studentId}`}>{d.studentName}</Link>],
              staff && ['Roll number', d.rollNo],
              staff && ['Phone', d.studentPhone],
              ['Resolved', d.resolvedAt ? fmtDateTime(d.resolvedAt) : null],
            ]} />
          </Panel>
          {d.allowedNext.length > 0 && (
            <Panel title={staff ? 'Update status' : 'Your action'}>
              <label className="text-sm text-slate-600" htmlFor="note">Note (optional)</label>
              <textarea id="note" className="input mt-1 min-h-20" maxLength={500} placeholder={staff ? 'Electrician assigned for 4 pm' : 'Still not working'} value={note} onChange={(e) => setNote(e.target.value)} />
              {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
              <div className="mt-3 flex flex-wrap gap-2">
                {d.allowedNext.map((s) => <button key={s} type="button" className={ACTION[s][1]} disabled={busy} onClick={() => move(s)}>{ACTION[s][0]}</button>)}
              </div>
            </Panel>
          )}
          {msg && d.allowedNext.length === 0 && <Notice kind={msg.kind}>{msg.text}</Notice>}
        </div>
      </div>
    </div>
  );
}
