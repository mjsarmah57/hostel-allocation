export default function Pagination({ meta, onPage }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>{from}–{to} of {meta.total}</span>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
        <span className="self-center">Page {meta.page} of {meta.totalPages}</span>
        <button type="button" className="btn-secondary" disabled={!meta.hasNext} onClick={() => onPage(meta.page + 1)}>Next</button>
      </div>
    </div>
  );
}
