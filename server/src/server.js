const env = require('./config/env');
const app = require('./app');
const logger = require('./lib/logger');
const sequelize = require('./lib/db');
const { connectMongo } = require('./lib/mongo');
const { scheduleReleaseJob } = require('./jobs/releaseUnpaid');

async function start() {
  await sequelize.authenticate();
  logger.info('PostgreSQL connected');
  await connectMongo();
  if (env.ENABLE_CRON === 'true') scheduleReleaseJob();

  const server = app.listen(env.PORT, () => logger.info(`API listening on :${env.PORT} (docs at /api/docs)`));

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await sequelize.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
