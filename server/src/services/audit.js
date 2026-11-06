const AuditLog = require('../models/mongo/AuditLog');
const Notification = require('../models/mongo/Notification');
const { isMongoReady } = require('../lib/mongo');
const logger = require('../lib/logger');

// Called AFTER the SQL transaction commits. Logs never participate in a transaction,
// so a Mongo outage must never fail a business operation — we log and move on.
async function audit({ action, actor, entity, entityId, session, data, requestId }) {
  if (!isMongoReady()) return;
  try {
    await AuditLog.create({
      action,
      actorId: actor?.id ?? 0,
      actorRole: actor?.role ?? 'system',
      entity,
      entityId,
      session,
      data,
      requestId,
    });
  } catch (err) {
    logger.error({ err, action }, 'audit log write failed');
  }
}

async function notify(userId, type, message) {
  if (!isMongoReady()) return;
  try {
    await Notification.create({ userId, type, message });
  } catch (err) {
    logger.error({ err, type }, 'notification write failed');
  }
}

module.exports = { audit, notify };
