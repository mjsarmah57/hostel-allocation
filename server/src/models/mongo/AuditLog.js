const mongoose = require('mongoose');

// Append-only: one immutable document per state change. Never updated, never in a SQL transaction.
const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },          // e.g. ALLOCATION_BOOKED, SWAP_APPROVED
    actorId: { type: Number, required: true },
    actorRole: String,
    entity: { type: String, required: true },          // e.g. allocation, swap_request, round
    entityId: { type: Number, required: true },
    session: String,
    data: mongoose.Schema.Types.Mixed,                 // shape differs per action
    requestId: String,
    at: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: 'audit_logs' }
);
auditLogSchema.index({ entity: 1, entityId: 1, at: -1 });
auditLogSchema.index({ actorId: 1, at: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
