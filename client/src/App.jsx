import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import { Loading } from './components/States';
import Login from './pages/Login';
import MyRoom from './pages/MyRoom';
import Preferences from './pages/Preferences';
import Booking from './pages/Booking';
import Swaps from './pages/Swaps';
import Allocations from './pages/Allocations';
import SwapApprovals from './pages/SwapApprovals';
import Rounds from './pages/Rounds';
import Occupancy from './pages/Occupancy';

// Landing page depends on what the user is allowed to do.
function Home() {
  const { can, booting } = useAuth();
  if (booting) return <Loading />;
  if (can('allocation:read_own')) return <Navigate to="/me" replace />;
  if (can('round:manage')) return <Navigate to="/rounds" replace />;
  if (can('allocation:read')) return <Navigate to="/allocations" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route element={<ProtectedRoute perm="allocation:read_own" />}><Route path="me" element={<MyRoom />} /></Route>
              <Route element={<ProtectedRoute perm="preference:submit" />}><Route path="preferences" element={<Preferences />} /></Route>
              <Route element={<ProtectedRoute perm="booking:create" />}><Route path="book" element={<Booking />} /></Route>
              <Route element={<ProtectedRoute perm="swap:create" />}><Route path="swaps" element={<Swaps />} /></Route>
              <Route element={<ProtectedRoute perm="allocation:read" />}><Route path="allocations" element={<Allocations />} /></Route>
              <Route element={<ProtectedRoute perm="swap:approve" />}><Route path="swap-approvals" element={<SwapApprovals />} /></Route>
              <Route element={<ProtectedRoute perm="round:manage" />}><Route path="rounds" element={<Rounds />} /></Route>
              <Route element={<ProtectedRoute perm="report:read" />}><Route path="occupancy" element={<Occupancy />} /></Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
