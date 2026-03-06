const db = require('crm-db');
const { draftFollowUp } = require('./drafter');

// pending drafts stored in memory (keyed by dealId)
// in production, persist to DB if needed
const pendingDrafts = new Map();

async function requestDraft(dealId) {
  const deal = await db.deals.findById(dealId);
  if (!deal) throw new Error(`Deal not found: ${dealId}`);
  const activities = await db.activities.findByDeal(dealId);
  const draft = await draftFollowUp(deal, activities);
  pendingDrafts.set(dealId, draft);
  return draft;
}

function getPendingDraft(dealId) {
  return pendingDrafts.get(dealId) || null;
}

function clearDraft(dealId) {
  pendingDrafts.delete(dealId);
}

module.exports = { requestDraft, getPendingDraft, clearDraft };
