import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { DetailList, Empty, ErrorState, Field, Modal, Notice, PageHeader, Panel, Spinner, Stat } from '../components/ui';
import RoomMap from '../components/RoomMap';
import { HostelForm } from './Hostels';

function AddRooms({ hostelId, open, onClose, onDone }) {
  const [f, setF] = useState({ floor: 0, from: 1, to: 10, capacity: 2 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const n = (k) => (e) => setF({ ...f, [k]: Number(e.target.value) });
  const count = f.to >= f.from ? f.to - f.from + 1 : 0;

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post(`/hostels/${hostelId}/rooms`, f);
      onDone(`${data.data.created} rooms added.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const pad = (x) => `${f.floor}${String(x).padStart(2, '0')}`;

  return (
    <Modal open={open} title="Add rooms" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy || !count} onClick={save}>Add {count} room{count === 1 ? '' : 's'}</button></>}>
      <div className="space-y-4">
        {error && <Notice kind="error">{error}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Floor">{(id) => <input id={id} className="input" type="number" min="0" max="20" value={f.floor} onChange={n('floor')} />}</Field>
          <Field label="Beds per room">{(id) => <select id={id} className="input" value={f.capacity} onChange={n('capacity')}>{[1, 2, 3, 4, 5, 6].map((c) => <option key={c} value={c}>{c}</option>)}</select>}</Field>
          <Field label="From number">{(id) => <input id={id} className="input" type="number" min="1" max="99" value={f.from} onChange={n('from')} />}</Field>
          <Field label="To number">{(id) => <input id={id} className="input" type="number" min="1" max="99" value={f.to} onChange={n('to')} />}</Field>
        </div>
        <p className="text-sm text-slate-500">{count ? `Creates rooms ${pad(f.from)} to ${pad(f.to)}, ${count * f.capacity} beds in total.` : 'The range is empty.'}</p>
      </div>
    </Modal>
  );
}

export default function HostelDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const h = useApi(`/hostels/${id}`);
  const mine = useApi(can('allocation:read_own') ? '/allocations/me' : null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null);

  if (h.loading) return <Spinner />;
  if (h.error) return <ErrorState message={h.error} onRetry={h.reload} />;
  const d = h.data.data;
  const manage = can('hostel:manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title={d.name}
        subtitle={`${d.gender === 'MALE' ? 'Men' : 'Women'} · years ${d.allowedYears.join(', ')} · session ${h.data.session}`}
        back={{ to: '/hostels', label: 'Hostels' }}
        actions={manage && <><button type="button" className="btn-secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button><button type="button" className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add rooms</button></>}
      />
      {msg && <Notice kind="success" onClose={() => setMsg(null)}>{msg}</Notice>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Occupied" value={`${d.totals.beds ? Math.round((d.totals.occupied / d.totals.beds) * 100) : 0}%`} hint={`${d.totals.occupied} of ${d.totals.beds} beds`} tone="good" />
        <Stat label="Free beds" value={d.totals.free} hint={`${d.totals.rooms} rooms`} />
        <Stat label="Awaiting fee" value={d.totals.awaitingFee} tone={d.totals.awaitingFee ? 'warn' : 'default'} />
        <Stat label="Open complaints" value={d.openComplaints} tone={d.openComplaints ? 'bad' : 'default'} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Panel title="Room map">
          {d.floors.length === 0 ? <Empty title="No rooms yet" hint={manage ? 'Add rooms floor by floor.' : undefined} /> : (
            <div className="overflow-x-auto"><RoomMap floors={d.floors} highlightRoomId={mine.data?.data?.bed?.room?.id} /></div>
          )}
        </Panel>
        <Panel title="Hostel">
          <DetailList items={[
            ['Code', d.code], ['Warden', d.warden?.name || 'Not assigned'], ['Warden email', d.warden?.email], ['Warden phone', d.warden?.phone],
            ['Fee submitted', d.totals.feeSubmitted], ['Verified', d.totals.verified], ['Checked in', d.totals.checkedIn],
          ]} />
        </Panel>
      </div>
      {editing && <HostelForm open hostel={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setMsg('Hostel updated.'); h.reload(); }} />}
      {adding && <AddRooms open hostelId={d.id} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); setMsg(m); h.reload(); }} />}
    </div>
  );
}
