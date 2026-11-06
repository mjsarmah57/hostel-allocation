// Turns ?page=&limit=&sort= into safe SQL pieces. Sort keys are whitelisted.
function parseListQuery(query, sortable, defaultSort) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  let sort = query.sort || defaultSort;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  if (!sortable[key]) sort = defaultSort;
  const finalKey = sort.replace(/^-/, '');
  return {
    page,
    limit,
    offset: (page - 1) * limit,
    orderSql: `${sortable[finalKey]} ${sort.startsWith('-') ? 'DESC' : 'ASC'}`,
    sort,
  };
}

function pageMeta({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total };
}

module.exports = { parseListQuery, pageMeta };
