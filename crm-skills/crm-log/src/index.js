const db = require('crm-db');
const { parseActivityLog } = require('./parser');

async function logActivity(dealId, userText) {
  const deal = await db.deals.findById(dealId);
  if (!deal) throw new Error(`Deal not found: ${dealId}`);

  const parsed = await parseActivityLog(userText, {
    dealTitle: deal.title,
    contactName: deal.contact_name
  });

  const activity = await db.activities.create({
    dealId,
    type: parsed.type,
    summary: parsed.summary
  });

  if (parsed.next_action) {
    await db.deals.update(dealId, {
      nextAction: parsed.next_action,
      nextActionDate: parsed.next_action_date ? new Date(parsed.next_action_date) : undefined
    });
  }

  return { activity, parsed };
}

module.exports = { logActivity };
