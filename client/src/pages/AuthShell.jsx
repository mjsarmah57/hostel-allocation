import { BedDouble } from 'lucide-react';

// Split screen: a quiet brand panel drawn from the product's own vocabulary
// (a floor of rooms, one dot per bed), and the form.
const DEMO_FLOOR = [3, 3, 2, 3, 1, 3, 2, 3, 3, 2, 3, 3, 0, 3, 2, 3, 3, 1, 3, 2, 3, 3, 2, 3];

export default function AuthShell({ children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-campus-900 p-10 text-campus-100 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-marigold-500 text-campus-900"><BedDouble className="h-5 w-5" aria-hidden="true" /></span>
          <span className="text-lg font-bold text-white">Hostel Allocation</span>
        </div>
        <div>
          <div className="mb-10 grid max-w-sm grid-cols-6 gap-2" aria-hidden="true">
            {DEMO_FLOOR.map((occ, i) => (
              <div key={i} className={`flex flex-col items-center rounded-md border px-1 py-2 ${i === 9 ? 'border-marigold-400 bg-marigold-500/15' : 'border-white/10 bg-white/5'}`}>
                <span className="text-[10px] text-campus-100/60">{200 + i + 1}</span>
                <span className="mt-1 flex gap-0.5">
                  {[0, 1, 2].map((k) => (
                    <span key={k} className={`h-1.5 w-1.5 rounded-full ${k < occ ? (i === 9 ? 'bg-marigold-400' : 'bg-campus-100/70') : 'border border-campus-100/30'}`} />
                  ))}
                </span>
              </div>
            ))}
          </div>
          <h2 className="max-w-md text-3xl leading-tight font-bold text-white">Every bed, every student, one fair process.</h2>
          <p className="mt-3 max-w-md text-campus-100/70">Rank your rooms, get allocated by priority, book what's left, and track everything from fee receipt to check-in.</p>
        </div>
        <p className="text-xs text-campus-100/50">CSA504 Full Stack Development · Capstone</p>
      </div>
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">{children}</div>
    </div>
  );
}
