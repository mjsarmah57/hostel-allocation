// Applies db/migrations/*.sql in order, once each, inside a transaction per file.
const fs = require('fs');
const path = require('path');
const sequelize = require('../src/lib/db');

(async () => {
  await sequelize.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const [done] = await sequelize.query('SELECT name FROM schema_migrations');
  const applied = new Set(done.map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await sequelize.transaction(async (t) => {
      await sequelize.query(sql, { transaction: t });
      await sequelize.query('INSERT INTO schema_migrations(name) VALUES (:file)', { replacements: { file }, transaction: t });
    });
    console.log(`applied ${file}`);
  }
  console.log('migrations up to date');
  await sequelize.close();
})().catch(async (err) => {
  console.error(err.message);
  await sequelize.close();
  process.exit(1);
});
