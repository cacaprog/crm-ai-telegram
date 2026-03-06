const { handleCommand, STAGES } = require('./crm-core/src/index');
const { formatPipeline, formatDeal } = require('./crm-pipeline/src/format');
const { logActivity } = require('./crm-log/src/index');
const { requestDraft, getPendingDraft, clearDraft } = require('./crm-draft/src/index');
const { runCheck, runMorningDigest } = require('./crm-remind/src/scheduler');
const { formatEventSuggestion } = require('./crm-calendar/src/index');
const db = require('./crm-db/src/index');

// pendingActions tracks state for multi-step commands per user
const pendingActions = new Map();

// OpenClaw calls this with (command, args, sendMessage)
async function onCommand(command, args, sendMessage) {
  try {
    switch (command) {

      case '/pipeline': {
        const grouped = await handleCommand('get_pipeline', {});
        await sendMessage(formatPipeline(grouped));
        break;
      }

      case '/deal': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d =>
          d.title.toLowerCase().includes(query) ||
          d.contact_name.toLowerCase().includes(query)
        );
        if (!deal) { await sendMessage(`No deal found matching "${args.join(' ')}"`); break; }
        const { activities } = await handleCommand('get_deal', { dealId: deal.id });
        await sendMessage(formatDeal(deal, activities));
        break;
      }

      case '/add_deal': {
        // guided multi-step — start the flow
        pendingActions.set('add_deal', { step: 1 });
        await sendMessage('Adding new deal. What is the *contact name*?');
        break;
      }

      case '/log': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d =>
          d.title.toLowerCase().includes(query) ||
          d.contact_name.toLowerCase().includes(query)
        );
        if (!deal) { await sendMessage(`No deal found matching "${args.join(' ')}"`); break; }
        pendingActions.set('log', { dealId: deal.id });
        await sendMessage(`Logging for *${deal.title}*. What happened?`);
        break;
      }

      case '/draft': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d =>
          d.title.toLowerCase().includes(query) ||
          d.contact_name.toLowerCase().includes(query)
        );
        if (!deal) { await sendMessage(`No deal found matching "${args.join(' ')}"`); break; }
        await sendMessage(`Drafting follow-up for *${deal.title}*...`);
        const draft = await requestDraft(deal.id);
        await sendMessage(
          `*Draft email for ${deal.contact_name}:*\n\n` +
          `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}\n\n` +
          `Reply /send_draft ${deal.id} to send, or /discard_draft ${deal.id} to cancel.`
        );
        break;
      }

      case '/send_draft': {
        const dealId = parseInt(args[0]);
        const draft = getPendingDraft(dealId);
        if (!draft) { await sendMessage('No pending draft found.'); break; }
        // Gmail send happens here via OpenClaw's gmail integration
        // openclaw.gmail.send(draft) — adapt to actual OpenClaw API
        await sendMessage(`Email sent to ${draft.to}`);
        await db.activities.create({ dealId, type: 'email', summary: `Sent: ${draft.subject}` });
        clearDraft(dealId);
        break;
      }

      case '/discard_draft': {
        const dealId = parseInt(args[0]);
        clearDraft(dealId);
        await sendMessage('Draft discarded.');
        break;
      }

      case '/move': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d =>
          d.title.toLowerCase().includes(query) ||
          d.contact_name.toLowerCase().includes(query)
        );
        if (!deal) { await sendMessage(`No deal found matching "${args.join(' ')}"`); break; }
        const updated = await handleCommand('move_stage', { dealId: deal.id });
        await sendMessage(`Moved *${deal.title}* to *${updated.stage}*`);
        break;
      }

      case '/won': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d => d.title.toLowerCase().includes(query));
        if (!deal) { await sendMessage(`No deal found.`); break; }
        await handleCommand('close_deal', { dealId: deal.id, outcome: 'won' });
        await sendMessage(`Congratulations! *${deal.title}* marked as WON.`);
        break;
      }

      case '/lost': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d => d.title.toLowerCase().includes(query));
        if (!deal) { await sendMessage(`No deal found.`); break; }
        pendingActions.set('lost', { dealId: deal.id, title: deal.title });
        await sendMessage(`Closing *${deal.title}* as lost. What was the reason?`);
        break;
      }

      case '/snooze': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d => d.title.toLowerCase().includes(query));
        if (!deal) { await sendMessage(`No deal found.`); break; }
        // default snooze: 3 days
        const snoozeDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await db.deals.update(deal.id, { nextActionDate: snoozeDate });
        await sendMessage(`Snoozed *${deal.title}* until ${snoozeDate.toLocaleDateString()}`);
        break;
      }

      default: {
        await sendMessage(
          'Unknown command. Available commands:\n' +
          '/pipeline /deal /add_deal /log /draft /move /won /lost /snooze'
        );
      }
    }
  } catch (err) {
    await sendMessage(`Error: ${err.message}`);
  }
}

// OpenClaw calls this for free-text (natural language) messages
async function onMessage(text, sendMessage) {
  const pending = pendingActions.get('log');
  if (pending) {
    pendingActions.delete('log');
    const result = await logActivity(pending.dealId, text);
    let reply = `Logged: ${result.parsed.summary}`;
    if (result.parsed.next_action) {
      reply += `\nNext action set: *${result.parsed.next_action}*`;
      if (result.parsed.next_action_date) reply += ` (due ${result.parsed.next_action_date})`;
    }
    await sendMessage(reply);
    return;
  }

  const lostPending = pendingActions.get('lost');
  if (lostPending) {
    pendingActions.delete('lost');
    await handleCommand('close_deal', { dealId: lostPending.dealId, outcome: 'lost', reason: text });
    await sendMessage(`*${lostPending.title}* marked as LOST. Reason logged.`);
    return;
  }

  // Default: treat as NLP query — find best matching deal and log
  await sendMessage('Use /log <deal name> to log activity, or /pipeline to see your deals.');
}

// OpenClaw calls this on schedule (every 15 min)
async function onSchedule(sendMessage) {
  await runCheck(sendMessage);
}

// OpenClaw calls this at 09:00 daily
async function onMorningDigest(sendMessage) {
  await runMorningDigest(sendMessage);
}

module.exports = { onCommand, onMessage, onSchedule, onMorningDigest };
