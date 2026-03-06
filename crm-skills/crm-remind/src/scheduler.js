const db = require('crm-db');
const { buildReminderMessages, buildMorningDigest } = require('./checker');

async function runCheck(sendMessage) {
  const dueDeals = await db.deals.findDueForFollowUp();
  const staleDeals = await db.deals.findStale(14);
  const messages = buildReminderMessages(dueDeals, staleDeals);
  for (const msg of messages) {
    await sendMessage(msg);
  }
}

async function runMorningDigest(sendMessage) {
  const dueDeals = await db.deals.findDueForFollowUp();
  const staleDeals = await db.deals.findStale(14);
  await sendMessage(buildMorningDigest(dueDeals, staleDeals));
}

module.exports = { runCheck, runMorningDigest };
