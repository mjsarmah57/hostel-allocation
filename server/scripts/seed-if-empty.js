// First boot on a new database: seed demo data. Later boots: do nothing,
// so data created through the app survives restarts and redeploys.
const sequelize = require('../src/lib/db');

(async () => {
  const [[{ count }]] = await sequelize.query('SELECT COUNT(*)::int AS count FROM users');
  if (count > 0 && process.env.RESEED_ON_BOOT !== 'true') {
    console.log(`Database already has ${count} users; skipping seed`);
    await sequelize.close();
    return;
  }
  console.log(count > 0 ? 'RESEED_ON_BOOT=true: replacing all data with fresh demo data...' : 'Empty database: seeding demo data...');
  require('./seed'); // reuses this connection and closes it when done
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
