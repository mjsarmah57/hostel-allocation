import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, FileSpreadsheet, KeyRound, UserCheck, UserPlus, UserX } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Avatar, Badge, Empty, ErrorState, Field, Modal, Notice, PageHeader, Pagination, Spinner, Tabs, fmtDate } from '../components/ui';

// A one-time password is shown exactly once; the user must change it at first sign-in.
function TempPassword({ value, who }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-marigold-100 bg-marigold-50 p-4">
      <p className="text-sm text-marigold-700">Temporary password for {who}. It won't be shown again.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-white px-3 py-2 text-base font-semibold tracking-wide">{value}</code>
        <button type="button" className="btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); }}><Copy className="h-3.5 w-3.5" aria-hidden="true" />{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

function NewWarden({ open, onClose, onDone }) {
  const hostels = useApi(open ? '/hostels' : null);
  const [f, setF] = useState({ name: '', email: '', phone: '', hostelId: '' });
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError('');
    if (f.name.trim().length < 3 || !/^\S+@\S+\.\S+$/.test(f.email)) return setError('Enter a name and a valid email.');
    if (f.phone && !/^[6-9]\d{9}$/.test(f.phone)) return setError('Enter a valid 10-digit mobile number.');
    setBusy(true);
    try {
      const { data } = await api.post('/users/wardens', { name: f.name.trim(), email: f.email.trim(), phone: f.phone || undefined, hostelId: f.hostelId ? Number(f.hostelId) : undefined });
      setResult(data);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  const close = () => { setResult(null); setF({ name: '', email: '', phone: '', hostelId: '' }); onClose(); };

  return (
    <Modal open={open} title="Add a warden" onClose={close} footer={result ? <button type="button" className="btn-primary" onClick={close}>Done</button> : <><button type="button" className="btn-secondary" onClick={close}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>Create warden</button></>}>
      {result ? <TempPassword value={result.temporaryPassword} who={result.data.email} /> : (
        <div className="space-y-4">
          {error && <Notice kind="error">{error}</Notice>}
          <Field label="Full name">{(id) => <input id={id} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Email">{(id) => <input id={id} className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Mobile number (optional)">{(id) => <input id={id} className="input" inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          <Field label="Hostel" hint="Replaces that hostel's current warden.">{(id) => (
            <select id={id} className="input" value={f.hostelId} onChange={(e) => setF({ ...f, hostelId: e.target.value })}>
              <option value="">Assign later</option>
              {hostels.data?.data.map((h) => <option key={h.id} value={h.id}>{h.name}{h.wardenName ? ` (now ${h.wardenName})` : ''}</option>)}
            </select>
          )}</Field>
        </div>
      )}
    </Modal>
  );
}

const SAMPLE = 'name,email,rollNo,gender,year,program,cgpa,phone\nAsha Kumari,asha@hostel.edu,HR70001,FEMALE,1,MCA,8.4,9876500001\n';

function ImportCsv({ open, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const upload = async () => {
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    setProgress(0);
    try {
      const { data } = await api.post('/users/import', fd, { onUploadProgress: (e) => setProgress(Math.round((e.loaded / (e.total || file.size)) * 100)) });
      setResult(data);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };
  const close = () => { setResult(null); setFile(null); setError(''); onClose(); };
  const sampleHref = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`;

  return (
    <Modal wide open={open} title="Import students from CSV" onClose={close} footer={result ? <button type="button" className="btn-primary" onClick={close}>Done</button> : <><button type="button" className="btn-secondary" onClick={close}>Cancel</button><button type="button" className="btn-primary" disabled={!file || progress !== null} onClick={upload}>{progress !== null ? `Uploading ${progress}%` : 'Import'}</button></>}>
      {result ? (
        <div className="space-y-4">
          <p className="text-sm"><strong className="text-2xl">{result.data.created}</strong> students created · <strong>{result.data.failed}</strong> rows skipped</p>
          {result.temporaryPassword && <TempPassword value={result.temporaryPassword} who="every imported student" />}
          {result.data.errors.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full"><thead><tr><th className="th">Line</th><th className="th">Problem</th></tr></thead>
                <tbody>{result.data.errors.map((e) => <tr key={e.line}><td className="td font-medium">{e.line}</td><td className="td text-red-800">{e.errors.join('; ')}</td></tr>)}</tbody></table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Notice kind="error">{error}</Notice>}
          <p className="text-sm text-slate-600">Columns: <code>name, email, rollNo, gender, year, program, cgpa</code>, and optionally <code>phone</code>. Imported accounts are approved straight away and share one temporary password that each student must change at first sign-in.</p>
          <a href={sampleHref} download="students-template.csv" className="inline-flex items-center gap-2 text-sm font-medium text-campus-700 hover:underline"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Download a template</a>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0] || null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-campus-50 file:px-3 file:py-1.5 file:font-semibold file:text-campus-700" />
          {progress !== null && <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-campus-600" style={{ width: `${progress}%` }} /></div>}
        </div>
      )}
    </Modal>
  );
}

export default function Users() {
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [modal, setModal] = useState(null);
  const [reset, setReset] = useState(null);
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState('');
  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  const qs = new URLSearchParams({ page, limit: 20 });
  if (tab === 'pending') { qs.set('status', 'PENDING'); qs.set('role', 'student'); qs.set('sort', 'createdAt'); }
  if (tab === 'students') { qs.set('role', 'student'); qs.set('status', 'APPROVED'); }
  if (tab === 'wardens') { qs.set('role', 'warden'); qs.set('sort', 'name'); }
  if (tab === 'rejected') { qs.set('status', 'REJECTED'); }
  if (q) qs.set('q', q);
  const list = useApi(`/users?${qs}`);
  const pendingCount = useApi('/users?status=PENDING&limit=1');

  const act = async (id, fn, ok) => {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fn();
      if (ok) setMsg({ kind: 'success', text: ok });
      list.reload();
      pendingCount.reload();
      return res;
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const doReset = async (u) => {
    const res = await act(u.id, () => api.post(`/users/${u.id}/reset-password`));
    if (res) setReset({ value: res.data.temporaryPassword, who: u.email });
  };

  return (
    <div>
      <PageHeader title="Users & registrations" subtitle="Approve new students, manage wardens, and import students in bulk."
        actions={<><button type="button" className="btn-secondary" onClick={() => setModal('import')}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Import CSV</button><button type="button" className="btn-primary" onClick={() => setModal('warden')}><UserPlus className="h-4 w-4" aria-hidden="true" />Add warden</button></>} />
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} tabs={[
        { value: 'pending', label: 'Pending approval', count: pendingCount.data?.meta.total },
        { value: 'students', label: 'Students' },
        { value: 'wardens', label: 'Wardens' },
        { value: 'rejected', label: 'Rejected' },
      ]} />
      {msg && <div className="mb-4"><Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice></div>}
      {reset && <div className="mb-4"><TempPassword value={reset.value} who={reset.who} /></div>}
      <input className="input mb-4 sm:max-w-sm" placeholder="Search name, email or roll number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />

      <div className="panel overflow-hidden">
        {list.loading && <div className="px-5"><Spinner /></div>}
        {list.error && <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>}
        {list.data && (list.data.data.length === 0 ? (
          <Empty icon={UserCheck} title={tab === 'pending' ? 'No registrations waiting' : 'No users match'} hint={tab === 'pending' ? 'New student sign-ups appear here for approval.' : undefined} />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {list.data.data.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <Avatar name={u.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {u.studentId && tab !== 'pending' ? <Link to={`/students/${u.studentId}`} className="hover:text-campus-700">{u.name}</Link> : u.name}
                      {!u.isActive && <span className="ml-2"><Badge status="INACTIVE">Deactivated</Badge></span>}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {u.email}{u.phone ? ` · ${u.phone}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {u.role === 'student' ? `${u.rollNo} · ${u.gender === 'MALE' ? 'Male' : 'Female'} · ${u.program} year ${u.year} · CGPA ${Number(u.cgpa).toFixed(2)}${u.isPwd ? ' · PwD' : ''}` : u.role === 'warden' ? (u.hostelName ? `Warden of ${u.hostelName}` : 'No hostel assigned') : u.role}
                      {` · joined ${fmtDate(u.createdAt)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {u.approvalStatus === 'PENDING' ? (
                      <>
                        <button type="button" className="btn-secondary btn-sm" disabled={busy === u.id} onClick={() => { setReject(u); setReason(''); }}>Reject</button>
                        <button type="button" className="btn-primary btn-sm" disabled={busy === u.id} onClick={() => act(u.id, () => api.patch(`/users/${u.id}/approval`, { approve: true }), `${u.name} approved. They can sign in now.`)}><UserCheck className="h-3.5 w-3.5" aria-hidden="true" />Approve</button>
                      </>
                    ) : u.approvalStatus === 'APPROVED' && u.role !== 'admin' && (
                      <>
                        <button type="button" className="btn-ghost btn-sm" disabled={busy === u.id} onClick={() => doReset(u)}><KeyRound className="h-3.5 w-3.5" aria-hidden="true" />Reset password</button>
                        <button type="button" className="btn-ghost btn-sm" disabled={busy === u.id} onClick={() => act(u.id, () => api.patch(`/users/${u.id}`, { isActive: !u.isActive }), u.isActive ? `${u.name} deactivated and signed out.` : `${u.name} reactivated.`)}>
                          <UserX className="h-3.5 w-3.5" aria-hidden="true" />{u.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination meta={list.data.meta} onPage={setPage} />
          </>
        ))}
      </div>

      <NewWarden open={modal === 'warden'} onClose={() => setModal(null)} onDone={() => list.reload()} />
      <ImportCsv open={modal === 'import'} onClose={() => setModal(null)} onDone={() => list.reload()} />
      <Modal open={!!reject} title={`Reject ${reject?.name}?`} onClose={() => setReject(null)}
        footer={<><button type="button" className="btn-secondary" onClick={() => setReject(null)}>Cancel</button><button type="button" className="btn-danger" onClick={async () => { await act(reject.id, () => api.patch(`/users/${reject.id}/approval`, { approve: false, reason: reason.trim() || undefined }), `${reject.name}'s registration rejected.`); setReject(null); }}>Reject registration</button></>}>
        <label htmlFor="reason" className="text-sm text-slate-600">Reason (sent to the student)</label>
        <textarea id="reason" className="input mt-1 min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Roll number doesn't match university records" />
      </Modal>
    </div>
  );
}
