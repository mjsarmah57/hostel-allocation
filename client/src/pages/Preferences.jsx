import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { ErrorState, Loading, Notice } from '../components/States';
import RoomPicker from '../components/RoomPicker';
import StatusBadge from '../components/StatusBadge';

export default function Preferences() {
  const round = useApi('/rounds/current');
  const roundId = round.data?.data?.id;
  const existing = useApi(roundId ? `/rounds/${roundId}/preferences/me` : null);
  const [list, setList] = useState([]);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setList(existing.data.data.map((p) => ({ id: p.room.id, roomNo: p.room.roomNo, hostelName: p.room.hostel.name })));
    }
  }, [existing.data]);

  if (round.loading) return <Loading />;
  if (round.error) return <ErrorState message={round.error} onRetry={round.reload} />;
  const r = round.data.data;
  const open = r.status === 'PREFERENCES_OPEN';

  const move = (i, d) => setList((l) => { const n = [...l]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.put(`/rounds/${r.id}/preferences`, { roomIds: list.map((x) => x.id) });
      setMsg({ kind: 'success', text: 'Preferences saved. You can change them until the round closes.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Room preferences · {r.session}</h1>
        <StatusBadge status={r.status} />
      </div>
      {!open && <Notice>Preferences are not open right now. The list below is read-only.</Notice>}

      <div className="card">
        <h2 className="mb-1 font-medium">Your ranked list ({list.length}/5)</h2>
        <p className="mb-3 text-sm text-slate-500">If all your rooms are full, you get any free bed in the hostel of your first choice.</p>
        {existing.loading ? <Loading /> : list.length === 0 ? (
          <p className="text-sm text-slate-500">No rooms chosen yet. Add up to five from the list below.</p>
        ) : (
          <ol className="space-y-2">
            {list.map((x, i) => (
              <li key={x.id} className="flex items-center gap-3 rounded border border-slate-200 px-3 py-2 text-sm">
                <span className="w-6 font-semibold text-indigo-700">{i + 1}</span>
                <span className="flex-1">{x.hostelName} · Room {x.roomNo}</span>
                {open && (
                  <>
                    <button type="button" className="btn-secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                    <button type="button" className="btn-secondary" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                    <button type="button" className="btn-secondary" onClick={() => setList(list.filter((y) => y.id !== x.id))}>Remove</button>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
        {open && (
          <button type="button" className="btn-primary mt-4" disabled={saving || list.length === 0} onClick={save}>
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
        )}
      </div>

      {open && (
        <RoomPicker
          action={(room) => {
            const chosen = list.some((x) => x.id === room.id);
            return (
              <button type="button" className="btn-secondary" disabled={chosen || list.length >= 5}
                onClick={() => setList([...list, { id: room.id, roomNo: room.roomNo, hostelName: room.hostelName }])}>
                {chosen ? 'Added' : 'Add'}
              </button>
            );
          }}
        />
      )}
    </div>
  );
}
