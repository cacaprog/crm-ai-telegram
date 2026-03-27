import * as db from '../db/index.js';
import { STAGES } from '../lib/stages.js';

export async function create_deal({ title, contact_name, company, email, stage, value, notes, source = 'cold' }) {
  const contact = await db.contacts.create({ name: contact_name, company, email, source });
  const deal = await db.deals.create({ contactId: contact.id, title, value, notes });
  if (stage && stage !== 'lead') {
    await db.deals.update(deal.id, { stage });
  }
  return { contact, deal };
}

export async function update_deal({ deal_id, fields }) {
  const { stage: _stage, ...safeFields } = fields;
  return await db.deals.update(deal_id, safeFields);
}

export async function move_stage({ deal_id }) {
  const deal = await db.deals.findById(deal_id);
  if (!deal) throw new Error(`Deal not found: ${deal_id}`);
  const currentIdx = STAGES.indexOf(deal.stage);
  const nextStage = STAGES[currentIdx + 1];
  if (!nextStage || nextStage.startsWith('closed')) {
    throw new Error(`Cannot advance from ${deal.stage}. Use close_deal with outcome won or lost.`);
  }
  return await db.deals.update(deal_id, { stage: nextStage });
}

export async function close_deal({ deal_id, outcome, reason }) {
  const stage = outcome === 'won' ? 'closed_won' : 'closed_lost';
  const deal = await db.deals.update(deal_id, { stage });
  if (reason) {
    await db.activities.create({ dealId: deal_id, type: 'note', summary: `Closed ${outcome}: ${reason}` });
  }
  return deal;
}

export async function snooze_deal({ deal_id, days = 3 }) {
  const nextActionDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return await db.deals.update(deal_id, { nextActionDate });
}

export async function update_contact({ deal_id, email, phone, name, company, role, linkedin_url }) {
  const deal = await db.deals.findById(deal_id);
  if (!deal) throw new Error(`Deal not found: ${deal_id}`);
  return await db.contacts.update(deal.contact_id, {
    name, company, role, email, phone, linkedinUrl: linkedin_url
  });
}
