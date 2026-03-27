import * as db from '../db/index.js';

const STAGES = ['lead','discovery','validation','scoping','proposal','negotiation','closed_won','closed_lost'];

export async function get_pipeline() {
  const deals = await db.deals.findAll();
  const grouped = Object.fromEntries(STAGES.map(s => [s, []]));
  for (const deal of deals) {
    if (grouped[deal.stage]) grouped[deal.stage].push(deal);
  }
  return grouped;
}

export async function get_deal({ deal_name }) {
  const deals = await db.deals.findAll();
  const query = deal_name.toLowerCase();
  const deal = deals.find(d =>
    d.title.toLowerCase().includes(query) ||
    d.contact_name.toLowerCase().includes(query)
  );
  if (!deal) throw new Error(`No deal found matching "${deal_name}"`);
  const activities = await db.activities.findByDeal(deal.id);
  return { deal, activities };
}

export async function get_deal_context({ deal_id }) {
  const deal = await db.deals.findById(deal_id);
  if (!deal) throw new Error(`Deal not found: ${deal_id}`);
  const activities = await db.activities.findByDeal(deal_id);
  return { deal, activities: activities.slice(0, 5) };
}
