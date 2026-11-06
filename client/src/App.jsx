import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Register from './pages/Register';
import MyRoom from './pages/MyRoom';
import Preferences from './pages/Preferences';
import Booking from './pages/Booking';
import Swaps from './pages/Swaps';
import Complaints from './pages/Complaints';
import ComplaintDetail from './pages/ComplaintDetail';
import Profile from './pages/Profile';
// Charts are heavy: the dashboard (and its chart library) loads only when opened.
const Dashboard = lazy(() => import('./pages/Dashboard'));
import Allocations from './pages/Allocations';
import AllocationDetail from './pages/AllocationDetail';
import Students from './pages/Students';
import StudentDetail from './pages/StudentDetail';
import Hostels from './pages/Hostels';
import HostelDetail from './pages/HostelDetail';
import RoomDetail from './pages/RoomDetail';
import SwapApprovals from './pages/SwapApprovals';
import Rounds from './pages/Rounds';
import Users from './pages/Users';

// Landing page depends on what the user is allowed to do.
function Home() {
  const { can, booting } = useAuth();
  if (booting) return <Spinner />;
  if (can('allocation:read_own')) return <Navigate to="/me" replace />;
  if (can('dashboard:read')) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/login" replace />;
}

const guard = (perm, path, element) => (
  <Route key={path} element={<ProtectedRoute perm={perm} />}><Route path={path} element={element} /></Route>
);

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="profile" element={<Profile />} />
              {guard('allocation:read_own', 'me', <MyRoom />)}
              {guard('preference:submit', 'preferences', <Preferences />)}
              {guard('booking:create', 'book', <Booking />)}
              {guard('swap:create', 'swaps', <Swaps />)}
              {guard(['complaint:create', 'complaint:manage'], 'complaints', <Complaints />)}
              {guard(['complaint:create', 'complaint:manage'], 'complaints/:id', <ComplaintDetail />)}
              {guard('dashboard:read', 'dashboard', <Suspense fallback={<Spinner />}><Dashboard /></Suspense>)}
              {guard('allocation:read', 'allocations', <Allocations />)}
              {guard('allocation:read', 'allocations/:id', <AllocationDetail />)}
              {guard('student:read', 'students', <Students />)}
              {guard('student:read', 'students/:id', <StudentDetail />)}
              {guard('hostel:read', 'hostels', <Hostels />)}
              {guard('hostel:read', 'hostels/:id', <HostelDetail />)}
              {guard('hostel:read', 'rooms/:id', <RoomDetail />)}
              {guard('swap:approve', 'swap-approvals', <SwapApprovals />)}
              {guard('round:manage', 'rounds', <Rounds />)}
              {guard('user:manage', 'users', <Users />)}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
