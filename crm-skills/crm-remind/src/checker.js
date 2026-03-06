function buildReminderMessages(dueDeals, staleDeals) {
  const messages = [];

  for (const deal of dueDeals) {
    messages.push(
      `FOLLOW-UP DUE: *${deal.title}* (${deal.contact_name})\n` +
      `Action: ${deal.next_action || 'Check in'}\n` +
      `Reply /deal ${deal.id} for details or /snooze ${deal.id} to push it out.`
    );
  }

  for (const deal of staleDeals) {
    messages.push(
      `STALE DEAL: *${deal.title}* (${deal.contact_name}) is stale — no activity in 14+ days.\n` +
      `Stage: ${deal.stage}\n` +
      `Reply /deal ${deal.id} to review.`
    );
  }

  return messages;
}

function buildMorningDigest(dueDeals, staleDeals) {
  if (dueDeals.length === 0 && staleDeals.length === 0) {
    return 'Good morning! No follow-ups due today.';
  }
  const lines = ['*Good morning! Here is your CRM digest:*\n'];
  if (dueDeals.length > 0) {
    lines.push(`*Follow-ups due today (${dueDeals.length}):*`);
    for (const d of dueDeals) {
      lines.push(`  • ${d.title} / ${d.contact_name}: ${d.next_action || 'Check in'}`);
    }
  }
  if (staleDeals.length > 0) {
    lines.push(`\n*Stale deals (${staleDeals.length}) — no activity in 14+ days:*`);
    for (const d of staleDeals) {
      lines.push(`  • ${d.title} / ${d.contact_name} (${d.stage})`);
    }
  }
  return lines.join('\n');
}

module.exports = { buildReminderMessages, buildMorningDigest };
