const cron = require('node-cron');
const logger = require('../lib/logger');
const { releaseUnpaid } = require('../services/allocation');
const { audit } = require('../services/audit');

async function runReleaseJob({ actor, requestId } = {}) {
  const released = await releaseUnpaid();
  for (const r of released) {
    audit({ action: 'ALLOCATION_RELEASED_UNPAID', actor, entity: 'allocation', entityId: r.id, session: r.session, requestId });
  }
  if (released.length) logger.info({ count: released.length }, 'released unpaid allocations');
  return released;
}

// Every hour at minute 5: free beds whose fee deadline has passed.
function scheduleReleaseJob() {
  return cron.schedule('5 * * * *', () => runReleaseJob().catch((err) => logger.error({ err }, 'release job failed')));
}

module.exports = { runReleaseJob, scheduleReleaseJob };
