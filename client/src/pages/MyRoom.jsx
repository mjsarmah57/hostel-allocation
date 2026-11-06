import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Empty, ErrorState, Loading, Notice } from '../components/States';
import StatusBadge from '../components/StatusBadge';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function ReceiptUpload({ allocationId, onDone }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [msg, setMsg] = useState(null);

  // Client-side checks are for quick feedback only; the server re-validates type, size and content.
  const choose = (f) => {
    setMsg(null);
    if (!f) return setFile(null);
    if (!TYPES.includes(f.type)) return setMsg({ kind: 'error', text: 'Choose a PDF, JPEG or PNG file' });
    if (f.size > MAX_BYTES) return setMsg({ kind: 'error', text: 'File must be 2 MB or smaller' });
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
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <p className="text-sm font-medium">Upload hostel fee receipt</p>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => choose(e.target.files[0])} className="text-sm" />
      {progress !== null && (
        <div className="h-2 w-full overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <button type="button" className="btn-primary" disabled={!file || progress !== null} onClick={upload}>
        {progress !== null ? `Uploading ${progress}%` : 'Upload receipt'}
      </button>
    </div>
  );
}

export default function MyRoom() {
  const { data, loading, error, reload } = useApi('/allocations/me');
  const [flash, setFlash] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const a = data.data;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My room · {data.session}</h1>
      {flash && <Notice kind="success">{flash}</Notice>}
      {!a ? (
        <Empty title="You don't have a bed for this session yet" hint="Submit preferences while they are open, or book a free bed when open booking starts." />
      ) : (
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">{a.bed.room.hostel.name}</p>
              <p className="text-2xl font-semibold">Room {a.bed.room.roomNo} · Bed {a.bed.label}</p>
              <p className="text-sm text-slate-500">Floor {a.bed.room.floor} · via {a.source.replace('_', ' ').toLowerCase()}</p>
            </div>
            <StatusBadge status={a.status} />
          </div>
          {a.status === 'ALLOCATED' && a.feeDueAt && (
            <Notice kind="info">Upload your fee receipt by <strong>{new Date(a.feeDueAt).toLocaleString()}</strong>, or the bed will be released automatically.</Notice>
          )}
          {a.status === 'ALLOCATED' && <ReceiptUpload allocationId={a.id} onDone={(m) => { setFlash(m); reload(); }} />}
          {a.status === 'FEE_SUBMITTED' && <p className="mt-3 text-sm text-slate-600">Receipt submitted; waiting for your warden to verify it.</p>}
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 font-medium">History</h2>
        {data.history.length === 0 ? (
          <Empty title="No previous allocations" />
        ) : (
          <table className="w-full">
            <thead><tr><th className="th">Session</th><th className="th">Hostel</th><th className="th">Room</th><th className="th">Status</th></tr></thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td className="td">{h.session}</td>
                  <td className="td">{h.bed.room.hostel.name}</td>
                  <td className="td">{h.bed.room.roomNo}-{h.bed.label}</td>
                  <td className="td"><StatusBadge status={h.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
