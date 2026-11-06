const { AllocationRound } = require('../models');
const { notFound } = require('../lib/errors');

// The "current" round is the newest one that is not CLOSED (falls back to the newest overall).
async function getCurrentRound() {
  const open = await AllocationRound.findOne({
    where: { status: ['DRAFT', 'PREFERENCES_OPEN', 'ALLOCATED', 'BOOKING_OPEN'] },
    order: [['createdAt', 'DESC']],
  });
  return open || AllocationRound.findOne({ order: [['createdAt', 'DESC']] });
}

async function resolveSession(sessionParam) {
  if (sessionParam) return sessionParam;
  const round = await getCurrentRound();
  if (!round) throw notFound('Allocation round');
  return round.session;
}

module.exports = { getCurrentRound, resolveSession };
