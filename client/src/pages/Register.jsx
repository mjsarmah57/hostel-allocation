import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';
import { Field, Notice } from '../components/ui';
import AuthShell from './AuthShell';

const PROGRAMS = ['BTech', 'MTech', 'MCA', 'MSc', 'MBA', 'PhD'];

// Client-side rules mirror the server's zod schema for instant feedback; the server still decides.
function validate(f) {
  const e = {};
  if (f.name.trim().length < 3) e.name = 'Enter your full name';
  if (!/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email';
  if (!/^[6-9]\d{9}$/.test(f.phone)) e.phone = 'Enter a 10-digit mobile number';
  if (!/^[A-Za-z0-9]{4,20}$/.test(f.rollNo)) e.rollNo = '4–20 letters or digits';
  if (!f.gender) e.gender = 'Select one';
  if (!f.year) e.year = 'Select your year';
  if (!f.program) e.program = 'Select your program';
  const cgpa = Number(f.cgpa);
  if (f.cgpa === '' || Number.isNaN(cgpa) || cgpa < 0 || cgpa > 10) e.cgpa = 'CGPA between 0 and 10';
  if (f.password.length < 8 || !/[A-Z]/.test(f.password) || !/[a-z]/.test(f.password) || !/\d/.test(f.password)) {
    e.password = 'At least 8 characters with upper, lower case and a digit';
  }
  if (f.confirm !== f.password) e.confirm = 'Passwords do not match';
  return e;
}

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', email: '', phone: '', rollNo: '', gender: '', year: '', program: '', cgpa: '', isPwd: false, password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    setErrors({ ...errors, [k]: undefined });
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate(f);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setServerError('');
    try {
      await register({
        name: f.name.trim(), email: f.email.trim(), phone: f.phone, rollNo: f.rollNo.trim(), gender: f.gender,
        year: Number(f.year), program: f.program, cgpa: Number(f.cgpa), isPwd: f.isPwd, password: f.password,
      });
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-bold tracking-tight">Create your student account</h1>
        <p className="mt-1 text-sm text-slate-500">The hostel office checks your details before you can sign in.</p>
        <form onSubmit={submit} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          {serverError && <div className="sm:col-span-2"><Notice kind="error">{serverError}</Notice></div>}
          <Field label="Full name" error={errors.name} className="sm:col-span-2">{(id) => <input id={id} className="input" autoComplete="name" value={f.name} onChange={set('name')} />}</Field>
          <Field label="Email" error={errors.email}>{(id) => <input id={id} className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Mobile number" error={errors.phone}>{(id) => <input id={id} className="input" inputMode="numeric" maxLength={10} autoComplete="tel-national" value={f.phone} onChange={set('phone')} />}</Field>
          <Field label="Roll number" error={errors.rollNo}>{(id) => <input id={id} className="input uppercase" value={f.rollNo} onChange={set('rollNo')} />}</Field>
          <Field label="Gender" error={errors.gender} hint="Decides which hostels you're eligible for">
            {(id) => <select id={id} className="input" value={f.gender} onChange={set('gender')}><option value="">Select</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select>}
          </Field>
          <Field label="Program" error={errors.program}>
            {(id) => <select id={id} className="input" value={f.program} onChange={set('program')}><option value="">Select</option>{PROGRAMS.map((p) => <option key={p}>{p}</option>)}</select>}
          </Field>
          <Field label="Year of study" error={errors.year}>
            {(id) => <select id={id} className="input" value={f.year} onChange={set('year')}><option value="">Select</option>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>Year {y}</option>)}</select>}
          </Field>
          <Field label="CGPA" error={errors.cgpa} hint="Used for allocation priority">{(id) => <input id={id} className="input" type="number" step="0.01" min="0" max="10" value={f.cgpa} onChange={set('cgpa')} />}</Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-campus-600" checked={f.isPwd} onChange={set('isPwd')} /> Person with disability (priority allocation)
          </label>
          <Field label="Password" error={errors.password}>{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
          <Field label="Confirm password" error={errors.confirm}>{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />}</Field>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
            <p className="mt-4 text-center text-sm text-slate-600">Already registered? <Link to="/login" className="font-semibold text-campus-700 hover:underline">Sign in</Link></p>
          </div>
        </form>
      </div>
    </AuthShell>
  );
}
