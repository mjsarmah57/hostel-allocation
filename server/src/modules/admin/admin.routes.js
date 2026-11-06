const express = require('express');
const { requirePermission } = require('../../middleware/authorize');
const { runReleaseJob } = require('../../jobs/releaseUnpaid');
const AuditLog = require('../../models/mongo/AuditLog');
const Notification = require('../../models/mongo/Notification');
const { isMongoReady } = require('../../lib/mongo');

const router = express.Router();

// Lets the examiner trigger the cron job on demand instead of waiting for it.
router.post('/jobs/release-unpaid', requirePermission('allocation:release'), async (req, res, next) => {
  try {
    const released = await runReleaseJob({ actor: req.user, requestId: req.id });
    res.json({ data: { releasedCount: released.length, released } });
  } catch (err) {
    next(err);
  }
});

router.get('/audit-logs', requirePermission('audit:read'), async (req, res, next) => {
  try {
    if (!isMongoReady()) return res.json({ data: [], note: 'MongoDB not connected' });
    const filter = {};
    if (req.query.entity) filter.entity = String(req.query.entity);
    if (req.query.entityId) filter.entityId = Number(req.query.entityId);
    const data = await AuditLog.find(filter).sort({ at: -1 }).limit(Math.min(Number(req.query.limit) || 50, 200)).lean();
    return res.json({ data });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

// Notifications for the signed-in user (any role).
module.exports.notificationsRouter = express
  .Router()
  .get('/me', async (req, res, next) => {
    try {
      if (!isMongoReady()) return res.json({ data: [] });
      const data = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(30).lean();
      return res.json({ data });
    } catch (err) {
      return next(err);
    }
  });
