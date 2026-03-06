const db = require('crm-db');

const STAGES = ['lead','discovery','validation','scoping','proposal','negotiation','closed_won','closed_lost'];

async function handleCommand(command, args) {
  switch (command) {
    case 'add_deal': {
      const contact = await db.contacts.create({
        name: args.contactName,
        company: args.company,
        email: args.email,
        source: args.source || 'cold'
      });
      const deal = await db.deals.create({
        contactId: contact.id,
        title: args.title,
        value: args.value
      });
      return { contact, deal };
    }

    case 'get_pipeline': {
      const deals = await db.deals.findAll();
      const grouped = Object.fromEntries(STAGES.map(s => [s, []]));
      for (const deal of deals) {
        if (grouped[deal.stage]) grouped[deal.stage].push(deal);
      }
      return grouped;
    }

    case 'get_deal': {
      const deal = await db.deals.findById(args.dealId);
      if (!deal) throw new Error(`Deal not found: ${args.dealId}`);
      const activities = await db.activities.findByDeal(args.dealId);
      return { deal, activities };
    }

    case 'move_stage': {
      const deal = await db.deals.findById(args.dealId);
      if (!deal) throw new Error(`Deal not found: ${args.dealId}`);
      const currentIdx = STAGES.indexOf(deal.stage);
      const nextStage = STAGES[currentIdx + 1];
      if (!nextStage || nextStage.startsWith('closed')) {
        throw new Error(`Cannot advance from ${deal.stage} automatically. Use /won or /lost.`);
      }
      return await db.deals.update(args.dealId, { stage: nextStage });
    }

    case 'set_next_action': {
      return await db.deals.update(args.dealId, {
        nextAction: args.action,
        nextActionDate: args.date ? new Date(args.date) : undefined
      });
    }

    case 'log_activity': {
      return await db.activities.create({
        dealId: args.dealId,
        type: args.type,
        summary: args.summary
      });
    }

    case 'close_deal': {
      const stage = args.outcome === 'won' ? 'closed_won' : 'closed_lost';
      const deal = await db.deals.update(args.dealId, { stage });
      if (args.reason) {
        await db.activities.create({
          dealId: args.dealId,
          type: 'note',
          summary: `Closed ${args.outcome}: ${args.reason}`
        });
      }
      return deal;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

module.exports = { handleCommand, STAGES };
