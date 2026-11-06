import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { ErrorState, Loading, Notice } from '../components/States';
import RoomPicker from '../components/RoomPicker';
import StatusBadge from '../components/StatusBadge';

export default function Booking() {
  const round = useApi('/rounds/current');
  const mine = useApi('/allocations/me');
  const [msg, setMsg] = useState(null);
  const [busyRoom, setBusyRoom] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (round.loading || mine.loading) return <Loading />;
  if (round.error) return <ErrorState message={round.error} onRetry={round.reload} />;
  if (mine.error) return <ErrorState message={mine.error} onRetry={mine.reload} />;
  const r = round.data.data;

  const book = async (room) => {
    setBusyRoom(room.id);
    setMsg(null);
    try {
      const { data } = await api.post(`/rounds/${r.id}/book`, { roomId: room.id });
      setMsg({ kind: 'success', text: `Booked! ${data.data.hostel} room ${data.data.roomNo}, bed ${data.data.bedLabel}. Upload your fee receipt next.` });
      mine.reload();
    } catch (err) {
      // 409 = someone else got the last bed first; show the server's message and refresh the list.
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusyRoom(null);
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Open booking · {r.session}</h1>
        <StatusBadge status={r.status} />
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {mine.data?.data ? (
        <Notice>You already hold a bed this session. <Link className="underline" to="/me">View my room</Link>.</Notice>
      ) : r.status !== 'BOOKING_OPEN' ? (
        <Notice>Open booking is not active. It opens after the priority allocation for students who did not get a bed.</Notice>
      ) : (
        <RoomPicker
          availableOnly
          refreshKey={refreshKey}
          action={(room) => (
            <button type="button" className="btn-primary" disabled={busyRoom !== null} onClick={() => book(room)}>
              {busyRoom === room.id ? 'Booking…' : 'Book a bed'}
            </button>
          )}
        />
      )}
    </div>
  );
}
