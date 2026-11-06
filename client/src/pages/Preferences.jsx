import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Badge, ErrorState, Notice, PageHeader, Panel, Spinner } from '../components/ui';
import RoomPicker from '../components/RoomPicker';

export default function Preferences() {
  const round = useApi('/rounds/current');
  const roundId = round.data?.data?.id;
  const existing = useApi(roundId ? `/rounds/${roundId}/preferences/me` : null);
  const [list, setList] = useState([]);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) setList(existing.data.data.map((p) => ({ id: p.room.id, roomNo: p.room.roomNo, hostelName: p.room.hostel.name })));
  }, [existing.data]);

  if (round.loading) return <Spinner />;
  if (round.error) return <ErrorState message={round.error} onRetry={round.reload} />;
  const r = round.data.data;
  const open = r.status === 'PREFERENCES_OPEN';

  const move = (i, d) => setList((l) => { const n = [...l]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.put(`/rounds/${r.id}/preferences`, { roomIds: list.map((x) => x.id) });
      setMsg({ kind: 'success', text: 'Preferences saved. You can change them until the allocation runs.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Room preferences" subtitle={`Rank up to five rooms for ${r.session}. Priority goes to PwD students, then seniority, then CGPA.`} actions={<Badge status={r.status} />} />
      {!open && <Notice>Preferences are closed right now, so your list is read-only.</Notice>}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <Panel title={`Your ranked list (${list.length}/5)`} className="h-fit lg:sticky lg:top-6">
          {existing.loading ? <Spinner /> : list.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing chosen yet. Add rooms from the list.</p>
          ) : (
            <ol className="space-y-2">
              {list.map((x, i) => (
                <li key={x.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${i === 0 ? 'bg-marigold-500 text-campus-900' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                  <span className="flex-1">Room {x.roomNo}<span className="block text-xs text-slate-500">{x.hostelName}</span></span>
                  {open && (
                    <span className="flex gap-0.5">
                      <button type="button" className="btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" className="btn-ghost btn-sm" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setList(list.filter((y) => y.id !== x.id))} aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-slate-500">If all your rooms are full, you get any free bed in the hostel of your first choice.</p>
          {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
          {open && <button type="button" className="btn-primary mt-4 w-full" disabled={saving || list.length === 0} onClick={save}>{saving ? 'Saving…' : 'Save preferences'}</button>}
        </Panel>
        {open && (
          <RoomPicker
            action={(room) => {
              const chosen = list.some((x) => x.id === room.id);
              return (
                <button type="button" className={chosen ? 'btn-ghost btn-sm' : 'btn-secondary btn-sm'} disabled={chosen || list.length >= 5}
                  onClick={() => setList([...list, { id: room.id, roomNo: room.roomNo, hostelName: room.hostelName }])}>
                  {chosen ? 'Added' : 'Add'}
                </button>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
