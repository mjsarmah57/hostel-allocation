import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, FileUp, MessageSquareWarning, Repeat, Ticket } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, ErrorState, Notice, Panel, Spinner, fmtDate, fmtDateTime } from '../components/ui';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const STEPS = [
  ['ALLOCATED', 'Bed allocated'],
  ['FEE_SUBMITTED', 'Fee receipt sent'],
  ['VERIFIED', 'Fee verified'],
  ['CHECKED_IN', 'Checked in'],
];

function Stepper({ status }) {
  const at = STEPS.findIndex(([s]) => s === status);
  return (
    <ol className="grid grid-cols-4 gap-2">
      {STEPS.map(([s, label], i) => {
        const done = i < at || status === 'CHECKED_IN';
        const current = i === at && status !== 'CHECKED_IN';
        return (
          <li key={s} className="flex flex-col gap-2">
            <span className={`h-1.5 rounded-full ${done ? 'bg-campus-600' : current ? 'bg-marigold-500' : 'bg-slate-200'}`} />
            <span className={`flex items-center gap-1 text-xs ${done ? 'text-campus-700' : current ? 'font-semibold text-ink' : 'text-slate-400'}`}>
              {done && <Check className="h-3 w-3" aria-hidden="true" />}{label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ReceiptUpload({ allocationId, onDone }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  // Client checks are for quick feedback only; the server re-validates type, size and file content.
  const choose = (f) => {
    setError('');
    if (!f) return setFile(null);
    if (!TYPES.includes(f.type)) return setError('Choose a PDF, JPEG or PNG file.');
    if (f.size > MAX_BYTES) return setError('The file must be 2 MB or smaller.');
    return setFile(f);
  };

  const upload = async () => {
    const form = new FormData();
    form.append('receipt', file);
    setProgress(0);
    try {
      await api.post(`/allocations/${allocationId}/receipt`, form, {
        onUploadProgress: (e) => setProgress(Math.round((e.loaded / (e.total || file.size)) * 100)),
      });
      setFile(null);
      onDone('Receipt uploaded. Your warden will verify it.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><FileUp className="h-4 w-4" aria-hidden="true" /> Upload your hostel fee receipt</p>
      <p className="mt-1 text-xs text-slate-500">PDF, JPEG or PNG, up to 2 MB.</p>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => choose(e.target.files[0])} className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-campus-50 file:px-3 file:py-1.5 file:font-semibold file:text-campus-700" />
      {progress !== null && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-campus-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <button type="button" className="btn-primary mt-3" disabled={!file || progress !== null} onClick={upload}>
        {progress !== null ? `Uploading ${progress}%` : 'Upload receipt'}
      </button>
    </div>
  );
}

export default function MyRoom() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/allocations/me');
  const round = useApi('/rounds/current');
  const a = data?.data;
  const room = useApi(a ? `/rooms/${a.bed.room.id}` : null);
  const [flash, setFlash] = useState(null);

  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const r = round.data?.data;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">Session {data.session}</p>
        <h1 className="text-2xl font-bold tracking-tight">Hello, {user.name.split(' ')[0]}</h1>
      </div>
      {flash && <Notice kind="success" onClose={() => setFlash(null)}>{flash}</Notice>}

      {!a ? (
        <Panel>
          <Empty
            icon={Ticket}
            title="You don't have a bed for this session yet"
            hint={r?.status === 'PREFERENCES_OPEN' ? 'Preferences are open. Rank up to five rooms before the allocation runs.' : r?.status === 'BOOKING_OPEN' ? 'Open booking is live. Free beds go first come, first served.' : 'Check back when the hostel office opens the next round.'}
            action={r?.status === 'PREFERENCES_OPEN' ? <Link to="/preferences" className="btn-primary">Choose rooms</Link> : r?.status === 'BOOKING_OPEN' ? <Link to="/book" className="btn-primary">Book a bed</Link> : null}
          />
        </Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Panel bodyClass="p-6 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">{a.bed.room.hostel.name}</p>
                <p className="mt-1 text-4xl font-bold tracking-tight">Room {a.bed.room.roomNo}<span className="text-slate-400">·{a.bed.label}</span></p>
                <p className="mt-1 text-sm text-slate-500">{a.bed.room.floor === 0 ? 'Ground floor' : `Floor ${a.bed.room.floor}`} · Allocated through {a.source === 'PRIORITY' ? 'priority round' : a.source === 'OPEN_BOOKING' ? 'open booking' : a.source.toLowerCase()}</p>
              </div>
              <Badge status={a.status} />
            </div>
            <Stepper status={a.status} />
            {a.status === 'ALLOCATED' && (
              <>
                {a.feeDueAt && <Notice kind="warn">Upload your fee receipt by <strong>{fmtDateTime(a.feeDueAt)}</strong>, or the bed is released automatically.</Notice>}
                <ReceiptUpload allocationId={a.id} onDone={(m) => { setFlash(m); reload(); }} />
              </>
            )}
            {a.status === 'FEE_SUBMITTED' && <Notice>Your receipt is with the warden for verification.</Notice>}
            {a.status === 'VERIFIED' && <Notice kind="success">Fee verified. Collect your key from the warden's office to check in.</Notice>}
          </Panel>

          <div className="space-y-6">
            {room.data && (
              <Panel title="Your room">
                <div className="flex gap-2">
                  {room.data.data.beds.map((b) => (
                    <div key={b.id} className={`flex-1 rounded-lg border p-3 text-center ${b.label === a.bed.label ? 'border-marigold-400 bg-marigold-50' : b.allocationId ? 'border-campus-100 bg-campus-50' : 'border-dashed border-slate-300'}`}>
                      <p className="text-lg font-bold">{b.label}</p>
                      <p className="text-xs text-slate-500">{b.label === a.bed.label ? 'You' : b.allocationId ? 'Taken' : 'Free'}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
            <Panel title="Quick actions" bodyClass="p-2">
              <Link to="/complaints?new=1" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-slate-50"><MessageSquareWarning className="h-4 w-4 text-slate-500" aria-hidden="true" /> Report a problem in your room</Link>
              <Link to="/swaps" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-slate-50"><Repeat className="h-4 w-4 text-slate-500" aria-hidden="true" /> Swap rooms with someone</Link>
            </Panel>
          </div>
        </div>
      )}

      <Panel title="Allocation history" bodyClass="p-0">
        {data.history.length === 0 ? <Empty title="No allocations yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Session</th><th className="th">Hostel</th><th className="th">Room</th><th className="th">Allocated</th><th className="th">Status</th></tr></thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.id}>
                    <td className="td font-medium">{h.session}</td>
                    <td className="td">{h.bed.room.hostel.name}</td>
                    <td className="td">{h.bed.room.roomNo}-{h.bed.label}</td>
                    <td className="td text-slate-500">{fmtDate(h.createdAt)}</td>
                    <td className="td"><Badge status={h.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
