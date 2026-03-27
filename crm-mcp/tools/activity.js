import * as db from '../db/index.js';

export async function log_activity({ deal_id, type, summary, next_action, next_action_date }) {
  const activity = await db.activities.create({ dealId: deal_id, type, summary });
  if (next_action || next_action_date) {
    await db.deals.update(deal_id, {
      nextAction: next_action,
      nextActionDate: next_action_date ? new Date(next_action_date) : undefined
    });
  }
  return activity;
}
