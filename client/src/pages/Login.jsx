import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';
import { Field, Notice } from '../components/ui';
import AuthShell from './AuthShell';

const DEMO = [
  ['Admin', 'admin@hostel.edu', 'Admin@123'],
  ['Warden', 'warden2@hostel.edu', 'Warden@123'],
  ['Student', 's00001@hostel.edu', 'Student@123'],
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.email || !form.password) return setError('Enter your email and password.');
    setBusy(true);
    try {
      await login(form.email.trim(), form.password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Use your institute email.</p>
        {location.state?.registered && <div className="mt-5"><Notice kind="success">Registration received. You can sign in once the hostel office approves it.</Notice></div>}
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          {error && <Notice kind="error">{error}</Notice>}
          <Field label="Email">{(id) => <input id={id} className="input" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          <Field label="Password">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}</Field>
          <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="mt-6 text-sm text-slate-600">New student? <Link to="/register" className="font-semibold text-campus-700 hover:underline">Create an account</Link></p>
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-4">
          <p className="text-xs text-slate-500">Demo accounts. Click to fill in:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DEMO.map(([label, email, password]) => (
              <button key={email} type="button" className="btn-secondary btn-sm" onClick={() => setForm({ email, password })}>{label}</button>
            ))}
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
