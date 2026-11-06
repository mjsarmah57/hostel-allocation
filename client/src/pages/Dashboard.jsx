import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BedDouble, CalendarRange, MessageSquareWarning, Repeat, UserPlus, Wallet } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Badge, Empty, ErrorState, PageHeader, Panel, Spinner, Stat, fmtDateTime, humanize } from '../components/ui';

// Chart tokens. Single-series charts use one hue; the fee pipeline is ordinal, so it uses
// a light→dark ramp of the same hue; the complaints pair was checked with the palette validator.
const C = {
  primary: '#1F7A6E',
  grid: '#E5E9E8',
  axis: '#64748B',
  open: '#C2410C',
  resolved: '#2F80C9',
  pipeline: ['#A7D8CE', '#5FB3A3', '#2A8C7F', '#0E5A50'],
};

function ChartTooltip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {format ? format(p) : `${p.name}: ${p.value}`}
        </p>
      ))}
    </div>
  );
}

const axisProps = { tick: { fill: C.axis, fontSize: 12 }, axisLine: false, tickLine: false };

function Pipeline({ tiles }) {
  const stages = [
    ['Awaiting fee', tiles.awaitingFee],
    ['Fee submitted', tiles.feeSubmitted],
    ['Verified', tiles.verified],
    ['Checked in', tiles.checkedIn],
  ];
  const total = stages.reduce((n, [, v]) => n + v, 0);
  if (!total) return <Empty title="No allocations yet this session" hint="The pipeline fills once the priority round runs." />;
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={stages.map(([l, v]) => `${l} ${v}`).join(', ')}>
        {stages.map(([label, v], i) => v > 0 && <div key={label} style={{ width: `${(v / total) * 100}%`, background: C.pipeline[i] }} title={`${label}: ${v}`} />)}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stages.map(([label, v], i) => (
          <div key={label}>
            <dt className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: C.pipeline[i] }} />{label}</dt>
            <dd className="mt-0.5 text-lg font-bold">{v.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function Dashboard() {
  const { can, user } = useAuth();
  const { data, loading, error, reload } = useApi('/dashboard');
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const d = data.data;
  const t = d.tiles;
  const admin = data.scope === 'all';
  const trend = d.allocationsTrend.map((x) => ({ ...x, label: new Date(x.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }));
  const complaints = d.complaintsByCategory.map((c) => ({ name: humanize(c.category), open: c.open, resolved: c.total - c.open }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={admin ? 'Hostel office' : d.occupancyByHostel[0]?.name || 'Your hostel'}
        subtitle={`Session ${data.session}${admin ? ' · all hostels' : ` · warden ${user.name}`}`}
        actions={d.round && can('round:manage') && (
          <Link to="/rounds" className="btn-secondary"><CalendarRange className="h-4 w-4" aria-hidden="true" />Round: <Badge status={d.round.status} /></Link>
        )}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Beds occupied" value={`${t.occupancyPct}%`} hint={`${t.occupied.toLocaleString()} of ${t.beds.toLocaleString()} beds`} icon={BedDouble} tone="good" />
        <Stat label="Awaiting fee receipt" value={t.awaitingFee.toLocaleString()} hint="Released automatically after the deadline" icon={Wallet} tone={t.awaitingFee ? 'warn' : 'default'} to="/allocations?status=ALLOCATED" />
        <Stat label="Open complaints" value={t.openComplaints} hint="Open or in progress" icon={MessageSquareWarning} tone={t.openComplaints ? 'bad' : 'default'} to="/complaints" />
        {admin ? (
          <Stat label="Pending registrations" value={t.pendingRegistrations} hint={`${t.students.toLocaleString()} approved students`} icon={UserPlus} tone={t.pendingRegistrations ? 'warn' : 'default'} to="/users" />
        ) : (
          <Stat label="Free beds" value={t.free.toLocaleString()} hint="Available for open booking" icon={BedDouble} />
        )}
      </div>

      <Panel title="Fee and check-in pipeline"><Pipeline tiles={t} /></Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        {admin && (
          <Panel title="Occupancy by hostel" className="lg:col-span-2">
            <div className="h-80">
              <ResponsiveContainer>
                <BarChart data={d.occupancyByHostel} layout="vertical" margin={{ left: 8, right: 24 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke={C.grid} />
                  <XAxis type="number" domain={[0, 100]} unit="%" {...axisProps} />
                  <YAxis type="category" dataKey="name" width={120} {...axisProps} />
                  <Tooltip cursor={{ fill: '#F1F5F4' }} content={<ChartTooltip format={(p) => `${p.payload.occupied} of ${p.payload.beds} beds (${p.value}%)`} />} />
                  <Bar dataKey="pct" name="Occupied" fill={C.primary} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}

        <Panel title="New allocations, last 14 days">
          <div className="h-60">
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ left: -16, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={24} {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip content={<ChartTooltip format={(p) => `${p.value} allocation${p.value === 1 ? '' : 's'}`} />} />
                <Line type="monotone" dataKey="count" name="Allocations" stroke={C.primary} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Priority round: which choice students got">
          {d.preferenceRank.every((x) => !x.count) ? <Empty title="The priority round hasn't run yet" /> : (
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={d.preferenceRank} margin={{ left: -16, right: 8, top: 8 }} barCategoryGap="25%">
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip cursor={{ fill: '#F1F5F4' }} content={<ChartTooltip format={(p) => `${p.value.toLocaleString()} students`} />} />
                  <Bar dataKey="count" name="Students" fill={C.primary} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Complaints by category" action={
          <span className="flex gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.open }} />Open</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.resolved }} />Resolved</span>
          </span>
        }>
          {complaints.length === 0 ? <Empty title="No complaints recorded" /> : (
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={complaints} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke={C.grid} />
                  <XAxis type="number" allowDecimals={false} {...axisProps} />
                  <YAxis type="category" dataKey="name" width={84} {...axisProps} />
                  <Tooltip cursor={{ fill: '#F1F5F4' }} content={<ChartTooltip />} />
                  <Bar dataKey="open" name="Open" stackId="c" fill={C.open} stroke="#fff" strokeWidth={1} maxBarSize={16} />
                  <Bar dataKey="resolved" name="Resolved" stackId="c" fill={C.resolved} stroke="#fff" strokeWidth={1} radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Recent activity" bodyClass="p-0" action={<Link to="/allocations" className="text-sm font-medium text-campus-700 hover:underline">All allocations</Link>}>
          {d.recent.length === 0 ? <Empty title="Nothing yet this session" /> : (
            <ul className="divide-y divide-slate-100">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <Link to={`/allocations/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.studentName} <span className="font-normal text-slate-500">{r.rollNo}</span></span>
                      <span className="block text-xs text-slate-500">{r.hostelName} · Room {r.roomNo}-{r.bedLabel} · {fmtDateTime(r.createdAt)}</span>
                    </span>
                    <Badge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {admin && t.pendingSwaps > 0 && (
        <Link to="/swap-approvals" className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 hover:bg-sky-100">
          <Repeat className="h-4 w-4" aria-hidden="true" /> {t.pendingSwaps} swap request{t.pendingSwaps === 1 ? '' : 's'} waiting for approval
        </Link>
      )}
    </div>
  );
}
