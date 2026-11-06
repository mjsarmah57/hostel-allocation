import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Badge, ErrorState, Notice, PageHeader, Spinner } from '../components/ui';
import RoomPicker from '../components/RoomPicker';

export default function Booking() {
  const round = useApi('/rounds/current');
  const mine = useApi('/allocations/me');
  const [msg, setMsg] = useState(null);
  const [busyRoom, setBusyRoom] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (round.loading || mine.loading) return <Spinner />;
  if (round.error) return <ErrorState message={round.error} onRetry={round.reload} />;
  if (mine.error) return <ErrorState message={mine.error} onRetry={mine.reload} />;
  const r = round.data.data;

  const book = async (room) => {
    setBusyRoom(room.id);
    setMsg(null);
    try {
      const { data } = await api.post(`/rounds/${r.id}/book`, { roomId: room.id });
      setMsg({ kind: 'success', text: <>Booked {data.data.hostel} room {data.data.roomNo}, bed {data.data.bedLabel}. <Link className="font-semibold underline" to="/me">Upload your fee receipt</Link>.</> });
      mine.reload();
    } catch (err) {
      // 409 means someone else took the last bed first: show the server's message and refresh.
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusyRoom(null);
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Open booking" subtitle="Beds left after the priority round go first come, first served." actions={<Badge status={r.status} />} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {mine.data?.data ? (
        <Notice>You already hold a bed this session. <Link className="font-semibold underline" to="/me">View your room</Link>.</Notice>
      ) : r.status !== 'BOOKING_OPEN' ? (
        <Notice>Open booking isn't live. It starts after the priority allocation for students who didn't get a bed.</Notice>
      ) : (
        <RoomPicker availableOnly refreshKey={refreshKey} action={(room) => (
          <button type="button" className="btn-primary btn-sm" disabled={busyRoom !== null} onClick={() => book(room)}>{busyRoom === room.id ? 'Booking…' : 'Book'}</button>
        )} />
      )}
    </div>
  );
}
