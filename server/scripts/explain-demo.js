// Shows each key query's plan WITH its index, then WITHOUT it.
// The index is dropped inside a transaction and the transaction is rolled back,
// so nothing is permanently changed (PostgreSQL DDL is transactional).
// Usage: npm run demo:explain
const sequelize = require('../src/lib/db');

const CASES = [
  {
    title: 'Warden list: allocations of a session filtered by status, newest first',
    index: 'idx_alloc_session_status',
    sql: `SELECT id, student_id, status, created_at FROM allocations
           WHERE session = '2025-26' AND status = 'VACATED' ORDER BY created_at DESC LIMIT 20`,
  },
  {
    title: 'Round 1 priority order: PwD, then year, then CGPA',
    index: 'idx_students_priority',
    sql: `SELECT id, year, cgpa FROM students ORDER BY is_pwd DESC, year DESC, cgpa DESC LIMIT 50`,
  },
  {
    title: 'Hourly cron: unpaid allocations past their deadline (partial index)',
    index: 'idx_alloc_fee_due',
    sql: `SELECT id FROM allocations WHERE status = 'ALLOCATED' AND fee_due_at < now() + interval '30 days'`,
  },
  {
    title: "Student history: a student's allocations across sessions",
    index: 'idx_alloc_student',
    sql: `SELECT id, session, status FROM allocations WHERE student_id = 1234`,
  },
];

async function plan(sql, t) {
  const rows = await sequelize.query(`EXPLAIN (ANALYZE, COSTS, TIMING) ${sql}`, { transaction: t, type: 'SELECT' });
  return rows.map((r) => r['QUERY PLAN']);
}

(async () => {
  for (const c of CASES) {
    console.log(`\n=== ${c.title} ===`);
    const t = await sequelize.transaction();
    try {
      await sequelize.query('SET LOCAL enable_seqscan = on', { transaction: t });
      const withIdx = await plan(c.sql, t);
      await sequelize.query(`DROP INDEX ${c.index}`, { transaction: t });
      const without = await plan(c.sql, t);
      console.log(`--- WITH ${c.index}`);
      withIdx.forEach((l) => console.log(`   ${l}`));
      console.log('--- WITHOUT it');
      without.forEach((l) => console.log(`   ${l}`));
    } finally {
      await t.rollback(); // index restored
    }
  }
  await sequelize.close();
})().catch(async (err) => {
  console.error(err);
  await sequelize.close();
  process.exit(1);
});
