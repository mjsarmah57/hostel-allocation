import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Loading } from './States';

// Route-level guard. Like hidden buttons, this only improves UX; the API is the authority.
export default function ProtectedRoute({ perm }) {
  const { user, booting, can } = useAuth();
  const location = useLocation();
  if (booting) return <Loading label="Restoring session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (perm && !can(perm)) return <Navigate to="/" replace />;
  return <Outlet />;
}
