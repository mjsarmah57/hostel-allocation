import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { Avatar, Badge, Empty, ErrorState, PageHeader, Pagination, Spinner } from '../components/ui';

export default function Students() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [gender, setGender] = useState('');
  const [allocated, setAllocated] = useState('');
  const [sort, setSort] = useState('rollNo');
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  const qs = new URLSearchParams({ page, limit: 20, sort });
  if (q) qs.set('q', q);
  if (year) qs.set('year', year);
  if (gender) qs.set('gender', gender);
  if (allocated) qs.set('allocated', allocated);
  const list = useApi(`/students?${qs}`);
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };

  return (
    <div>
      <PageHeader title="Students" subtitle={list.data ? `${list.data.meta.total.toLocaleString()} students · session ${list.data.session}` : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input className="input lg:col-span-2" placeholder="Search name, roll number or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <select className="input" value={year} onChange={reset(setYear)} aria-label="Year"><option value="">All years</option>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>Year {y}</option>)}</select>
        <select className="input" value={allocated} onChange={reset(setAllocated)} aria-label="Room"><option value="">With or without room</option><option value="true">Has a room</option><option value="false">No room yet</option></select>
        <select className="input" value={sort} onChange={reset(setSort)} aria-label="Sort"><option value="rollNo">Roll number</option><option value="name">Name</option><option value="-cgpa">Highest CGPA</option><option value="-year">Most senior</option></select>
        <select className="input lg:hidden" value={gender} onChange={reset(setGender)} aria-label="Gender"><option value="">All genders</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select>
      </div>
      <div className="panel overflow-hidden">
        {list.loading && <div className="px-5"><Spinner /></div>}
        {list.error && <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>}
        {list.data && (list.data.data.length === 0 ? <Empty icon={Users} title="No students match" /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className="th">Student</th><th className="th">Program</th><th className="th">CGPA</th><th className="th">Room this session</th></tr></thead>
                <tbody>
                  {list.data.data.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="td">
                        <Link to={`/students/${s.id}`} className="flex items-center gap-3">
                          <Avatar name={s.name} size="sm" />
                          <span><span className="block font-semibold text-ink hover:text-campus-700">{s.name}</span><span className="block text-xs text-slate-500">{s.rollNo} · {s.gender === 'MALE' ? 'Male' : 'Female'}{s.isPwd ? ' · PwD' : ''}</span></span>
                        </Link>
                      </td>
                      <td className="td">{s.program}<span className="block text-xs text-slate-500">Year {s.year}</span></td>
                      <td className="td font-medium">{Number(s.cgpa).toFixed(2)}</td>
                      <td className="td">{s.allocationId ? <><span>{s.hostelName} {s.roomNo}-{s.bedLabel}</span><span className="ml-2"><Badge status={s.allocationStatus} /></span></> : <span className="text-slate-400">No room</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={list.data.meta} onPage={setPage} />
          </>
        ))}
      </div>
    </div>
  );
}
