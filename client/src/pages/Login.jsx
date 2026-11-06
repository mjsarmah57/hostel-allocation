import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';
import { Notice } from '../components/States';

const DEMO = [
  ['Admin', 'admin@hostel.edu', 'Admin@123'],
  ['Warden (Aryabhata)', 'warden1@hostel.edu', 'Warden@123'],
  ['Warden (Bhaskara)', 'warden2@hostel.edu', 'Warden@123'],
  ['Student HR00001', 's00001@hostel.edu', 'Student@123'],
  ['Student HR00003', 's00003@hostel.edu', 'Student@123'],
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
    if (!form.email || !form.password) return setError('Enter your email and password');
    setBusy(true);
    try {
      await login(form.email, form.password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">Hostel Allocation</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in with your institute account</p>
        <form onSubmit={submit} className="card space-y-4" noValidate>
          {error && <Notice kind="error">{error}</Notice>}
          <label className="block text-sm">
            Email
            <input className="input mt-1" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block text-sm">
            Password
            <input className="input mt-1" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <button type="submit" className="btn-primary w-full justify-center" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="mt-4 text-xs text-slate-500">
          <p className="mb-1">Demo accounts (click to fill):</p>
          <div className="flex flex-wrap gap-1">
            {DEMO.map(([label, email, password]) => (
              <button key={email} type="button" className="rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-100" onClick={() => setForm({ email, password })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
