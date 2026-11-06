import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Avatar, Badge, DetailList, ErrorState, Modal, Notice, PageHeader, Panel, Spinner, Timeline, fmtDateTime } from '../components/ui';

const ACTIONS = {
  VERIFIED: { label: 'Verify fee', perm: 'receipt:verify', cls: 'btn-primary' },
  CHECKED_IN: { label: 'Check in', perm: 'allocation:update', cls: 'btn-primary' },
  VACATED: { label: 'Mark vacated', perm: 'allocation:update', cls: 'btn-secondary', confirm: true },
  ALLOCATED: { label: 'Reject receipt', perm: 'receipt:verify', cls: 'btn-secondary', needsNote: true },
  RELEASED: { label: 'Release bed', perm: 'allocation:release', cls: 'btn-danger', confirm: true },
};

export default function AllocationDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const a = useApi(`/allocations/${id}`);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [note, setNote] = useState('');

  if (a.loading) return <Spinner />;
  if (a.error) return <ErrorState message={a.error} onRetry={a.reload} />;
  const d = a.data.data;
  const s = d.student;
  const receipts = [...(d.fee_receipts || [])].sort((x, y) => new Date(y.uploadedAt) - new Date(x.uploadedAt));

  const act = async (status) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.patch(`/allocations/${d.id}/status`, { status, note: note.trim() || undefined });
      setMsg({ kind: 'success', text: `Done: ${ACTIONS[status].label.toLowerCase()}.` });
      setDialog(null);
      setNote('');
      a.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  // Receipts are protected downloads: fetch with the token, open as a blob URL.
  const viewReceipt = async () => {
    try {
      const res = await api.get(`/allocations/${d.id}/receipt`, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data), '_blank', 'noopener');
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  };

  const timeline = [
    { title: `Bed allocated via ${d.source === 'PRIORITY' ? 'priority round' : d.source === 'OPEN_BOOKING' ? 'open booking' : d.source.toLowerCase()}`, time: fmtDateTime(d.createdAt) },
    ...receipts.map((r) => ({ title: 'Fee receipt uploaded', body: `${r.originalName} · ${(r.sizeBytes / 1024).toFixed(0)} KB`, time: fmtDateTime(r.uploadedAt) })),
    ...receipts.filter((r) => r.verifiedAt).map((r) => ({ title: 'Fee verified', time: fmtDateTime(r.verifiedAt) })),
    ...(d.status !== 'ALLOCATED' || receipts.length ? [{ title: `Current status: ${d.status.replaceAll('_', ' ').toLowerCase()}`, time: fmtDateTime(d.updatedAt), active: true }] : []),
  ];
  const available = d.allowedNext.filter((st) => st !== 'FEE_SUBMITTED' && ACTIONS[st] && can(ACTIONS[st].perm));

  return (
    <div>
      <PageHeader
        title={`${d.bed.room.hostel.name} · Room ${d.bed.room.roomNo}-${d.bed.label}`}
        subtitle={`Allocation #${d.id} · session ${d.session}`}
        back={{ to: '/allocations', label: 'Allocations' }}
        actions={<Badge status={d.status} />}
      />
      {msg && <div className="mb-4"><Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Student">
            <div className="flex items-center gap-4">
              <Avatar name={s.user.name} size="lg" />
              <div className="flex-1">
                <Link to={`/students/${s.id}`} className="text-lg font-semibold hover:text-campus-700">{s.user.name}</Link>
                <p className="text-sm text-slate-500">{s.rollNo} · {s.program} year {s.year} · CGPA {s.cgpa}</p>
                <p className="text-sm text-slate-500">{s.user.email}{s.user.phone ? ` · ${s.user.phone}` : ''}</p>
              </div>
            </div>
          </Panel>
          <Panel title="History"><Timeline items={timeline} /></Panel>
        </div>
        <div className="space-y-6">
          {available.length > 0 && (
            <Panel title="Next step">
              <div className="flex flex-wrap gap-2">
                {available.map((st) => (
                  <button key={st} type="button" className={ACTIONS[st].cls} disabled={busy}
                    onClick={() => (ACTIONS[st].confirm || ACTIONS[st].needsNote ? setDialog(st) : act(st))}>
                    {ACTIONS[st].label}
                  </button>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Fee receipt">
            {receipts.length === 0 ? <p className="text-sm text-slate-500">No receipt uploaded yet.</p> : (
              <button type="button" onClick={viewReceipt} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <FileText className="h-8 w-8 text-campus-600" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{receipts[0].originalName}</span>
                  <span className="block text-xs text-slate-500">{fmtDateTime(receipts[0].uploadedAt)} · {receipts[0].verifiedAt ? 'verified' : 'not verified yet'}</span>
                </span>
                <span className="text-sm font-medium text-campus-700">Open</span>
              </button>
            )}
          </Panel>
          <Panel title="Bed">
            <DetailList items={[
              ['Hostel', d.bed.room.hostel.name],
              ['Room', <Link key="r" className="text-campus-700 hover:underline" to={`/rooms/${d.bed.room.id}`}>{d.bed.room.roomNo}</Link>],
              ['Bed', d.bed.label],
              ['Floor', d.bed.room.floor === 0 ? 'Ground' : d.bed.room.floor],
              ['Fee deadline', d.status === 'ALLOCATED' ? fmtDateTime(d.feeDueAt) : '–'],
              ['Source', d.source.replace('_', ' ').toLowerCase()],
            ]} />
          </Panel>
        </div>
      </div>
      <Modal
        open={!!dialog}
        title={dialog ? ACTIONS[dialog].label : ''}
        onClose={() => setDialog(null)}
        footer={<><button type="button" className="btn-secondary" onClick={() => setDialog(null)}>Cancel</button><button type="button" className={dialog === 'RELEASED' ? 'btn-danger' : 'btn-primary'} disabled={busy || (dialog === 'ALLOCATED' && !note.trim())} onClick={() => act(dialog)}>{dialog ? ACTIONS[dialog].label : ''}</button></>}
      >
        {dialog === 'ALLOCATED' ? (
          <>
            <label htmlFor="reason" className="text-sm text-slate-600">Tell the student what's wrong with the receipt</label>
            <textarea id="reason" className="input mt-1 min-h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Amount doesn't match the hostel fee" />
            <p className="mt-2 text-xs text-slate-500">The student gets 3 more days to upload a valid one.</p>
          </>
        ) : (
          <p className="text-sm text-slate-600">{dialog === 'RELEASED' ? `${s.user.name} loses bed ${d.bed.label} in room ${d.bed.room.roomNo}, and it becomes free for others.` : `${s.user.name} moves out and the bed becomes free.`}</p>
        )}
      </Modal>
    </div>
  );
}
