import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorState, Loading, Notice } from '../components/States';

export default function Occupancy() {
  const { can } = useAuth();
  const report = useApi('/reports/occupancy');
  const [msg, setMsg] = useState(null);

  const runJob = async () => {
    try {
      const { data } = await api.post('/admin/jobs/release-unpaid');
      setMsg({ kind: 'success', text: `Released ${data.data.releasedCount} unpaid allocation(s).` });
      report.reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  };

  if (report.loading) return <Loading />;
  if (report.error) return <ErrorState message={report.error} onRetry={report.reload} />;
  const { data, totals, session } = report.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Occupancy · {session}</h1>
        {can('allocation:release') && <button type="button" className="btn-secondary" onClick={runJob}>Release unpaid now</button>}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {data.length === 0 ? <Empty title="No hostels in scope" /> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Hostel</th><th className="th">Beds</th><th className="th">Occupied</th><th className="th">Free</th>
                <th className="th">Awaiting fee</th><th className="th">Fee submitted</th><th className="th">Verified</th><th className="th">Checked in</th>
              </tr>
            </thead>
            <tbody>
              {data.map((h) => (
                <tr key={h.id}>
                  <td className="td">
                    <div className="font-medium">{h.name}</div>
                    <div className="mt-1 h-1.5 w-32 overflow-hidden rounded bg-slate-200"><div className="h-full bg-indigo-600" style={{ width: `${h.occupancyPct}%` }} /></div>
                  </td>
                  <td className="td">{h.beds}</td>
                  <td className="td">{h.occupied} <span className="text-slate-500">({h.occupancyPct}%)</span></td>
                  <td className="td">{h.free}</td>
                  <td className="td">{h.awaitingFee}</td>
                  <td className="td">{h.feeSubmitted}</td>
                  <td className="td">{h.verified}</td>
                  <td className="td">{h.checkedIn}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="td font-medium">Total</td><td className="td">{totals.beds}</td><td className="td">{totals.occupied}</td><td className="td" colSpan={5}>{totals.beds - totals.occupied} free</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
