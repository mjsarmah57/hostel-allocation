import { Link } from 'react-router-dom';

// The hostel at a glance: one row per floor, one tile per room, one dot per bed.
// Filled dots are occupied beds; a marigold tile is the viewer's own room.
export default function RoomMap({ floors, highlightRoomId, linkTo = (r) => `/rooms/${r.id}` }) {
  return (
    <div className="space-y-4">
      {floors.map((f) => (
        <div key={f.floor} className="flex gap-3">
          <div className="w-14 shrink-0 pt-2 text-right text-xs font-medium text-slate-500">{f.floor === 0 ? 'Ground' : `Floor ${f.floor}`}</div>
          <div className="flex flex-1 flex-wrap gap-1.5">
            {f.rooms.map((r) => {
              const full = r.occupied >= r.capacity;
              const mine = r.id === highlightRoomId;
              const tone = mine
                ? 'border-marigold-400 bg-marigold-50 ring-2 ring-marigold-400'
                : full
                  ? 'border-campus-100 bg-campus-50'
                  : r.occupied === 0
                    ? 'border-slate-200 bg-white'
                    : 'border-slate-200 bg-white';
              return (
                <Link
                  key={r.id}
                  to={linkTo(r)}
                  title={`Room ${r.roomNo}: ${r.occupied}/${r.capacity} occupied${r.openComplaints ? `, ${r.openComplaints} open complaint(s)` : ''}`}
                  className={`relative flex w-16 flex-col items-center rounded-md border px-1 py-1.5 hover:border-campus-500 ${tone}`}
                >
                  <span className="text-xs font-semibold text-ink">{r.roomNo}</span>
                  <span className="mt-1 flex gap-0.5" aria-hidden="true">
                    {Array.from({ length: r.capacity }, (_, k) => (
                      <span key={k} className={`h-2 w-2 rounded-full ${k < r.occupied ? (mine ? 'bg-marigold-500' : 'bg-campus-600') : 'border border-slate-300 bg-white'}`} />
                    ))}
                  </span>
                  {r.openComplaints > 0 && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-white" />}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-4 pl-[4.25rem] text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-campus-600" />Occupied bed</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-slate-300" />Free bed</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-600" />Open complaint</span>
        {highlightRoomId && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-marigold-400" />Your room</span>}
      </div>
    </div>
  );
}
