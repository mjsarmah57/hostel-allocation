import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorState, Field, Modal, Notice, PageHeader, Spinner } from '../components/ui';

export function HostelForm({ open, onClose, onSaved, hostel }) {
  const wardens = useApi(open ? '/users?role=warden&limit=100&sort=name' : null);
  const [f, setF] = useState(() => ({ name: hostel?.name || '', code: hostel?.code || '', gender: hostel?.gender || 'MALE', allowedYears: hostel?.allowedYears || [1], wardenId: hostel?.warden?.id || '' }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toggleYear = (y) => setF({ ...f, allowedYears: f.allowedYears.includes(y) ? f.allowedYears.filter((x) => x !== y) : [...f.allowedYears, y].sort() });

  const save = async () => {
    setError('');
    if (f.name.trim().length < 3) return setError('Enter a hostel name.');
    if (!/^[A-Za-z]{2,10}$/.test(f.code)) return setError('Code must be 2–10 letters.');
    if (!f.allowedYears.length) return setError('Pick at least one year.');
    setBusy(true);
    try {
      const body = { name: f.name.trim(), code: f.code.toUpperCase(), allowedYears: f.allowedYears, wardenId: f.wardenId ? Number(f.wardenId) : null };
      const res = hostel ? await api.patch(`/hostels/${hostel.id}`, body) : await api.post('/hostels', { ...body, gender: f.gender });
      onSaved(res.data.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Modal open={open} title={hostel ? `Edit ${hostel.name}` : 'New hostel'} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>{hostel ? 'Save changes' : 'Create hostel'}</button></>}>
      <div className="space-y-4">
        {error && <Notice kind="error">{error}</Notice>}
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Name">{(id) => <input id={id} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Visvesvaraya Hall" />}</Field>
          <Field label="Code">{(id) => <input id={id} className="input uppercase" maxLength={10} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="VIS" />}</Field>
        </div>
        {!hostel && (
          <Field label="Residents">{(id) => <select id={id} className="input" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="MALE">Male</option><option value="FEMALE">Female</option></select>}</Field>
        )}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Years admitted</legend>
          <div className="flex gap-2">{[1, 2, 3, 4, 5].map((y) => (
            <label key={y} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${f.allowedYears.includes(y) ? 'border-campus-600 bg-campus-50 text-campus-700' : 'border-slate-300'}`}>
              <input type="checkbox" className="sr-only" checked={f.allowedYears.includes(y)} onChange={() => toggleYear(y)} />Year {y}
            </label>
          ))}</div>
        </fieldset>
        <Field label="Warden" hint="Assigning a warden moves them off any other hostel.">{(id) => (
          <select id={id} className="input" value={f.wardenId} onChange={(e) => setF({ ...f, wardenId: e.target.value })}>
            <option value="">No warden</option>
            {wardens.data?.data.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.name}{w.hostelName ? ` (now ${w.hostelName})` : ''}</option>)}
          </select>
        )}</Field>
      </div>
    </Modal>
  );
}

export default function Hostels() {
  const { can, user } = useAuth();
  const list = useApi('/hostels');
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader title="Hostels & rooms" subtitle={list.data ? `Session ${list.data.session}` : undefined} actions={can('hostel:manage') && <button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />New hostel</button>} />
      {list.loading && <Spinner />}
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.data && (list.data.data.length === 0 ? <div className="panel"><Empty icon={Building2} title="No hostels yet" /></div> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.data.map((h) => {
            const pct = h.beds ? Math.round((h.occupied / h.beds) * 100) : 0;
            const mine = h.id === user.hostelId;
            return (
              <Link key={h.id} to={`/hostels/${h.id}`} className={`panel block p-5 hover:border-campus-500 ${mine ? 'ring-2 ring-marigold-400' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{h.name}</p>
                    <p className="text-sm text-slate-500">{h.gender === 'MALE' ? 'Men' : 'Women'} · years {h.allowedYears.join(', ')}</p>
                  </div>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{h.code}</span>
                </div>
                <p className="mt-5 text-3xl font-bold tracking-tight">{pct}%<span className="ml-1.5 text-sm font-normal text-slate-500">occupied</span></p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-campus-600" style={{ width: `${pct}%` }} /></div>
                <p className="mt-3 text-xs text-slate-500">{h.rooms} rooms · {h.beds} beds · {h.freeBeds} free · {h.wardenName ? `Warden ${h.wardenName}` : 'No warden'}</p>
              </Link>
            );
          })}
        </div>
      ))}
      {creating && <HostelForm open onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); }} />}
    </div>
  );
}
