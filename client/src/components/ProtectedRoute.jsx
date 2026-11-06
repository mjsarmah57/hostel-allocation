import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from './ui';

// Route-level guard (perm may be one code or a list: any of them). Like a hidden button,
// this only shapes the UI; the API is the authority on every request.
export default function ProtectedRoute({ perm }) {
  const { user, booting, can } = useAuth();
  const location = useLocation();
  if (booting) return <div className="p-8"><Spinner label="Restoring your session" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  const perms = perm ? (Array.isArray(perm) ? perm : [perm]) : [];
  if (perms.length && !perms.some((p) => can(p))) return <Navigate to="/" replace />;
  return <Outlet />;
}
