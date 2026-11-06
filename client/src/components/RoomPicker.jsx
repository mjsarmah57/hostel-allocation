import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { Empty, ErrorState, Loading } from './States';
import Pagination from './Pagination';

// Hostel + room browser whose controls map directly onto API query parameters:
// ?floor=&available=&sort=&page=&limit=
export default function RoomPicker({ action, availableOnly = false, refreshKey = 0 }) {
  const hostels = useApi('/hostels?eligible=true');
  const [hostelId, setHostelId] = useState('');
  const [floor, setFloor] = useState('');
  const [sort, setSort] = useState('roomNo');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!hostelId && hostels.data?.data?.length) setHostelId(String(hostels.data.data[0].id));
  }, [hostels.data, hostelId]);

  const params = new URLSearchParams({ page, limit: 15, sort, ...(floor !== '' ? { floor } : {}), ...(availableOnly ? { available: 'true' } : {}) });
  const rooms = useApi(hostelId ? `/hostels/${hostelId}/rooms?${params}&k=${refreshKey}` : null);

  if (hostels.loading) return <Loading />;
  if (hostels.error) return <ErrorState message={hostels.error} onRetry={hostels.reload} />;
  if (!hostels.data.data.length) return <Empty title="No hostel accepts your gender and year" />;

  return (
    <div className="card">
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <label className="text-sm">Hostel
          <select className="input mt-1" value={hostelId} onChange={(e) => { setHostelId(e.target.value); setPage(1); }}>
            {hostels.data.data.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.freeBeds} free)</option>)}
          </select>
        </label>
        <label className="text-sm">Floor
          <select className="input mt-1" value={floor} onChange={(e) => { setFloor(e.target.value); setPage(1); }}>
            <option value="">All floors</option>
            {[0, 1, 2, 3, 4].map((f) => <option key={f} value={f}>{f === 0 ? 'Ground' : `Floor ${f}`}</option>)}
          </select>
        </label>
        <label className="text-sm">Sort by
          <select className="input mt-1" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            <option value="roomNo">Room number</option>
            <option value="-freeBeds">Most free beds</option>
            <option value="floor">Floor (low to high)</option>
            <option value="-floor">Floor (high to low)</option>
          </select>
        </label>
      </div>

      {rooms.loading && <Loading />}
      {rooms.error && <ErrorState message={rooms.error} onRetry={rooms.reload} />}
      {rooms.data && (rooms.data.data.length === 0 ? (
        <Empty title="No rooms match" hint={availableOnly ? 'Every bed here is taken. Try another hostel or floor.' : undefined} />
      ) : (
        <>
          <table className="w-full">
            <thead><tr><th className="th">Room</th><th className="th">Floor</th><th className="th">Capacity</th><th className="th">Free beds</th><th className="th" /></tr></thead>
            <tbody>
              {rooms.data.data.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium">{r.roomNo}</td>
                  <td className="td">{r.floor}</td>
                  <td className="td">{r.capacity}</td>
                  <td className="td">{r.freeBeds}</td>
                  <td className="td text-right">{action({ ...r, hostelName: rooms.data.hostel.name }, rooms.reload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination meta={rooms.data.meta} onPage={setPage} />
        </>
      ))}
    </div>
  );
}
