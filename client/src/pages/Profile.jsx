import { useState } from 'react';
import { api, errorMessage, setAccessToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar, DetailList, Field, Notice, PageHeader, Panel } from '../components/ui';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [p, setP] = useState({ name: user.name, phone: user.phone || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState(null);
  const [pwMsg, setPwMsg] = useState(null);
  const [pwErr, setPwErr] = useState({});
  const [busy, setBusy] = useState(false);

  const saveProfile = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (p.phone && !/^[6-9]\d{9}$/.test(p.phone)) return setMsg({ kind: 'error', text: 'Enter a valid 10-digit mobile number.' });
    try {
      const { data } = await api.patch('/auth/me', { name: p.name.trim(), phone: p.phone || null });
      updateUser(data.user);
      setMsg({ kind: 'success', text: 'Profile saved.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
    return undefined;
  };

  const changePassword = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!pw.currentPassword) errs.currentPassword = 'Enter your current password';
    if (pw.newPassword.length < 8 || !/[A-Z]/.test(pw.newPassword) || !/[a-z]/.test(pw.newPassword) || !/\d/.test(pw.newPassword)) errs.newPassword = 'At least 8 characters with upper, lower case and a digit';
    if (pw.confirm !== pw.newPassword) errs.confirm = 'Passwords do not match';
    setPwErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setPwMsg(null);
    try {
      const { data } = await api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setAccessToken(data.accessToken);
      updateUser(data.user);
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setPwMsg({ kind: 'success', text: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setPwMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Your profile" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Account">
          <div className="mb-6 flex items-center gap-4">
            <Avatar name={user.name} size="lg" />
            <div>
              <p className="text-lg font-semibold">{user.name}</p>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
          </div>
          <DetailList items={[['Role', user.role], ['Permissions', `${user.permissions.length} granted`]]} />
          <form onSubmit={saveProfile} className="mt-6 space-y-4 border-t border-slate-100 pt-6" noValidate>
            {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            <Field label="Full name">{(id) => <input id={id} className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />}</Field>
            <Field label="Mobile number">{(id) => <input id={id} className="input" inputMode="numeric" maxLength={10} value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} />}</Field>
            <button type="submit" className="btn-primary">Save profile</button>
          </form>
        </Panel>
        <Panel title="Change password">
          {user.mustChangePassword && <div className="mb-4"><Notice kind="warn">You signed in with a temporary password. Choose your own now.</Notice></div>}
          <form onSubmit={changePassword} className="space-y-4" noValidate>
            {pwMsg && <Notice kind={pwMsg.kind}>{pwMsg.text}</Notice>}
            <Field label="Current password" error={pwErr.currentPassword}>{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" error={pwErr.newPassword} hint="8+ characters with upper and lower case letters and a digit">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
            <Field label="Confirm new password" error={pwErr.confirm}>{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
