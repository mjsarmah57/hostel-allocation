import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageSquareWarning, Plus } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, ErrorState, Field, Modal, Notice, PageHeader, Pagination, Spinner, Tabs, fmtDate, humanize } from '../components/ui';

const CATEGORIES = ['ELECTRICAL', 'PLUMBING', 'FURNITURE', 'CLEANING', 'INTERNET', 'OTHER'];

function NewComplaint({ open, onClose, onCreated }) {
  const [f, setF] = useState({ category: '', priority: 'MEDIUM', title: '', description: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); };

  const submit = async () => {
    const e = {};
    if (!f.category) e.category = 'Pick a category';
    if (f.title.trim().length < 5) e.title = 'At least 5 characters';
    if (f.description.trim().length < 10) e.description = 'Describe the problem in at least 10 characters';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError('');
    try {
      const { data } = await api.post('/complaints', f);
      setF({ category: '', priority: 'MEDIUM', title: '', description: '' });
      onCreated(data.data);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Report a problem" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send to warden'}</button></>}>
      <div className="space-y-4">
        {serverError && <Notice kind="error">{serverError}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" error={errors.category}>{(id) => <select id={id} className="input" value={f.category} onChange={set('category')}><option value="">Select</option>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>}</Field>
          <Field label="Urgency">{(id) => <select id={id} className="input" value={f.priority} onChange={set('priority')}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select>}</Field>
        </div>
        <Field label="What's wrong?" error={errors.title}>{(id) => <input id={id} className="input" maxLength={120} placeholder="Fan not working" value={f.title} onChange={set('title')} />}</Field>
        <Field label="Details" error={errors.description}>{(id) => <textarea id={id} className="input min-h-28" maxLength={2000} placeholder="Since when, what you've tried, best time to visit" value={f.description} onChange={set('description')} />}</Field>
      </div>
    </Modal>
  );
}

export default function Complaints() {
  const { can } = useAuth();
  const staff = can('complaint:manage');
  const isAdmin = can('hostel:all');
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(staff ? 'OPEN' : '');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [hostelId, setHostelId] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('-createdAt');
  const [page, setPage] = useState(1);
  const [created, setCreated] = useState(null);
  const hostels = useApi(isAdmin ? '/hostels' : null);

  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  const qs = new URLSearchParams({ page, limit: 15, sort });
  if (status) qs.set('status', status);
  if (category) qs.set('category', category);
  if (priority) qs.set('priority', priority);
  if (hostelId) qs.set('hostelId', hostelId);
  if (q) qs.set('q', q);
  const list = useApi(`/complaints?${qs}`);
  const newOpen = params.get('new') === '1';

  return (
    <div>
      <PageHeader
        title={staff ? 'Complaints' : 'My complaints'}
        subtitle={staff ? 'Room problems reported by residents. Open ones are on top.' : 'Problems you reported in your room and where each one stands.'}
        actions={!staff && <button type="button" className="btn-primary" onClick={() => setParams({ new: '1' })}><Plus className="h-4 w-4" aria-hidden="true" />Report a problem</button>}
      />
      {created && <div className="mb-4"><Notice kind="success" onClose={() => setCreated(null)}>Complaint sent to your warden. <Link className="font-semibold underline" to={`/complaints/${created.id}`}>Track it</Link>.</Notice></div>}
      <Tabs
        value={status}
        onChange={(v) => { setStatus(v); setPage(1); }}
        tabs={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'CLOSED', label: 'Closed' }]}
      />
      {staff && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input className="input lg:col-span-2" placeholder="Search title, roll number, name or room" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <select className="input" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>
          <select className="input" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} aria-label="Urgency"><option value="">Any urgency</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select>
          {isAdmin ? (
            <select className="input" value={hostelId} onChange={(e) => { setHostelId(e.target.value); setPage(1); }} aria-label="Hostel"><option value="">All hostels</option>{hostels.data?.data.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          ) : (
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="-createdAt">Newest first</option><option value="-priority">Most urgent first</option><option value="createdAt">Oldest first</option></select>
          )}
        </div>
      )}
      <div className="panel overflow-hidden">
        {list.loading && <div className="px-5"><Spinner /></div>}
        {list.error && <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>}
        {list.data && (list.data.data.length === 0 ? (
          <Empty icon={MessageSquareWarning} title={staff ? 'Nothing here' : 'No complaints'} hint={staff ? 'No complaints match these filters.' : "If something in your room needs fixing, report it and your warden is notified."} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className="th">Problem</th>{staff && <th className="th">Student</th>}<th className="th">Room</th><th className="th">Urgency</th><th className="th">Status</th><th className="th">Raised</th></tr></thead>
                <tbody>
                  {list.data.data.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="td"><Link to={`/complaints/${c.id}`} className="font-semibold text-ink hover:text-campus-700">{c.title}</Link><span className="block text-xs text-slate-500">{humanize(c.category)}</span></td>
                      {staff && <td className="td">{c.studentName}<span className="block text-xs text-slate-500">{c.rollNo}</span></td>}
                      <td className="td">{c.roomNo}<span className="block text-xs text-slate-500">{c.hostelName}</span></td>
                      <td className="td"><Badge status={c.priority} /></td>
                      <td className="td"><Badge status={c.status} /></td>
                      <td className="td text-slate-500">{fmtDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={list.data.meta} onPage={setPage} />
          </>
        ))}
      </div>
      {!staff && <NewComplaint open={newOpen} onClose={() => setParams({})} onCreated={(c) => { setParams({}); setCreated(c); list.reload(); }} />}
    </div>
  );
}
