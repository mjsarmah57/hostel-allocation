import { useEffect, useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { Empty, ErrorState, Pagination, Spinner } from './ui';

// Hostel + room browser whose controls map directly onto API query parameters:
// ?floor=&available=&sort=&page=&limit=
export default function RoomPicker({ action, availableOnly = false, refreshKey = 0 }) {
  const hostels = useApi('/hostels?eligible=true');
  const [hostelId, setHostelId] = useState('');
  const [floor, setFloor] = useState('');
  const [sort, setSort] = useState('roomNo');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const list = hostels.data?.data;
    if (hostelId || !list?.length) return;
    // When booking, open on a hostel that still has beds instead of a full one.
    const first = (availableOnly && list.find((h) => h.freeBeds > 0)) || list[0];
    setHostelId(String(first.id));
  }, [hostels.data, hostelId, availableOnly]);

  const params = new URLSearchParams({ page, limit: 12, sort, ...(floor !== '' ? { floor } : {}), ...(availableOnly ? { available: 'true' } : {}) });
  const rooms = useApi(hostelId ? `/hostels/${hostelId}/rooms?${params}&k=${refreshKey}` : null);

  if (hostels.loading) return <Spinner />;
  if (hostels.error) return <ErrorState message={hostels.error} onRetry={hostels.reload} />;
  if (!hostels.data.data.length) return <div className="panel"><Empty icon={DoorOpen} title="No hostel accepts your gender and year" /></div>;

  return (
    <div className="panel">
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
        <label className="text-sm text-slate-600">Hostel
          <select className="input mt-1" value={hostelId} onChange={(e) => { setHostelId(e.target.value); setPage(1); }}>
            {hostels.data.data.map((h) => <option key={h.id} value={h.id} disabled={availableOnly && h.freeBeds === 0}>{h.name} ({h.freeBeds ? `${h.freeBeds} free` : 'full'})</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-600">Floor
          <select className="input mt-1" value={floor} onChange={(e) => { setFloor(e.target.value); setPage(1); }}>
            <option value="">All floors</option>
            {[0, 1, 2, 3, 4].map((f) => <option key={f} value={f}>{f === 0 ? 'Ground' : `Floor ${f}`}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-600">Sort by
          <select className="input mt-1" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            <option value="roomNo">Room number</option>
            <option value="-freeBeds">Most free beds</option>
            <option value="floor">Lowest floor</option>
            <option value="-floor">Highest floor</option>
          </select>
        </label>
      </div>
      {rooms.loading && <div className="px-4"><Spinner /></div>}
      {rooms.error && <div className="p-4"><ErrorState message={rooms.error} onRetry={rooms.reload} /></div>}
      {rooms.data && (rooms.data.data.length === 0 ? (
        <Empty icon={DoorOpen} title="No rooms match" hint={availableOnly ? 'Every bed here is taken. Try another hostel or floor.' : undefined} />
      ) : (
        <>
          <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.data.data.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="font-semibold">Room {r.roomNo}</p>
                  <p className="text-xs text-slate-500">{r.floor === 0 ? 'Ground floor' : `Floor ${r.floor}`} · {r.capacity}-seater</p>
                  <span className="mt-1.5 flex gap-1" aria-label={`${r.freeBeds} of ${r.capacity} beds free`}>
                    {Array.from({ length: r.capacity }, (_, k) => (
                      <span key={k} className={`h-2 w-2 rounded-full ${k < r.capacity - r.freeBeds ? 'bg-campus-600' : 'border border-slate-300'}`} />
                    ))}
                  </span>
                </div>
                {action({ ...r, hostelName: rooms.data.hostel.name }, rooms.reload)}
              </li>
            ))}
          </ul>
          <Pagination meta={rooms.data.meta} onPage={setPage} />
        </>
      ))}
    </div>
  );
}
