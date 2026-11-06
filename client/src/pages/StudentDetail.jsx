import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Avatar, Badge, DetailList, Empty, ErrorState, PageHeader, Panel, Spinner, fmtDate, humanize } from '../components/ui';

export default function StudentDetail() {
  const { id } = useParams();
  const s = useApi(`/students/${id}`);
  if (s.loading) return <Spinner />;
  if (s.error) return <ErrorState message={s.error} onRetry={s.reload} />;
  const d = s.data.data;
  const c = d.current;

  return (
    <div>
      <PageHeader title={d.name} subtitle={`${d.rollNo} · ${d.program}, year ${d.year}`} back={{ to: '/students', label: 'Students' }} actions={!d.isActive && <Badge status="INACTIVE">Deactivated</Badge>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <div className="space-y-6">
          <Panel>
            <div className="mb-5 flex items-center gap-4"><Avatar name={d.name} size="lg" /><div><p className="font-semibold">{d.name}</p><p className="text-sm text-slate-500">{d.email}</p></div></div>
            <DetailList items={[
              ['Roll number', d.rollNo], ['Phone', d.phone], ['Gender', d.gender === 'MALE' ? 'Male' : 'Female'], ['Year', d.year],
              ['Program', d.program], ['CGPA', Number(d.cgpa).toFixed(2)], ['PwD priority', d.isPwd ? 'Yes' : 'No'], ['Registered', fmtDate(d.registeredAt)],
            ]} />
          </Panel>
          <Panel title="Current preferences">
            {d.preferences.length === 0 ? <p className="text-sm text-slate-500">No preferences in an open round.</p> : (
              <ol className="space-y-1.5 text-sm">{d.preferences.map((p) => <li key={p.rank} className="flex gap-2"><span className="w-5 font-semibold text-slate-400">{p.rank}</span><Link className="hover:text-campus-700" to={`/rooms/${p.roomId}`}>{p.hostelName} · {p.roomNo}</Link></li>)}</ol>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="This session">
            {!c ? <p className="text-sm text-slate-500">No room this session.</p> : (
              <Link to={`/allocations/${c.id}`} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4 hover:border-campus-500">
                <span><span className="block text-lg font-bold">{c.hostelName} · {c.roomNo}-{c.bedLabel}</span><span className="text-sm text-slate-500">Allocated {fmtDate(c.createdAt)} via {c.source.replace('_', ' ').toLowerCase()}</span></span>
                <Badge status={c.status} />
              </Link>
            )}
          </Panel>
          <Panel title="Allocation history" bodyClass="p-0">
            {d.allocations.length === 0 ? <Empty title="No allocations" /> : (
              <div className="overflow-x-auto"><table className="w-full">
                <thead><tr><th className="th">Session</th><th className="th">Room</th><th className="th">Source</th><th className="th">Status</th></tr></thead>
                <tbody>{d.allocations.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50"><td className="td"><Link className="font-medium hover:text-campus-700" to={`/allocations/${a.id}`}>{a.session}</Link></td><td className="td">{a.hostelName} {a.roomNo}-{a.bedLabel}</td><td className="td text-slate-500">{humanize(a.source)}</td><td className="td"><Badge status={a.status} /></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
          <Panel title="Complaints" bodyClass="p-0">
            {d.complaints.length === 0 ? <Empty title="No complaints raised" /> : (
              <ul className="divide-y divide-slate-100">{d.complaints.map((x) => (
                <li key={x.id}><Link to={`/complaints/${x.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"><span className="flex-1 text-sm"><span className="font-medium">{x.title}</span><span className="block text-xs text-slate-500">{x.hostelName} {x.roomNo} · {fmtDate(x.createdAt)}</span></span><Badge status={x.status} /></Link></li>
              ))}</ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
